/**
 * app.js — Browser entry point for the Mini Economic Model Manager.
 *
 * Architecture:
 *  - `world` object is the single source of truth (mutated in place by the engine).
 *  - HTML tables are rendered FROM the world object and re-rendered after each change.
 *  - CSV import → updates world → re-renders tables.
 *  - CSV export → serializes world → downloads files.
 *  - Scheduler state lives in localStorage (via scheduler.js).
 *
 * Tick execution order (see engine.js):
 *  0. applyScheduledConversions for currentTick
 *  1. applyScheduledInjections  for currentTick
 *  2. tickMensal
 *  3. clear scheduled items for that tick, advance tick counter
 */

import { parseCsv, unparseCsv, downloadText } from '../src/core/csv.js';
import {
  rowsToPessoas,  pessoasToRows,
  rowsToEmpresas, empresasToRows,
  rowsToEstados,  estadosToRows,
  applyAtivos, worldAtivosToRows, reconcilePatrimonio,
} from '../src/core/world.js';
import {
  tickMensal,
  applyScheduledConversions, applyScheduledInjections,
  EMPRESA_CONVERSIONS, ESTADO_CONVERSIONS, getPessoaConversions,
} from '../src/core/engine.js';
import {
  getCurrentTick, setCurrentTick, advanceTick,
  scheduleConversion, unscheduleConversion, getAllScheduledConversions, getConversionsForTick, clearConversionsForTick,
  scheduleInjection, removeInjection, getAllScheduledInjections, getInjectionsForTick, clearInjectionsForTick,
  removeAllConversionsForEntity, removeAllInjectionsForEntity,
} from '../src/core/scheduler.js';

// ── App state ──────────────────────────────────────────────────────────────
let world  = { pessoas: [], empresas: [], estados: [] };
let config = null;

// Which entity type is showing in the conversion matrix
let scheduleEntityType = 'pessoa';

// Ativos modal state
let modalEntityType = null;
let modalEntityId   = null;
let modalAtivos     = {};

// ── Config loader ──────────────────────────────────────────────────────────
async function loadConfig() {
  if (config) return config;
  const [classes, atributos, conversoes, fluxos, produtos] = await Promise.all([
    fetch('../data/config/classes.json').then(r => r.json()),
    fetch('../data/config/atributos.json').then(r => r.json()),
    fetch('../data/config/conversoes.json').then(r => r.json()),
    fetch('../data/config/fluxos_economicos.json').then(r => r.json()),
    fetch('../data/config/produtos.json').then(r => r.json()),
  ]);
  config = { classes, atributos, conversoes, fluxos, produtos };
  return config;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

function fmtNum(n) {
  return Number.isFinite(n) ? n.toLocaleString('pt-BR') : String(n);
}

function fmtDec(n, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n);
}

function updateTickCounter() {
  document.getElementById('tick-counter').textContent = getCurrentTick();
}

// ── Tab navigation ──────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'agendamento') renderScheduleTab();
  });
});

// ── File input helpers ──────────────────────────────────────────────────────
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file, 'utf-8');
  });
}

document.getElementById('file-pessoas').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  world.pessoas = rowsToPessoas(parseCsv(await readFile(file)));
  renderPessoasTable();
  setStatus(`Carregado: ${file.name}`);
});

document.getElementById('file-empresas').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  world.empresas = rowsToEmpresas(parseCsv(await readFile(file)));
  renderEmpresasTable();
  setStatus(`Carregado: ${file.name}`);
});

document.getElementById('file-estados').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  world.estados = rowsToEstados(parseCsv(await readFile(file)));
  renderEstadosTable();
  setStatus(`Carregado: ${file.name}`);
});

document.getElementById('file-ativos').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  applyAtivos(world, parseCsv(await readFile(file)));
  renderAll();
  setStatus(`Ativos aplicados: ${file.name}`);
});

// ── Load defaults ───────────────────────────────────────────────────────────
document.getElementById('btn-defaults').addEventListener('click', async () => {
  try {
    setStatus('Carregando exemplos padrão…');
    await loadConfig();
    const [pCsv, eCsv, sCsv, aCsv] = await Promise.all([
      fetch('../data/world/pessoas.csv').then(r => r.text()),
      fetch('../data/world/empresas.csv').then(r => r.text()),
      fetch('../data/world/estados.csv').then(r => r.text()),
      fetch('../data/world/ativos.csv').then(r => r.text()).catch(() => ''),
    ]);
    world.pessoas  = rowsToPessoas(parseCsv(pCsv));
    world.empresas = rowsToEmpresas(parseCsv(eCsv));
    world.estados  = rowsToEstados(parseCsv(sCsv));
    if (aCsv) applyAtivos(world, parseCsv(aCsv));
    renderAll();
    setStatus('✅ Exemplos padrão carregados.');
  } catch (err) {
    setStatus(`Erro ao carregar exemplos: ${err.message}`);
    console.error(err);
  }
});

// ── Tick mensal ─────────────────────────────────────────────────────────────
document.getElementById('btn-tick').addEventListener('click', async () => {
  try {
    if (!world.pessoas.length && !world.empresas.length && !world.estados.length) {
      setStatus('⚠ Carregue os dados antes de rodar o tick.');
      return;
    }

    const cfg  = await loadConfig();
    const tick = getCurrentTick();
    const log  = [];

    // 0. Scheduled conversions
    const conversions = getConversionsForTick(tick);
    log.push(...applyScheduledConversions(conversions, world, cfg));

    // 1. Scheduled injections
    const injections = getInjectionsForTick(tick);
    log.push(...applyScheduledInjections(injections, world));

    // 2. Monthly tick
    log.push(...tickMensal(cfg, world));

    // 3. Clear used schedules, advance tick
    clearConversionsForTick(tick);
    clearInjectionsForTick(tick);
    const newTick = advanceTick();

    document.getElementById('log').textContent = log.join('\n');
    renderAll();
    setStatus(`✅ Tick ${tick} concluído → agora no Tick ${newTick}`);
  } catch (err) {
    setStatus(`Erro no tick: ${err.message}`);
    console.error(err);
  }
});

// ── Export CSVs ─────────────────────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', () => {
  if (!world.pessoas.length && !world.empresas.length && !world.estados.length) {
    setStatus('⚠ Nenhum dado para exportar.');
    return;
  }

  // Validate estado hierarchy before export
  if (world.estados.length) {
    const estadoIds = new Set(world.estados.map(s => s.id));
    const selfParent   = world.estados.filter(s => s.parent_id && s.parent_id === s.id);
    const missingParent = world.estados.filter(s => s.parent_id && !estadoIds.has(s.parent_id));
    if (selfParent.length) {
      setStatus(`⚠ Export bloqueado: estado(s) com self-parent: ${selfParent.map(s => `"${s.id}"`).join(', ')}`);
      return;
    }
    if (missingParent.length) {
      setStatus(`⚠ Exportando com parent_id inválido em: ${missingParent.map(s => `"${s.id}"`).join(', ')}`);
    }
  }

  if (world.pessoas.length)  downloadText('pessoas.csv',  unparseCsv(pessoasToRows(world.pessoas)));
  if (world.empresas.length) downloadText('empresas.csv', unparseCsv(empresasToRows(world.empresas)));
  if (world.estados.length)  downloadText('estados.csv',  unparseCsv(estadosToRows(world.estados)));

  const ativosRows = worldAtivosToRows(world);
  if (ativosRows.length) downloadText('ativos.csv', unparseCsv(ativosRows));

  setStatus('⬇ CSVs exportados.');
});

// ── Render all tables ───────────────────────────────────────────────────────
function renderAll() {
  renderPessoasTable();
  renderEmpresasTable();
  renderEstadosTable();
  updateTickCounter();
}

// ── Pessoas table ────────────────────────────────────────────────────────────
function renderPessoasTable() {
  const container = document.getElementById('table-pessoas');
  const p = world.pessoas;
  if (!p.length) {
    container.innerHTML = '<div class="empty-state">Nenhuma pessoa carregada. Use "Carregar Exemplos" ou importe um CSV.</div>';
    return;
  }

  let html = `<div class="table-wrap"><table>
    <thead><tr>
      <th>ID</th><th>Nome</th><th>Classe</th><th>Estado</th>
      <th>Influência</th><th>Patrimônio</th><th>Moral</th><th>Reputação</th>
      <th>Renda Mensal</th><th>Caixa</th>
      <th>Gasto Infl.</th><th>Gasto Moral</th><th>Gasto Rep.</th>
      <th>Ativos</th><th>Ações</th>
    </tr></thead>
    <tbody>`;

  for (const [i, pessoa] of p.entries()) {
    const badgeClass = `badge-${pessoa.classe}`;
    html += `<tr>
      <td class="id-cell">${esc(pessoa.id)}</td>
      <td><input class="cell-input" data-entity="pessoa" data-idx="${i}" data-field="nome" value="${esc(pessoa.nome)}" /></td>
      <td><span class="badge ${badgeClass}">${esc(pessoa.classe)}</span></td>
      <td><input class="cell-input" data-entity="pessoa" data-idx="${i}" data-field="estado_id" value="${esc(pessoa.estado_id)}" style="width:90px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" max="5" step="1" data-entity="pessoa" data-idx="${i}" data-field="atributos.influencia" value="${pessoa.atributos.influencia}" style="width:55px" /></td>
      <td class="num">${fmtNum(pessoa.atributos.patrimonio)}</td>
      <td class="num"><input class="cell-input num" type="number" min="0" max="5" step="1" data-entity="pessoa" data-idx="${i}" data-field="atributos.moral" value="${pessoa.atributos.moral}" style="width:55px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" max="5" step="1" data-entity="pessoa" data-idx="${i}" data-field="atributos.reputacao" value="${pessoa.atributos.reputacao}" style="width:55px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="pessoa" data-idx="${i}" data-field="renda_mensal" value="${pessoa.renda_mensal}" style="width:100px" /></td>
      <td class="num"><input class="cell-input num" type="number" data-entity="pessoa" data-idx="${i}" data-field="caixa" value="${Math.round(pessoa.caixa)}" style="width:100px" /></td>
      <td style="text-align:center"><input type="checkbox" data-entity="pessoa" data-idx="${i}" data-field="gastos_mensais_pagos.influencia" ${pessoa.gastos_mensais_pagos.influencia ? 'checked' : ''} /></td>
      <td style="text-align:center"><input type="checkbox" data-entity="pessoa" data-idx="${i}" data-field="gastos_mensais_pagos.moral" ${pessoa.gastos_mensais_pagos.moral ? 'checked' : ''} /></td>
      <td style="text-align:center"><input type="checkbox" data-entity="pessoa" data-idx="${i}" data-field="gastos_mensais_pagos.reputacao" ${pessoa.gastos_mensais_pagos.reputacao ? 'checked' : ''} /></td>
      <td><button class="btn-ghost btn-sm btn-ativos" data-etype="pessoa" data-eid="${esc(pessoa.id)}">💎 ${Object.keys(pessoa.ativos || {}).length}</button></td>
      <td><button class="btn-red btn-sm btn-delete-entity" data-etype="pessoa" data-eid="${esc(pessoa.id)}">🗑 Excluir</button></td>
    </tr>`;
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;
  bindTableInputs(container);
}

// ── Empresas table ───────────────────────────────────────────────────────────
function renderEmpresasTable() {
  const container = document.getElementById('table-empresas');
  const e = world.empresas;
  if (!e.length) {
    container.innerHTML = '<div class="empty-state">Nenhuma empresa carregada.</div>';
    return;
  }

  let html = `<div class="table-wrap"><table>
    <thead><tr>
      <th>ID</th><th>Nome</th><th>Dono</th><th>Estado</th>
      <th>Patrimônio</th><th>Funcionários</th><th>Renda</th><th>Produção</th>
      <th>Moral Corp.</th><th>Rep. Corp.</th><th>Lucro</th>
      <th>Sal. Func.</th><th>Manutenção</th><th>Insumos</th>
      <th>Ativos</th><th>Ações</th>
    </tr></thead>
    <tbody>`;

  for (const [i, emp] of e.entries()) {
    html += `<tr>
      <td class="id-cell">${esc(emp.id)}</td>
      <td><input class="cell-input" data-entity="empresa" data-idx="${i}" data-field="nome" value="${esc(emp.nome)}" /></td>
      <td class="id-cell">${esc(emp.dono_id)}</td>
      <td class="id-cell">${esc(emp.estado_id)}</td>
      <td class="num">${fmtNum(Math.round(emp.patrimonio || 0))}</td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="empresa" data-idx="${i}" data-field="atributos.funcionarios" value="${emp.atributos.funcionarios}" style="width:70px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="empresa" data-idx="${i}" data-field="atributos.renda" value="${emp.atributos.renda}" style="width:100px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="empresa" data-idx="${i}" data-field="atributos.producao" value="${emp.atributos.producao}" style="width:80px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" max="5" step="0.1" data-entity="empresa" data-idx="${i}" data-field="atributos.moral_corporativa" value="${emp.atributos.moral_corporativa}" style="width:55px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" max="5" step="0.1" data-entity="empresa" data-idx="${i}" data-field="atributos.reputacao_corporativa" value="${emp.atributos.reputacao_corporativa}" style="width:55px" /></td>
      <td class="num"><input class="cell-input num" type="number" data-entity="empresa" data-idx="${i}" data-field="atributos.lucro" value="${Math.round(emp.atributos.lucro)}" style="width:100px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="empresa" data-idx="${i}" data-field="custos.salario_funcionario" value="${emp.custos.salario_funcionario}" style="width:80px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="empresa" data-idx="${i}" data-field="custos.manutencao" value="${emp.custos.manutencao}" style="width:90px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="empresa" data-idx="${i}" data-field="custos.insumos" value="${emp.custos.insumos}" style="width:90px" /></td>
      <td><button class="btn-ghost btn-sm btn-ativos" data-etype="empresa" data-eid="${esc(emp.id)}">💎 ${Object.keys(emp.ativos || {}).length}</button></td>
      <td><button class="btn-red btn-sm btn-delete-entity" data-etype="empresa" data-eid="${esc(emp.id)}">🗑 Excluir</button></td>
    </tr>`;
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;
  bindTableInputs(container);
}

// ── Estados table ────────────────────────────────────────────────────────────
function renderEstadosTable() {
  const container = document.getElementById('table-estados');
  const s = world.estados;
  if (!s.length) {
    container.innerHTML = '<div class="empty-state">Nenhum estado carregado.</div>';
    return;
  }

  let html = `<div class="table-wrap"><table>
    <thead><tr>
      <th>ID</th><th>Nome</th><th>Tipo</th><th>Parent</th><th>Descrição</th>
      <th>Patrimônio</th>
      <th>Populacão</th><th>Forças Arm.</th><th>Cultura</th><th>Moral Pop.</th>
      <th>Renda Trib.</th><th>IR PF</th><th>IR PJ</th><th>Imp. Prod.</th>
      <th>Sal. Pol.</th><th>Incent. Emp.</th><th>Inv. Cultura</th><th>Inv. FA</th>
      <th>Ativos</th><th>Ações</th>
    </tr></thead>
    <tbody>`;

  for (const [i, est] of s.entries()) {
    const parentOpts = s
      .filter(x => x.id !== est.id)
      .map(x => `<option value="${esc(x.id)}" ${est.parent_id === x.id ? 'selected' : ''}>${esc(x.nome || x.id)}</option>`)
      .join('');
    const parentValid = !est.parent_id || s.some(x => x.id === est.parent_id && x.id !== est.id);
    const parentWarn  = est.parent_id && !parentValid
      ? ` style="border-color:var(--red)" title="parent_id '${esc(est.parent_id)}' não encontrado"` : '';

    html += `<tr>
      <td class="id-cell">${esc(est.id)}</td>
      <td><input class="cell-input" data-entity="estado" data-idx="${i}" data-field="nome" value="${esc(est.nome)}" /></td>
      <td><input class="cell-input" list="tipo-options" data-entity="estado" data-idx="${i}" data-field="tipo" value="${esc(est.tipo || '')}" style="width:100px" placeholder="ex: pais" /></td>
      <td><select class="cell-input" data-entity="estado" data-idx="${i}" data-field="parent_id" style="width:130px"${parentWarn}>
        <option value="" ${!est.parent_id ? 'selected' : ''}>— sem pai —</option>
        ${parentOpts}
      </select></td>
      <td><input class="cell-input" data-entity="estado" data-idx="${i}" data-field="descricao" value="${esc(est.descricao || '')}" style="width:160px" /></td>
      <td class="num">${fmtNum(Math.round(est.patrimonio || 0))}</td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="estado" data-idx="${i}" data-field="atributos.populacao" value="${est.atributos.populacao}" style="width:110px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" max="5" step="0.1" data-entity="estado" data-idx="${i}" data-field="atributos.forcas_armadas" value="${est.atributos.forcas_armadas}" style="width:60px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" max="5" step="0.1" data-entity="estado" data-idx="${i}" data-field="atributos.cultura" value="${est.atributos.cultura}" style="width:60px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" max="5" step="0.1" data-entity="estado" data-idx="${i}" data-field="atributos.moral_populacao" value="${est.atributos.moral_populacao}" style="width:60px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="estado" data-idx="${i}" data-field="financas.renda_tributaria" value="${Math.round(est.financas.renda_tributaria)}" style="width:110px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" max="1" step="0.01" data-entity="estado" data-idx="${i}" data-field="impostos.ir_pf" value="${est.impostos.ir_pf}" style="width:60px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" max="1" step="0.01" data-entity="estado" data-idx="${i}" data-field="impostos.ir_pj" value="${est.impostos.ir_pj}" style="width:60px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" max="1" step="0.01" data-entity="estado" data-idx="${i}" data-field="impostos.imp_prod" value="${est.impostos.imp_prod}" style="width:60px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="estado" data-idx="${i}" data-field="financas.salarios_politicos" value="${est.financas.salarios_politicos}" style="width:80px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="estado" data-idx="${i}" data-field="financas.incentivos_empresas" value="${est.financas.incentivos_empresas}" style="width:90px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="estado" data-idx="${i}" data-field="financas.investimento_cultura" value="${est.financas.investimento_cultura}" style="width:90px" /></td>
      <td class="num"><input class="cell-input num" type="number" min="0" data-entity="estado" data-idx="${i}" data-field="financas.investimento_fa" value="${est.financas.investimento_fa}" style="width:80px" /></td>
      <td><button class="btn-ghost btn-sm btn-ativos" data-etype="estado" data-eid="${esc(est.id)}">💎 ${Object.keys(est.ativos || {}).length}</button></td>
      <td><button class="btn-red btn-sm btn-delete-entity" data-etype="estado" data-eid="${esc(est.id)}">🗑 Excluir</button></td>
    </tr>`;
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;
  bindTableInputs(container);
}

// ── Table input binding ──────────────────────────────────────────────────────
function bindTableInputs(container) {
  // Text/number inputs
  container.querySelectorAll('input.cell-input').forEach(input => {
    input.addEventListener('change', () => {
      const { entity, idx, field } = input.dataset;
      const obj = getEntityArray(entity)[parseInt(idx)];
      if (!obj) return;
      setEntityField(obj, field, input.type === 'number' ? parseFloat(input.value) : input.value);
    });
  });

  // Select inputs (e.g. parent_id dropdown)
  container.querySelectorAll('select.cell-input').forEach(sel => {
    sel.addEventListener('change', () => {
      const { entity, idx, field } = sel.dataset;
      const obj = getEntityArray(entity)[parseInt(idx)];
      if (!obj) return;
      if (field === 'parent_id' && sel.value === obj.id) {
        sel.value = obj.parent_id || '';
        setStatus('⚠ Um estado não pode ser seu próprio pai (self-parent).');
        return;
      }
      setEntityField(obj, field, sel.value);
    });
  });

  // Checkboxes
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const { entity, idx, field } = cb.dataset;
      const obj = getEntityArray(entity)[parseInt(idx)];
      if (!obj) return;
      setEntityField(obj, field, cb.checked);
    });
  });

  // Ativos buttons
  container.querySelectorAll('.btn-ativos').forEach(btn => {
    btn.addEventListener('click', () => openAtivosModal(btn.dataset.etype, btn.dataset.eid));
  });

  // Delete entity buttons
  container.querySelectorAll('.btn-delete-entity').forEach(btn => {
    btn.addEventListener('click', () => deleteEntity(btn.dataset.etype, btn.dataset.eid));
  });
}

function getEntityArray(type) {
  if (type === 'pessoa')  return world.pessoas;
  if (type === 'empresa') return world.empresas;
  if (type === 'estado')  return world.estados;
  return [];
}

/**
 * Explicit dispatch table mapping data-field paths to typed setters.
 * This avoids dynamic bracket-notation property assignment (prototype-pollution risk).
 * Only paths listed here can be updated via table inputs.
 */
const FIELD_SETTERS = {
  // Shared text
  nome:      (e, v) => { e.nome      = v; },
  estado_id: (e, v) => { e.estado_id = v; },
  // Pessoa atributos
  'atributos.influencia': (e, v) => { e.atributos.influencia = v; },
  'atributos.moral':      (e, v) => { e.atributos.moral      = v; },
  'atributos.reputacao':  (e, v) => { e.atributos.reputacao  = v; },
  // Empresa atributos
  'atributos.funcionarios':          (e, v) => { e.atributos.funcionarios          = v; },
  'atributos.renda':                 (e, v) => { e.atributos.renda                 = v; },
  'atributos.producao':              (e, v) => { e.atributos.producao              = v; },
  'atributos.moral_corporativa':     (e, v) => { e.atributos.moral_corporativa     = v; },
  'atributos.reputacao_corporativa': (e, v) => { e.atributos.reputacao_corporativa = v; },
  'atributos.lucro':                 (e, v) => { e.atributos.lucro                 = v; },
  // Estado atributos
  'atributos.populacao':       (e, v) => { e.atributos.populacao       = v; },
  'atributos.forcas_armadas':  (e, v) => { e.atributos.forcas_armadas  = v; },
  'atributos.cultura':         (e, v) => { e.atributos.cultura         = v; },
  'atributos.moral_populacao': (e, v) => { e.atributos.moral_populacao = v; },
  // Pessoa top-level
  renda_mensal: (e, v) => { e.renda_mensal = v; },
  caixa:        (e, v) => { e.caixa        = v; },
  // Pessoa gastos
  'gastos_mensais_pagos.influencia': (e, v) => { e.gastos_mensais_pagos.influencia = v; },
  'gastos_mensais_pagos.moral':      (e, v) => { e.gastos_mensais_pagos.moral      = v; },
  'gastos_mensais_pagos.reputacao':  (e, v) => { e.gastos_mensais_pagos.reputacao  = v; },
  // Empresa custos
  'custos.salario_funcionario': (e, v) => { e.custos.salario_funcionario = v; },
  'custos.manutencao':          (e, v) => { e.custos.manutencao          = v; },
  'custos.insumos':             (e, v) => { e.custos.insumos             = v; },
  // Estado financas
  'financas.renda_tributaria':     (e, v) => { e.financas.renda_tributaria     = v; },
  'financas.salarios_politicos':   (e, v) => { e.financas.salarios_politicos   = v; },
  'financas.incentivos_empresas':  (e, v) => { e.financas.incentivos_empresas  = v; },
  'financas.investimento_cultura': (e, v) => { e.financas.investimento_cultura = v; },
  'financas.investimento_fa':      (e, v) => { e.financas.investimento_fa      = v; },
  // Estado impostos
  'impostos.ir_pf':    (e, v) => { e.impostos.ir_pf    = v; },
  'impostos.ir_pj':    (e, v) => { e.impostos.ir_pj    = v; },
  'impostos.imp_prod': (e, v) => { e.impostos.imp_prod = v; },
  // Estado hierarchy
  tipo:      (e, v) => { e.tipo      = v; },
  parent_id: (e, v) => { e.parent_id = v; },
  descricao: (e, v) => { e.descricao = v; },
};

/** Apply a known field update to an entity. Ignores unknown paths. */
function setEntityField(entity, field, value) {
  const setter = FIELD_SETTERS[field];
  if (setter) setter(entity, value);
}

// ── Ativos Modal ─────────────────────────────────────────────────────────────
function openAtivosModal(entityType, entityId) {
  const entity = getEntityArray(entityType).find(x => x.id === entityId);
  if (!entity) return;

  modalEntityType = entityType;
  modalEntityId   = entityId;
  modalAtivos     = Object.assign({}, entity.ativos || {});

  document.getElementById('modal-title').textContent =
    `💎 Ativos — ${entity.nome || entity.id}`;

  renderAtivosModalRows();
  document.getElementById('modal-ativos').classList.add('open');
}

function renderAtivosModalRows() {
  const container = document.getElementById('modal-ativos-rows');
  let html = '';
  for (const [id, valor] of Object.entries(modalAtivos)) {
    html += `<div class="ativos-row">
      <input class="cell-input" readonly value="${esc(id)}" style="flex:2;background:transparent;border:none;color:var(--muted)" />
      <input class="cell-input num" type="number" aria-label="Valor do ativo ${esc(id)}" data-ativo-id="${esc(id)}" value="${Number(valor) || 0}" style="flex:1" />
      <button class="btn-red btn-sm btn-remove-ativo" data-ativo-id="${esc(id)}">×</button>
    </div>`;
  }
  container.innerHTML = html || '<p style="color:var(--muted);font-size:0.8rem">Nenhum ativo cadastrado.</p>';

  container.querySelectorAll('input[data-ativo-id]').forEach(input => {
    input.addEventListener('input', () => {
      modalAtivos[input.dataset.ativoId] = parseFloat(input.value) || 0;
      updateModalSum();
    });
  });

  container.querySelectorAll('.btn-remove-ativo').forEach(btn => {
    btn.addEventListener('click', () => {
      delete modalAtivos[btn.dataset.ativoId];
      renderAtivosModalRows();
      updateModalSum();
    });
  });

  updateModalSum();
}

function updateModalSum() {
  const sum = Object.values(modalAtivos).reduce((a, b) => a + (Number(b) || 0), 0);
  document.getElementById('modal-patrimonio-sum').textContent = fmtNum(Math.round(sum));
}

document.getElementById('btn-add-ativo').addEventListener('click', () => {
  const idInput  = document.getElementById('new-ativo-id');
  const valInput = document.getElementById('new-ativo-valor');
  const id  = idInput.value.trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  const val = parseFloat(valInput.value) || 0;
  if (!id) { idInput.focus(); return; }
  modalAtivos[id] = val;
  idInput.value  = '';
  valInput.value = '';
  renderAtivosModalRows();
});

document.getElementById('btn-modal-save').addEventListener('click', () => {
  const entity = getEntityArray(modalEntityType).find(x => x.id === modalEntityId);
  if (entity) {
    entity.ativos = Object.assign({}, modalAtivos);
    reconcilePatrimonio(entity, modalEntityType);
    // Re-render the relevant table
    if (modalEntityType === 'pessoa')  renderPessoasTable();
    if (modalEntityType === 'empresa') renderEmpresasTable();
    if (modalEntityType === 'estado')  renderEstadosTable();
  }
  closeAtivosModal();
  setStatus('Ativos salvos.');
});

document.getElementById('btn-modal-cancel').addEventListener('click', closeAtivosModal);
document.getElementById('modal-ativos').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-ativos')) closeAtivosModal();
});

function closeAtivosModal() {
  document.getElementById('modal-ativos').classList.remove('open');
  modalEntityType = null;
  modalEntityId   = null;
  modalAtivos     = {};
}

// ── Scheduling tab ────────────────────────────────────────────────────────────

// Entity type sub-tabs in scheduling
document.querySelectorAll('.entity-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.entity-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    scheduleEntityType = btn.dataset.etype;
    renderConversionMatrix();
  });
});

document.getElementById('sched-tick').addEventListener('change', renderConversionMatrix);

function renderScheduleTab() {
  renderConversionMatrix();
  renderInjectionsList();
  populateInjectionEntitySelect();
}

function getConversionsForType(type) {
  if (type === 'pessoa')  return config ? getPessoaConversions(config) : [];
  if (type === 'empresa') return EMPRESA_CONVERSIONS;
  if (type === 'estado')  return ESTADO_CONVERSIONS;
  return [];
}

function renderConversionMatrix() {
  const container = document.getElementById('conversion-matrix');
  const tick      = parseInt(document.getElementById('sched-tick').value) || 0;
  const type      = scheduleEntityType;
  const entities  = getEntityArray(type);
  const convs     = getConversionsForType(type);

  if (!entities.length) {
    container.innerHTML = '<div class="empty-state">Carregue os dados primeiro.</div>';
    return;
  }

  const scheduled = getAllScheduledConversions().filter(x => x.tick === tick && x.ownerType === type);
  const isScheduled = (ownerId, convId) =>
    scheduled.some(x => x.ownerId === ownerId && x.conversionId === convId);

  let html = `<div class="table-wrap"><table class="matrix-table">
    <thead><tr>
      <th>Entidade</th>
      ${convs.map(c => `<th style="font-size:0.7rem">${esc(c.label)}</th>`).join('')}
    </tr></thead>
    <tbody>`;

  for (const entity of entities) {
    html += `<tr>
      <td>${esc(entity.nome || entity.id)}</td>
      ${convs.map(c => `
        <td>
          <input type="checkbox"
            data-sched-tick="${tick}"
            data-sched-type="${type}"
            data-sched-id="${esc(entity.id)}"
            data-sched-conv="${esc(c.id)}"
            ${isScheduled(entity.id, c.id) ? 'checked' : ''}
          />
        </td>`).join('')}
    </tr>`;
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;

  container.querySelectorAll('input[type="checkbox"][data-sched-tick]').forEach(cb => {
    cb.addEventListener('change', () => {
      const { schedTick, schedType, schedId, schedConv } = cb.dataset;
      const t = parseInt(schedTick);
      if (cb.checked) {
        scheduleConversion(t, schedType, schedId, schedConv);
      } else {
        unscheduleConversion(t, schedType, schedId, schedConv);
      }
    });
  });
}

// ── Injections ───────────────────────────────────────────────────────────────

document.getElementById('inj-type').addEventListener('change', populateInjectionEntitySelect);

function populateInjectionEntitySelect() {
  const type   = document.getElementById('inj-type').value;
  const select = document.getElementById('inj-entity');
  const arr    = getEntityArray(type);
  select.innerHTML = arr.length
    ? arr.map(x => `<option value="${esc(x.id)}">${esc(x.nome || x.id)}</option>`).join('')
    : '<option value="">— sem dados carregados —</option>';
}

document.getElementById('btn-add-injection').addEventListener('click', () => {
  const type   = document.getElementById('inj-type').value;
  const id     = document.getElementById('inj-entity').value;
  const amount = parseFloat(document.getElementById('inj-amount').value) || 0;
  const tick   = parseInt(document.getElementById('inj-tick').value) || 0;

  if (!id)     { setStatus('⚠ Selecione uma entidade.'); return; }
  if (!amount) { setStatus('⚠ Informe um valor positivo.'); return; }

  scheduleInjection(tick, type, id, amount);
  renderInjectionsList();
  setStatus(`Aporte de ${fmtNum(amount)} agendado para ${type} "${id}" no tick ${tick}.`);
});

function renderInjectionsList() {
  const container = document.getElementById('injections-list');
  const all = getAllScheduledInjections();

  if (!all.length) {
    container.innerHTML = '<div class="empty-state">Nenhum aporte agendado.</div>';
    return;
  }

  let html = `<div class="table-wrap"><table>
    <thead><tr>
      <th>Tick</th><th>Tipo</th><th>Entidade</th><th>Valor</th><th></th>
    </tr></thead>
    <tbody>`;

  for (const inj of all) {
    html += `<tr>
      <td class="num">${esc(inj.tick)}</td>
      <td>${esc(inj.ownerType)}</td>
      <td class="id-cell">${esc(inj.ownerId)}</td>
      <td class="num">${esc(fmtNum(inj.amount))}</td>
      <td><button class="btn-red btn-sm btn-remove-inj" data-inj-id="${esc(inj.id)}">× Remover</button></td>
    </tr>`;
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;

  container.querySelectorAll('.btn-remove-inj').forEach(btn => {
    btn.addEventListener('click', () => {
      removeInjection(btn.dataset.injId);
      renderInjectionsList();
    });
  });
}

// ── Util ─────────────────────────────────────────────────────────────────────
/** Escape HTML to prevent injection in dynamically built markup. */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Delete Entity ─────────────────────────────────────────────────────────────

/**
 * Attempt to delete an entity from the world state.
 * Performs dependency checks before removal and cleans up scheduled items.
 * @param {'pessoa'|'empresa'|'estado'} type
 * @param {string} id
 */
function deleteEntity(type, id) {
  // ── Dependency checks (block if references exist) ──────────────────────
  if (type === 'pessoa') {
    const deps = world.empresas.filter(e => e.dono_id === id);
    if (deps.length) {
      const names = deps.map(e => `"${esc(e.id)}"`).join(', ');
      setStatus(`⛔ Não é possível excluir: a pessoa "${id}" é dona de empresa(s): ${names}. Remova a referência antes.`);
      return;
    }
  }

  if (type === 'estado') {
    const msgs = [];
    const pessoasDeps  = world.pessoas.filter(p => p.estado_id === id);
    const empresasDeps = world.empresas.filter(e => e.estado_id === id);
    const estadosDeps  = world.estados.filter(s => s.parent_id === id);
    if (pessoasDeps.length)  msgs.push(`pessoas: ${pessoasDeps.map(x => `"${x.id}"`).join(', ')}`);
    if (empresasDeps.length) msgs.push(`empresas: ${empresasDeps.map(x => `"${x.id}"`).join(', ')}`);
    if (estadosDeps.length)  msgs.push(`estados filhos: ${estadosDeps.map(x => `"${x.id}"`).join(', ')}`);
    if (msgs.length) {
      setStatus(`⛔ Não é possível excluir o estado "${id}". Dependências: ${msgs.join('; ')}.`);
      return;
    }
  }

  // ── Confirmation dialog ────────────────────────────────────────────────
  const typeLabel  = type === 'pessoa' ? 'Pessoa' : type === 'empresa' ? 'Empresa' : 'Estado';
  const entity     = getEntityArray(type).find(x => x.id === id);
  const displayName = entity ? (entity.nome || entity.id) : id;
  if (!window.confirm(`Excluir ${typeLabel} "${displayName}" (${id})?\nEsta ação não pode ser desfeita.`)) return;

  // ── Remove from world ─────────────────────────────────────────────────
  if (type === 'pessoa') {
    world.pessoas = world.pessoas.filter(x => x.id !== id);
    renderPessoasTable();
  } else if (type === 'empresa') {
    world.empresas = world.empresas.filter(x => x.id !== id);
    renderEmpresasTable();
  } else {
    world.estados = world.estados.filter(x => x.id !== id);
    renderEstadosTable();
  }

  // ── Remove scheduled conversions and injections for this entity ────────
  removeAllConversionsForEntity(type, id);
  removeAllInjectionsForEntity(type, id);
  renderInjectionsList();

  setStatus(`🗑 ${typeLabel} "${id}" excluído(a).`);
}

// ── Add Entity Modal ──────────────────────────────────────────────────────────

const NEW_ID_PATTERN = /^[a-z][a-z0-9_\-]{2,64}$/;
let addEntityType = null;

function validateNewEntityId(id, type) {
  if (!id) return 'ID é obrigatório.';
  if (!NEW_ID_PATTERN.test(id)) {
    return 'ID inválido: comece com letra minúscula; use a-z, 0-9, _ ou - (3–65 chars).';
  }
  if (getEntityArray(type).some(x => x.id === id)) {
    return `ID "${id}" já existe em ${type}.`;
  }
  return null;
}

function openAddEntityModal(type) {
  addEntityType = type;
  const label = type === 'pessoa'  ? '👤 Adicionar Pessoa'
              : type === 'empresa' ? '🏢 Adicionar Empresa'
              : '🗺 Adicionar Estado';
  document.getElementById('modal-add-title').textContent = label;
  document.getElementById('modal-add-form').innerHTML = buildAddEntityForm(type);
  bindAddEntityFormEvents(type);
  document.getElementById('modal-add-entity').classList.add('open');
}

function closeAddEntityModal() {
  document.getElementById('modal-add-entity').classList.remove('open');
  addEntityType = null;
}

function buildAddEntityForm(type) {
  const idRow = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-id">ID <span style="color:var(--red)">*</span></label>
        <input id="nef-id" class="cell-input" placeholder="${esc(type)}_01" autocomplete="off" />
        <div id="nef-id-error" class="form-error"></div>
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-nome">Nome <span style="color:var(--red)">*</span></label>
        <input id="nef-nome" class="cell-input" placeholder="Nome" />
        <div id="nef-nome-error" class="form-error"></div>
      </div>
    </div>`;
  if (type === 'pessoa')  return idRow + buildPessoaForm();
  if (type === 'empresa') return idRow + buildEmpresaForm();
  return idRow + buildEstadoForm();
}

function buildPessoaForm() {
  const classes  = config ? (config.classes.classes || []) : [];
  const estados  = world.estados;
  const classOpts = classes.map(c =>
    `<option value="${esc(c.id)}">${esc(c.nome)}</option>`
  ).join('') || '<option value="trabalhador">Trabalhador</option>';
  const estadoOpts = estados.map(s =>
    `<option value="${esc(s.id)}">${esc(s.nome || s.id)}</option>`
  ).join('');
  return `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-classe">Classe</label>
        <select id="nef-classe" class="cell-input">${classOpts}</select>
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-estado">Estado</label>
        <select id="nef-estado" class="cell-input">
          <option value="">— nenhum —</option>
          ${estadoOpts}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-influencia">Influência</label>
        <input id="nef-influencia" class="cell-input num" type="number" min="0" max="5" step="1" value="1" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-patrimonio">Patrimônio</label>
        <input id="nef-patrimonio" class="cell-input num" type="number" min="0" step="1" value="1" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-moral">Moral</label>
        <input id="nef-moral" class="cell-input num" type="number" min="0" max="5" step="1" value="3" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-reputacao">Reputação</label>
        <input id="nef-reputacao" class="cell-input num" type="number" min="0" max="5" step="1" value="1" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-renda">Renda Mensal</label>
        <input id="nef-renda" class="cell-input num" type="number" min="0" step="100" value="0" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-caixa">Caixa</label>
        <input id="nef-caixa" class="cell-input num" type="number" step="100" value="0" />
      </div>
    </div>
    <p class="form-section-label">Gastos mensais pagos:</p>
    <div class="form-row">
      <div class="form-group form-group-inline">
        <input type="checkbox" id="nef-gasto-infl" checked />
        <label class="form-label" for="nef-gasto-infl">Influência</label>
      </div>
      <div class="form-group form-group-inline">
        <input type="checkbox" id="nef-gasto-moral" checked />
        <label class="form-label" for="nef-gasto-moral">Moral</label>
      </div>
      <div class="form-group form-group-inline">
        <input type="checkbox" id="nef-gasto-rep" checked />
        <label class="form-label" for="nef-gasto-rep">Reputação</label>
      </div>
    </div>`;
}

function buildEmpresaForm() {
  const pessoas  = world.pessoas;
  const estados  = world.estados;
  const pessoaOpts = pessoas.map(p =>
    `<option value="${esc(p.id)}">${esc(p.nome || p.id)}</option>`
  ).join('');
  const estadoOpts = estados.map(s =>
    `<option value="${esc(s.id)}">${esc(s.nome || s.id)}</option>`
  ).join('');
  return `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-dono">Dono</label>
        <select id="nef-dono" class="cell-input">
          <option value="">— nenhum —</option>
          ${pessoaOpts}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-estado">Estado</label>
        <select id="nef-estado" class="cell-input">
          <option value="">— nenhum —</option>
          ${estadoOpts}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-patrimonio">Patrimônio</label>
        <input id="nef-patrimonio" class="cell-input num" type="number" min="0" step="1000" value="0" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-funcionarios">Funcionários</label>
        <input id="nef-funcionarios" class="cell-input num" type="number" min="0" step="1" value="0" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-renda">Renda</label>
        <input id="nef-renda" class="cell-input num" type="number" min="0" step="100" value="0" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-producao">Produção</label>
        <input id="nef-producao" class="cell-input num" type="number" min="0" step="1" value="0" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-moral-corp">Moral Corp.</label>
        <input id="nef-moral-corp" class="cell-input num" type="number" min="0" max="5" step="0.1" value="3" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-rep-corp">Reputação Corp.</label>
        <input id="nef-rep-corp" class="cell-input num" type="number" min="0" max="5" step="0.1" value="3" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-lucro">Lucro</label>
        <input id="nef-lucro" class="cell-input num" type="number" step="100" value="0" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-salario">Salário/Func.</label>
        <input id="nef-salario" class="cell-input num" type="number" min="0" step="100" value="0" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-manut">Manutenção</label>
        <input id="nef-manut" class="cell-input num" type="number" min="0" step="100" value="0" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-insumos">Insumos</label>
        <input id="nef-insumos" class="cell-input num" type="number" min="0" step="100" value="0" />
      </div>
    </div>`;
}

function buildEstadoForm() {
  const estados    = world.estados;
  const parentOpts = estados.map(s =>
    `<option value="${esc(s.id)}">${esc(s.nome || s.id)}</option>`
  ).join('');
  return `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-tipo">Tipo</label>
        <input id="nef-tipo" class="cell-input" list="tipo-options" placeholder="ex: municipio, pais, estado…" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-parent">Estado pai</label>
        <select id="nef-parent" class="cell-input">
          <option value="">— sem pai (raiz) —</option>
          ${parentOpts}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-descricao">Descrição</label>
        <input id="nef-descricao" class="cell-input" placeholder="Descrição opcional" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-populacao">População</label>
        <input id="nef-populacao" class="cell-input num" type="number" min="0" step="1000" value="0" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-patrimonio">Patrimônio</label>
        <input id="nef-patrimonio" class="cell-input num" type="number" min="0" step="1000" value="0" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-fa">Forças Arm.</label>
        <input id="nef-fa" class="cell-input num" type="number" min="0" max="5" step="0.1" value="1" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-cultura">Cultura</label>
        <input id="nef-cultura" class="cell-input num" type="number" min="0" max="5" step="0.1" value="1" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-moral-pop">Moral Pop.</label>
        <input id="nef-moral-pop" class="cell-input num" type="number" min="0" max="5" step="0.1" value="3" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-renda-trib">Renda Tributária</label>
        <input id="nef-renda-trib" class="cell-input num" type="number" min="0" step="1000" value="0" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-ir-pf">IR PF (0–1)</label>
        <input id="nef-ir-pf" class="cell-input num" type="number" min="0" max="1" step="0.01" value="0.1" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-ir-pj">IR PJ (0–1)</label>
        <input id="nef-ir-pj" class="cell-input num" type="number" min="0" max="1" step="0.01" value="0.1" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-imp-prod">Imp. Prod. (0–1)</label>
        <input id="nef-imp-prod" class="cell-input num" type="number" min="0" max="1" step="0.01" value="0.05" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-sal-pol">Sal. Políticos</label>
        <input id="nef-sal-pol" class="cell-input num" type="number" min="0" step="1000" value="0" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-incent-emp">Incent. Emp.</label>
        <input id="nef-incent-emp" class="cell-input num" type="number" min="0" step="1000" value="0" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-inv-cultura">Inv. Cultura</label>
        <input id="nef-inv-cultura" class="cell-input num" type="number" min="0" step="1000" value="0" />
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-inv-fa">Inv. FA</label>
        <input id="nef-inv-fa" class="cell-input num" type="number" min="0" step="1000" value="0" />
      </div>
    </div>`;
}

function bindAddEntityFormEvents(type) {
  const idInput = document.getElementById('nef-id');
  idInput.addEventListener('input', () => {
    const err = validateNewEntityId(idInput.value.trim(), type);
    document.getElementById('nef-id-error').textContent = err || '';
  });
  if (type === 'pessoa') {
    const classeEl = document.getElementById('nef-classe');
    classeEl.addEventListener('change', () => prefillPessoaAtributos(classeEl.value));
    prefillPessoaAtributos(classeEl.value);
  }
}

function prefillPessoaAtributos(classeId) {
  if (!config) return;
  const classe = (config.classes.classes || []).find(c => c.id === classeId);
  if (!classe || !classe.limites_atributos) return;
  const lim = classe.limites_atributos;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('nef-influencia', lim.influencia ? lim.influencia.min : 1);
  set('nef-patrimonio', lim.patrimonio ? lim.patrimonio.min : 1);
  set('nef-moral',      lim.moral      ? lim.moral.min      : 3);
  set('nef-reputacao',  lim.reputacao  ? lim.reputacao.min  : 1);
}

function saveNewEntity() {
  const type = addEntityType;
  const id   = document.getElementById('nef-id').value.trim();
  const nome = document.getElementById('nef-nome').value.trim();

  const idErr = validateNewEntityId(id, type);
  if (idErr) {
    document.getElementById('nef-id-error').textContent = idErr;
    document.getElementById('nef-id').focus();
    return;
  }
  if (!nome) {
    document.getElementById('nef-nome-error').textContent = 'Nome é obrigatório.';
    document.getElementById('nef-nome').focus();
    return;
  }

  if (type === 'pessoa') {
    const patrimonio = parseFloat(document.getElementById('nef-patrimonio').value) || 1;
    world.pessoas.push({
      id,
      nome,
      classe:    document.getElementById('nef-classe').value,
      estado_id: document.getElementById('nef-estado').value,
      atributos: {
        influencia: parseFloat(document.getElementById('nef-influencia').value) || 1,
        patrimonio,
        moral:      parseFloat(document.getElementById('nef-moral').value)      || 3,
        reputacao:  parseFloat(document.getElementById('nef-reputacao').value)  || 1,
      },
      renda_mensal: parseFloat(document.getElementById('nef-renda').value)  || 0,
      caixa:        parseFloat(document.getElementById('nef-caixa').value)  || 0,
      gastos_mensais_pagos: {
        influencia: document.getElementById('nef-gasto-infl').checked,
        moral:      document.getElementById('nef-gasto-moral').checked,
        reputacao:  document.getElementById('nef-gasto-rep').checked,
      },
      ativos: { patrimonio_geral: patrimonio },
    });
    renderPessoasTable();
  } else if (type === 'empresa') {
    const patrimonio = parseFloat(document.getElementById('nef-patrimonio').value) || 0;
    world.empresas.push({
      id,
      nome,
      dono_id:   document.getElementById('nef-dono').value,
      estado_id: document.getElementById('nef-estado').value,
      patrimonio,
      atributos: {
        funcionarios:          parseFloat(document.getElementById('nef-funcionarios').value) || 0,
        renda:                 parseFloat(document.getElementById('nef-renda').value)        || 0,
        producao:              parseFloat(document.getElementById('nef-producao').value)     || 0,
        moral_corporativa:     parseFloat(document.getElementById('nef-moral-corp').value)  || 3,
        reputacao_corporativa: parseFloat(document.getElementById('nef-rep-corp').value)    || 3,
        lucro:                 parseFloat(document.getElementById('nef-lucro').value)        || 0,
      },
      custos: {
        salario_funcionario: parseFloat(document.getElementById('nef-salario').value) || 0,
        manutencao:          parseFloat(document.getElementById('nef-manut').value)   || 0,
        insumos:             parseFloat(document.getElementById('nef-insumos').value) || 0,
      },
      ativos: { patrimonio_geral: patrimonio },
    });
    renderEmpresasTable();
  } else if (type === 'estado') {
    const parentId = document.getElementById('nef-parent').value;
    if (parentId && parentId === id) {
      document.getElementById('nef-id-error').textContent = 'Um estado não pode ser seu próprio pai.';
      document.getElementById('nef-id').focus();
      return;
    }
    const estadoIds = new Set(world.estados.map(s => s.id));
    if (parentId && !estadoIds.has(parentId)) {
      setStatus(`⚠ parent_id "${parentId}" não encontrado entre os estados carregados.`);
    }
    const patrimonio = parseFloat(document.getElementById('nef-patrimonio').value) || 0;
    world.estados.push({
      id,
      nome,
      tipo:      document.getElementById('nef-tipo').value.trim(),
      parent_id: parentId,
      descricao: document.getElementById('nef-descricao').value.trim(),
      patrimonio,
      atributos: {
        populacao:       parseFloat(document.getElementById('nef-populacao').value)  || 0,
        forcas_armadas:  parseFloat(document.getElementById('nef-fa').value)         || 1,
        cultura:         parseFloat(document.getElementById('nef-cultura').value)    || 1,
        moral_populacao: parseFloat(document.getElementById('nef-moral-pop').value)  || 3,
      },
      impostos: {
        ir_pf:    parseFloat(document.getElementById('nef-ir-pf').value)    || 0,
        ir_pj:    parseFloat(document.getElementById('nef-ir-pj').value)    || 0,
        imp_prod: parseFloat(document.getElementById('nef-imp-prod').value) || 0,
      },
      financas: {
        renda_tributaria:     parseFloat(document.getElementById('nef-renda-trib').value)   || 0,
        salarios_politicos:   parseFloat(document.getElementById('nef-sal-pol').value)      || 0,
        incentivos_empresas:  parseFloat(document.getElementById('nef-incent-emp').value)   || 0,
        investimento_cultura: parseFloat(document.getElementById('nef-inv-cultura').value)  || 0,
        investimento_fa:      parseFloat(document.getElementById('nef-inv-fa').value)       || 0,
      },
      ativos: { patrimonio_geral: patrimonio },
    });
    renderEstadosTable();
  }

  closeAddEntityModal();
  const typeLabel = type === 'pessoa' ? 'Pessoa' : type === 'empresa' ? 'Empresa' : 'Estado';
  setStatus(`✅ ${typeLabel} "${id}" adicionado(a).`);
}

document.getElementById('btn-add-entity-save').addEventListener('click', saveNewEntity);
document.getElementById('btn-add-entity-cancel').addEventListener('click', closeAddEntityModal);
document.getElementById('modal-add-entity').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-add-entity')) closeAddEntityModal();
});

document.getElementById('btn-add-pessoa').addEventListener('click', async () => {
  await loadConfig();
  openAddEntityModal('pessoa');
});
document.getElementById('btn-add-empresa').addEventListener('click', async () => {
  await loadConfig();
  openAddEntityModal('empresa');
});
document.getElementById('btn-add-estado').addEventListener('click', () => {
  openAddEntityModal('estado');
});

// ── Initialise ────────────────────────────────────────────────────────────────
updateTickCounter();
populateInjectionEntitySelect();
renderInjectionsList();
