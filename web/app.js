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
      <th>Ativos</th>
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
      <th>Ativos</th>
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
      <th>ID</th><th>Nome</th><th>Patrimônio</th>
      <th>Populacão</th><th>Forças Arm.</th><th>Cultura</th><th>Moral Pop.</th>
      <th>Renda Trib.</th><th>IR PF</th><th>IR PJ</th><th>Imp. Prod.</th>
      <th>Sal. Pol.</th><th>Incent. Emp.</th><th>Inv. Cultura</th><th>Inv. FA</th>
      <th>Ativos</th>
    </tr></thead>
    <tbody>`;

  for (const [i, est] of s.entries()) {
    html += `<tr>
      <td class="id-cell">${esc(est.id)}</td>
      <td><input class="cell-input" data-entity="estado" data-idx="${i}" data-field="nome" value="${esc(est.nome)}" /></td>
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

// ── Add Entity Modal ──────────────────────────────────────────────────────────
let addEntityType = null;

/** Open the add-entity modal for the given type ('pessoa'|'empresa'|'estado'). */
async function openAddModal(type) {
  addEntityType = type;
  try { await loadConfig(); } catch (err) { console.warn('config load failed (classes dropdown may be empty):', err); }
  const titles = { pessoa: '👤 Nova Pessoa', empresa: '🏢 Nova Empresa', estado: '🗺 Novo Estado' };
  document.getElementById('modal-add-title').textContent = titles[type] || '➕ Nova Entidade';
  const errEl = document.getElementById('modal-add-error');
  errEl.style.display = 'none';
  errEl.textContent = '';
  renderAddForm(type);
  document.getElementById('modal-add').classList.add('open');
  // Focus the ID field for quick keyboard entry
  setTimeout(() => document.getElementById('add-id')?.focus(), 50);
}

/** Build the inner form HTML for the given entity type. */
function renderAddForm(type) {
  const estadosOpts = world.estados
    .map(s => `<option value="${esc(s.id)}">${esc(s.nome || s.id)}</option>`)
    .join('');
  const pessoasOpts = world.pessoas
    .map(p => `<option value="${esc(p.id)}">${esc(p.nome || p.id)} (${esc(p.classe)})</option>`)
    .join('');
  const classesOpts = (config?.classes?.classes ?? [])
    .map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`)
    .join('') || '<option value="trabalhador">Trabalhador</option>';

  let html = '';

  if (type === 'pessoa') {
    html = `<div class="add-form-grid">
      <div class="add-form-field">
        <label for="add-id">ID <span class="required">*</span></label>
        <input id="add-id" class="cell-input" placeholder="ex: pessoa_01" autocomplete="off" />
        <small style="color:var(--muted);font-size:0.7rem">Letras, números, _ e - apenas</small>
      </div>
      <div class="add-form-field">
        <label for="add-nome">Nome <span class="required">*</span></label>
        <input id="add-nome" class="cell-input" placeholder="ex: João Silva" autocomplete="off" />
      </div>
      <div class="add-form-field">
        <label for="add-classe">Classe <span class="required">*</span></label>
        <select id="add-classe">${classesOpts}</select>
      </div>
      <div class="add-form-field">
        <label for="add-estado-id">Estado</label>
        <select id="add-estado-id"><option value="">— nenhum —</option>${estadosOpts}</select>
      </div>
      <div class="add-form-field">
        <label for="add-influencia">Influência</label>
        <input id="add-influencia" class="cell-input num" type="number" min="1" max="5" step="1" value="1" />
      </div>
      <div class="add-form-field">
        <label for="add-patrimonio">Patrimônio</label>
        <input id="add-patrimonio" class="cell-input num" type="number" min="0" value="1" />
      </div>
      <div class="add-form-field">
        <label for="add-moral">Moral</label>
        <input id="add-moral" class="cell-input num" type="number" min="1" max="5" step="1" value="3" />
      </div>
      <div class="add-form-field">
        <label for="add-reputacao">Reputação</label>
        <input id="add-reputacao" class="cell-input num" type="number" min="1" max="5" step="1" value="1" />
      </div>
      <div class="add-form-field">
        <label for="add-renda-mensal">Renda Mensal</label>
        <input id="add-renda-mensal" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-caixa">Caixa</label>
        <input id="add-caixa" class="cell-input num" type="number" value="0" />
      </div>
      <div class="add-form-field add-form-full">
        <label>Gastos mensais pagos</label>
        <div class="add-form-checks">
          <label><input type="checkbox" id="add-gastos-influencia" checked /> Influência</label>
          <label><input type="checkbox" id="add-gastos-moral"      checked /> Moral</label>
          <label><input type="checkbox" id="add-gastos-reputacao"  checked /> Reputação</label>
        </div>
      </div>
    </div>`;

  } else if (type === 'empresa') {
    html = `<div class="add-form-grid">
      <div class="add-form-field">
        <label for="add-id">ID <span class="required">*</span></label>
        <input id="add-id" class="cell-input" placeholder="ex: empresa_01" autocomplete="off" />
        <small style="color:var(--muted);font-size:0.7rem">Letras, números, _ e - apenas</small>
      </div>
      <div class="add-form-field">
        <label for="add-nome">Nome <span class="required">*</span></label>
        <input id="add-nome" class="cell-input" placeholder="ex: Empresa XYZ" autocomplete="off" />
      </div>
      <div class="add-form-field">
        <label for="add-dono-id">Dono (Pessoa)</label>
        <select id="add-dono-id"><option value="">— nenhum —</option>${pessoasOpts}</select>
      </div>
      <div class="add-form-field">
        <label for="add-estado-id">Estado</label>
        <select id="add-estado-id"><option value="">— nenhum —</option>${estadosOpts}</select>
      </div>
      <div class="add-form-field">
        <label for="add-patrimonio">Patrimônio</label>
        <input id="add-patrimonio" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-funcionarios">Funcionários</label>
        <input id="add-funcionarios" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-renda">Renda</label>
        <input id="add-renda" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-producao">Produção</label>
        <input id="add-producao" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-moral-corp">Moral Corporativa</label>
        <input id="add-moral-corp" class="cell-input num" type="number" min="0" max="5" step="0.1" value="3" />
      </div>
      <div class="add-form-field">
        <label for="add-rep-corp">Reputação Corp.</label>
        <input id="add-rep-corp" class="cell-input num" type="number" min="0" max="5" step="0.1" value="3" />
      </div>
      <div class="add-form-field">
        <label for="add-lucro">Lucro</label>
        <input id="add-lucro" class="cell-input num" type="number" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-salario-func">Salário Funcionário</label>
        <input id="add-salario-func" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-manutencao">Manutenção</label>
        <input id="add-manutencao" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-insumos">Insumos</label>
        <input id="add-insumos" class="cell-input num" type="number" min="0" value="0" />
      </div>
    </div>`;

  } else if (type === 'estado') {
    html = `<div class="add-form-grid">
      <div class="add-form-field">
        <label for="add-id">ID <span class="required">*</span></label>
        <input id="add-id" class="cell-input" placeholder="ex: estado_01" autocomplete="off" />
        <small style="color:var(--muted);font-size:0.7rem">Letras, números, _ e - apenas</small>
      </div>
      <div class="add-form-field">
        <label for="add-nome">Nome <span class="required">*</span></label>
        <input id="add-nome" class="cell-input" placeholder="ex: São Paulo" autocomplete="off" />
      </div>
      <div class="add-form-field">
        <label for="add-patrimonio">Patrimônio</label>
        <input id="add-patrimonio" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-populacao">População</label>
        <input id="add-populacao" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-fa">Forças Armadas</label>
        <input id="add-fa" class="cell-input num" type="number" min="0" max="5" step="0.1" value="1" />
      </div>
      <div class="add-form-field">
        <label for="add-cultura">Cultura</label>
        <input id="add-cultura" class="cell-input num" type="number" min="0" max="5" step="0.1" value="1" />
      </div>
      <div class="add-form-field">
        <label for="add-moral-pop">Moral Pop.</label>
        <input id="add-moral-pop" class="cell-input num" type="number" min="0" max="5" step="0.1" value="3" />
      </div>
      <div class="add-form-field">
        <label for="add-renda-trib">Renda Tributária</label>
        <input id="add-renda-trib" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-ir-pf">IR PF (0–1)</label>
        <input id="add-ir-pf" class="cell-input num" type="number" min="0" max="1" step="0.01" value="0.15" />
      </div>
      <div class="add-form-field">
        <label for="add-ir-pj">IR PJ (0–1)</label>
        <input id="add-ir-pj" class="cell-input num" type="number" min="0" max="1" step="0.01" value="0.20" />
      </div>
      <div class="add-form-field">
        <label for="add-imp-prod">Imp. Prod. (0–1)</label>
        <input id="add-imp-prod" class="cell-input num" type="number" min="0" max="1" step="0.01" value="0.10" />
      </div>
      <div class="add-form-field">
        <label for="add-sal-pol">Salários Políticos</label>
        <input id="add-sal-pol" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-incent-emp">Incentivos Empresas</label>
        <input id="add-incent-emp" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-inv-cultura">Inv. Cultura</label>
        <input id="add-inv-cultura" class="cell-input num" type="number" min="0" value="0" />
      </div>
      <div class="add-form-field">
        <label for="add-inv-fa">Inv. FA</label>
        <input id="add-inv-fa" class="cell-input num" type="number" min="0" value="0" />
      </div>
    </div>`;
  }

  document.getElementById('modal-add-form').innerHTML = html;

  // Allow pressing Enter in any text input to submit
  document.getElementById('modal-add-form').querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') saveAddModal(); });
  });
}

/** Read a numeric field; return fallback if missing or NaN. */
function getAddNum(id, fallback = 0) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : fallback;
}

/** Show inline error in the add-entity modal. */
function showAddError(msg) {
  const el = document.getElementById('modal-add-error');
  el.textContent = msg;
  el.style.display = 'block';
}

/** Validate inputs, build the entity object, push to world and re-render. */
function saveAddModal() {
  const errEl = document.getElementById('modal-add-error');
  errEl.style.display = 'none';

  // ── Read & validate ID ──────────────────────────────────────────────────
  const rawId = (document.getElementById('add-id')?.value ?? '').trim();
  // Only allow letters, digits, underscores and hyphens (consistent with CSV key conventions)
  if (rawId && !/^[a-zA-Z0-9_-]+$/.test(rawId)) {
    showAddError('ID pode conter apenas letras, números, underscores (_) e hífens (-).');
    document.getElementById('add-id')?.focus();
    return;
  }
  const id = rawId;

  const nome = (document.getElementById('add-nome')?.value ?? '').trim();

  // ── Required field validation ────────────────────────────────────────────
  if (!id) { showAddError('ID é obrigatório e não pode ser vazio.'); document.getElementById('add-id')?.focus(); return; }
  if (!nome) { showAddError('Nome é obrigatório.'); document.getElementById('add-nome')?.focus(); return; }

  // ── Unique ID check ──────────────────────────────────────────────────────
  const arr = getEntityArray(addEntityType);
  if (arr.some(x => x.id === id)) {
    showAddError(`ID "${id}" já existe nesta lista. Escolha um ID único.`);
    document.getElementById('add-id')?.focus();
    return;
  }

  // ── Build entity object ──────────────────────────────────────────────────
  let entity;

  if (addEntityType === 'pessoa') {
    const classe     = document.getElementById('add-classe')?.value || 'trabalhador';
    const patrimonio = getAddNum('add-patrimonio', 1);
    entity = {
      id,
      nome,
      classe,
      estado_id: document.getElementById('add-estado-id')?.value || '',
      atributos: {
        influencia: getAddNum('add-influencia', 1),
        patrimonio,
        moral:      getAddNum('add-moral', 3),
        reputacao:  getAddNum('add-reputacao', 1),
      },
      renda_mensal: getAddNum('add-renda-mensal', 0),
      caixa:        getAddNum('add-caixa', 0),
      gastos_mensais_pagos: {
        influencia: document.getElementById('add-gastos-influencia')?.checked ?? true,
        moral:      document.getElementById('add-gastos-moral')?.checked ?? true,
        reputacao:  document.getElementById('add-gastos-reputacao')?.checked ?? true,
      },
      ativos: { patrimonio_geral: patrimonio },
    };

  } else if (addEntityType === 'empresa') {
    const patrimonio = getAddNum('add-patrimonio', 0);
    entity = {
      id,
      nome,
      dono_id:   document.getElementById('add-dono-id')?.value   || '',
      estado_id: document.getElementById('add-estado-id')?.value || '',
      patrimonio,
      atributos: {
        funcionarios:          getAddNum('add-funcionarios', 0),
        renda:                 getAddNum('add-renda', 0),
        producao:              getAddNum('add-producao', 0),
        moral_corporativa:     getAddNum('add-moral-corp', 3),
        reputacao_corporativa: getAddNum('add-rep-corp', 3),
        lucro:                 getAddNum('add-lucro', 0),
      },
      custos: {
        salario_funcionario: getAddNum('add-salario-func', 0),
        manutencao:          getAddNum('add-manutencao', 0),
        insumos:             getAddNum('add-insumos', 0),
      },
      ativos: { patrimonio_geral: patrimonio },
    };

  } else if (addEntityType === 'estado') {
    const patrimonio = getAddNum('add-patrimonio', 0);
    entity = {
      id,
      nome,
      patrimonio,
      atributos: {
        populacao:       getAddNum('add-populacao', 0),
        forcas_armadas:  getAddNum('add-fa', 1),
        cultura:         getAddNum('add-cultura', 1),
        moral_populacao: getAddNum('add-moral-pop', 3),
      },
      impostos: {
        ir_pf:    getAddNum('add-ir-pf', 0.15),
        ir_pj:    getAddNum('add-ir-pj', 0.20),
        imp_prod: getAddNum('add-imp-prod', 0.10),
      },
      financas: {
        renda_tributaria:     getAddNum('add-renda-trib', 0),
        salarios_politicos:   getAddNum('add-sal-pol', 0),
        incentivos_empresas:  getAddNum('add-incent-emp', 0),
        investimento_cultura: getAddNum('add-inv-cultura', 0),
        investimento_fa:      getAddNum('add-inv-fa', 0),
      },
      ativos: { patrimonio_geral: patrimonio },
    };
  }

  if (!entity) return;

  arr.push(entity);

  if (addEntityType === 'pessoa')  renderPessoasTable();
  if (addEntityType === 'empresa') renderEmpresasTable();
  if (addEntityType === 'estado')  renderEstadosTable();

  closeAddModal();
  setStatus(`✅ ${addEntityType} "${esc(nome)}" adicionado(a) com sucesso.`);
}

function closeAddModal() {
  document.getElementById('modal-add').classList.remove('open');
  addEntityType = null;
}

document.getElementById('btn-add-pessoa').addEventListener('click', () => openAddModal('pessoa'));
document.getElementById('btn-add-empresa').addEventListener('click', () => openAddModal('empresa'));
document.getElementById('btn-add-estado').addEventListener('click', () => openAddModal('estado'));

document.getElementById('btn-modal-add-save').addEventListener('click', saveAddModal);
document.getElementById('btn-modal-add-cancel').addEventListener('click', closeAddModal);
document.getElementById('modal-add').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-add')) closeAddModal();
});

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

// ── Initialise ────────────────────────────────────────────────────────────────
updateTickCounter();
populateInjectionEntitySelect();
renderInjectionsList();
