/**
 * app.js — Browser entry point for the Mini Economic Model Manager.
 *
 * Architecture:
 *  - `world` object is the single source of truth (mutated in place by the engine).
 *  - HTML tables are rendered FROM the world object and re-rendered after each change.
 *  - Persistence: SQLite via sql.js, stored in IndexedDB (see src/core/db.js).
 *  - CSV export still available as a backup/interop utility.
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
  worldAtivosToRows, reconcilePatrimonio,
} from '../src/core/world.js';
import {
  getDb, loadWorldFromDb, saveWorldToDb,
  scheduleAutoSave, exportDbFile, importDbFromBuffer, resetDb,
} from '../src/core/db.js';
import {
  tickMensal,
  applyScheduledConversions, applyScheduledInjections,
  EMPRESA_CONVERSIONS, ESTADO_CONVERSIONS, getPessoaConversions,
  transferFundos, transferPatrimonio,
} from '../src/core/engine.js';
import {
  getCurrentTick, setCurrentTick, advanceTick,
  scheduleConversion, unscheduleConversion, getAllScheduledConversions, getConversionsForTick, clearConversionsForTick,
  scheduleInjection, removeInjection, getAllScheduledInjections, getInjectionsForTick, clearInjectionsForTick,
  removeAllConversionsForEntity, removeAllInjectionsForEntity,
} from '../src/core/scheduler.js';
import { getCell, setCell, clearCell, findCellsByEstado, rowsToMapa, mapaToRows } from '../src/core/map.js';
import {
  SCOUTS_ATAQUE, SCOUTS_DEFESA,
  calcMatchScore, calcNewAverage, calcNewMarketValue,
} from '../src/core/scouts.js';
import { simulateEconomy, simulateEconomyBySegment, SEGMENTO, SEGMENTO_META, SEGMENTO_DEMAND_PARAMS, STATUS_ECONOMICO, SETOR_ECONOMICO } from '../src/core/economy.js';

// ── App state ──────────────────────────────────────────────────────────────
let world  = { pessoas: [], empresas: [], estados: [] };
let config = null;
let db     = null;   // sql.js Database singleton (set in initApp)

// Which entity type is showing in the conversion matrix
let scheduleEntityType = 'pessoa';

// Ativos modal state
let modalEntityType = null;
let modalEntityId   = null;
let modalAtivos     = {};

// Scouts modal state
let scoutModalPessoaId = null;
let scoutCounts        = {};

// ── Map state ──────────────────────────────────────────────────────────────
let mapaWorld  = {};          // sparse map data (lat → lon → cell)
let mapaConfig = null;        // { biomas: string[], climas: string[] }

// ── Table sort state ───────────────────────────────────────────────────────
// by: 'nome' | 'patrimonio'  dir: 1 = ascending, -1 = descending
let tableSorts = {
  pessoas:   { by: 'nome', dir: 1 },
  empresas:  { by: 'nome', dir: 1 },
  estados:   { by: 'nome', dir: 1 },
  jogadores: { by: 'nome', dir: 1 },
};

// Jogadores club filter state
let jogadoresClubeFilter = '';

// Show/hide archived entities across all tables
let mostrarArquivados = false;

// Viewport: center + dimensions (columns = lon count, rows = lat count) + cell pixel size
let mapaVp = { latCenter: 0, lonCenter: 0, rows: 30, cols: 60, cellSize: 12 };

// Brush state
let mapaBrushDown   = false;  // is mouse button held on the grid?
let mapaDragMoved   = false;  // did the pointer move while held?
let mapaSelectedCell = null;  // { lat, lon } of currently selected cell for editor
let mapaBrushValues  = { tipo: '', estado_id: '', bioma: '', clima: '' };
let mapaBrushLocks   = { tipo: true, estado_id: false, bioma: false, clima: false };
let mapaEraserMode   = false;

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

// ── Tick ↔ Date helpers ───────────────────────────────────────────────────────
// Tick 1 = January 1850. Each tick represents one month.
const TICK_EPOCH_YEAR = 1850;

/** Convert a tick number (≥1) to {month, year}. Tick 1 = Jan 1850. */
function tickToDate(tick) {
  const offset = Math.max(0, tick - 1);
  return { month: (offset % 12) + 1, year: TICK_EPOCH_YEAR + Math.floor(offset / 12) };
}

/** Convert month (1–12) and year (≥1850) to a tick number. */
function dateToTick(month, year) {
  return (year - TICK_EPOCH_YEAR) * 12 + month;
}

/** Format a tick as "M/YYYY" string, or "—" if zero/unset. */
function tickLabel(tick) {
  if (!tick || tick <= 0) return '—';
  const { month, year } = tickToDate(tick);
  return `${month}/${year}`;
}

/** Read the scheduled-conversion target tick from the month+year inputs. */
function getSchedTick() {
  const m = Math.min(12, Math.max(1, parseInt(document.getElementById('sched-tick-month').value) || 1));
  const y = Math.max(TICK_EPOCH_YEAR, parseInt(document.getElementById('sched-tick-year').value) || TICK_EPOCH_YEAR);
  return dateToTick(m, y);
}

/** Read the injection target tick from the month+year inputs. */
function getInjTick() {
  const m = Math.min(12, Math.max(1, parseInt(document.getElementById('inj-tick-month').value) || 1));
  const y = Math.max(TICK_EPOCH_YEAR, parseInt(document.getElementById('inj-tick-year').value) || TICK_EPOCH_YEAR);
  return dateToTick(m, y);
}

function updateTickCounter() {
  document.getElementById('tick-counter').textContent = tickLabel(getCurrentTick());
}

// ── Tab navigation ──────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'agendamento') renderScheduleTab();
    if (btn.dataset.tab === 'mapa')        initMapaTab();
    if (btn.dataset.tab === 'jogadores')   renderJogadoresTable();
    if (btn.dataset.tab === 'elenco')      renderElencoTab();
    if (btn.dataset.tab === 'transferencias') populateJogadorTransferSelects();
    if (btn.dataset.tab === 'simulacao')   renderSimulacaoTab();
  });
});

document.getElementById('toggle-mostrar-arquivados').addEventListener('change', e => {
  mostrarArquivados = e.target.checked;
  renderPessoasTable();
  renderEmpresasTable();
  renderEstadosTable();
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

// ── SQLite persistence helper ───────────────────────────────────────────────
/**
 * Write current world to SQLite and schedule a debounced IndexedDB persist.
 * Call this after any mutation to world.pessoas / empresas / estados.
 */
function triggerSave() {
  if (!db) return;
  saveWorldToDb(db, world);
  scheduleAutoSave(db);
}

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
    triggerSave();
    setStatus(`✅ ${tickLabel(tick)} concluído → agora em ${tickLabel(newTick)}`);
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

  setStatus('⬇ CSVs exportados (backup interop).');
});

// ── Export SQLite backup ────────────────────────────────────────────────────
document.getElementById('btn-export-db')?.addEventListener('click', () => {
  if (!db) { setStatus('⚠ Banco de dados não inicializado.'); return; }
  exportDbFile(db);
  setStatus('💾 Backup SQLite exportado.');
});

// ── Import SQLite backup ────────────────────────────────────────────────────
document.getElementById('file-import-db')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';   // reset so same file can be re-selected

  if (!window.confirm(
    `Importar backup "${file.name}"?\n` +
    'ATENÇÃO: todos os dados atuais serão substituídos pelo conteúdo do backup. ' +
    'A página será recarregada automaticamente.'
  )) return;

  setStatus('📂 Importando backup…');
  try {
    const buf   = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    await importDbFromBuffer(bytes);
    // importDbFromBuffer reloads the page — code below won't run on success
  } catch (err) {
    setStatus(`⚠ Erro ao importar backup: ${err.message}`);
    console.error('[import-db]', err);
  }
});

// ── Reset database ──────────────────────────────────────────────────────────
document.getElementById('btn-reset-db')?.addEventListener('click', async () => {
  if (!window.confirm('Resetar banco de dados?\nTodos os dados serão apagados permanentemente. A página será recarregada.')) return;
  setStatus('Apagando banco de dados…');
  try {
    await resetDb();
  } catch (err) {
    setStatus(`Erro ao resetar banco: ${err.message}`);
    console.error(err);
  }
});

// ── Render all tables ───────────────────────────────────────────────────────
function renderAll() {
  renderPessoasTable();
  renderEmpresasTable();
  renderEstadosTable();
  renderJogadoresTable();
  updateTickCounter();
  populateMapaEstadoSelects();
  populateTransferSelects();
  populateJogadorTransferSelects();
  renderElencoTab();
  populateSimulacaoEstadoSelect();
}

// ── Sorting helpers ────────────────────────────────────────────────────────

/**
 * Return a copy of an entity array sorted by the current sort state.
 * @param {Object[]} arr  array of entities
 * @param {'nome'|'patrimonio'} by
 * @param {1|-1} dir  1 = ascending, -1 = descending
 * @returns {Object[]}
 */
function sortedEntities(arr, by, dir) {
  return [...arr].sort((a, b) => {
    let va, vb;
    if (by === 'patrimonio') {
      va = a.patrimonio ?? a.atributos?.patrimonio ?? 0;
      vb = b.patrimonio ?? b.atributos?.patrimonio ?? 0;
      return dir * (va - vb);
    }
    if (by === 'nota_scouting' || by === 'valor_mercado') {
      va = a[by] ?? 0;
      vb = b[by] ?? 0;
      return dir * (va - vb);
    }
    va = (a.nome || a.id || '').toLocaleLowerCase('pt-BR');
    vb = (b.nome || b.id || '').toLocaleLowerCase('pt-BR');
    return dir * va.localeCompare(vb, 'pt-BR');
  });
}

/**
 * Build sort-header HTML for a column.
 * @param {string} label  display text
 * @param {'nome'|'patrimonio'} key
 * @param {'pessoas'|'empresas'|'estados'} tableKey
 * @returns {string}
 */
function sortHeader(label, key, tableKey) {
  const { by, dir } = tableSorts[tableKey];
  const arrow = by === key ? (dir === 1 ? ' ▲' : ' ▼') : '';
  return `<th class="sortable-th" data-sort-key="${esc(key)}" data-sort-table="${esc(tableKey)}" style="cursor:pointer">${esc(label)}${arrow}</th>`;
}

// Delegate sort-header clicks on any table container
document.addEventListener('click', e => {
  const th = e.target.closest('.sortable-th');
  if (!th) return;
  const key   = th.dataset.sortKey;
  const table = th.dataset.sortTable;
  if (!tableSorts[table]) return;
  const cur = tableSorts[table];
  if (cur.by === key) {
    cur.dir = cur.dir === 1 ? -1 : 1;
  } else {
    cur.by  = key;
    cur.dir = 1;
  }
  if (table === 'pessoas')   renderPessoasTable();
  if (table === 'empresas')  renderEmpresasTable();
  if (table === 'estados')   renderEstadosTable();
  if (table === 'jogadores') renderJogadoresTable();
});

// ── Pessoas table ────────────────────────────────────────────────────────────

/**
 * Build a <select> for status_economico for a given entity/index/value.
 * @param {string} entity  data-entity attribute value
 * @param {number} i       row index
 * @param {string} current current status_economico value (may be falsy → defaults to 'estagnacao')
 * @returns {string} HTML
 */
function statusEconomicoSelect(entity, i, current) {
  const v = current || 'estagnacao';
  return `<select class="cell-input" data-entity="${esc(entity)}" data-idx="${i}" data-field="status_economico" style="min-width:110px">
    <option value="recessao"${v === 'recessao' ? ' selected' : ''}>📉 Recessão</option>
    <option value="estagnacao"${v === 'estagnacao' ? ' selected' : ''}>➡ Estagnação</option>
    <option value="crescimento"${v === 'crescimento' ? ' selected' : ''}>📈 Crescimento</option>
  </select>`;
}

/**
 * Build a <select> for setor_economico for a given empresa entity/index/value.
 * @param {number} i       row index
 * @param {string} current current setor_economico value (may be falsy → defaults to 'servicos')
 * @returns {string} HTML
 */
function setorEconomicoSelect(i, current) {
  const v = current || 'servicos';
  return `<select class="cell-input" data-entity="empresa" data-idx="${i}" data-field="setor_economico" style="min-width:110px">
    <option value="agricola"${v === 'agricola' ? ' selected' : ''}>🌾 Agrícola</option>
    <option value="industrial"${v === 'industrial' ? ' selected' : ''}>🏭 Industrial</option>
    <option value="servicos"${v === 'servicos' ? ' selected' : ''}>🏢 Serviços</option>
  </select>`;
}

function renderPessoasTable() {
  const container = document.getElementById('table-pessoas');
  const p = world.pessoas;
  if (!p.length) {
    container.innerHTML = '<div class="empty-state">Nenhuma pessoa cadastrada. Use "+ Adicionar Pessoa" para criar.</div>';
    return;
  }

  const toShow = mostrarArquivados ? p : p.filter(x => !x.tick_saida);
  const { by, dir } = tableSorts.pessoas;
  const sorted = sortedEntities(toShow, by, dir);
  const idxMap = new Map(p.map((item, i) => [item, i]));

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state">Todos os registros estão arquivados. Marque "Mostrar arquivados" para visualizá-los.</div>';
    return;
  }

  let html = `<div class="table-wrap"><table>
    <thead><tr>
      <th>ID</th>
      ${sortHeader('Nome', 'nome', 'pessoas')}
      <th>Classe</th><th>Estado</th>
      <th>Status Econ.</th>
      <th>Influência</th>
      ${sortHeader('Patrimônio', 'patrimonio', 'pessoas')}
      <th>Moral</th><th>Reputação</th>
      <th>Renda Mensal</th><th>Caixa</th>
      <th>Gasto Infl.</th><th>Gasto Moral</th><th>Gasto Rep.</th>
      <th>Ativos</th><th>Registro</th><th>Saída</th><th>Ações</th>
    </tr></thead>
    <tbody>`;

  for (const pessoa of sorted) {
    const i = idxMap.get(pessoa);
    const isArchived = !!pessoa.tick_saida;
    const badgeClass = `badge-${pessoa.classe}`;
    html += `<tr${isArchived ? ' class="entity-archived"' : ''}>
      <td class="id-cell">${esc(pessoa.id)}</td>
      <td><input class="cell-input" data-entity="pessoa" data-idx="${i}" data-field="nome" value="${esc(pessoa.nome)}" /></td>
      <td>
        <select class="cell-input" data-entity="pessoa" data-idx="${i}" data-field="classe" style="min-width:110px">
          <option value="trabalhador"${pessoa.classe === 'trabalhador' ? ' selected' : ''}>Trabalhador</option>
          <option value="empresario"${pessoa.classe === 'empresario' ? ' selected' : ''}>Empresário</option>
          <option value="politico"${pessoa.classe === 'politico' ? ' selected' : ''}>Político</option>
          <option value="jogador"${pessoa.classe === 'jogador' ? ' selected' : ''}>Jogador</option>
        </select>
      </td>
      <td><input class="cell-input" data-entity="pessoa" data-idx="${i}" data-field="estado_id" value="${esc(pessoa.estado_id)}" style="width:90px" /></td>
      <td>${statusEconomicoSelect('pessoa', i, pessoa.status_economico)}</td>
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
      <td class="num" style="white-space:nowrap">${esc(tickLabel(pessoa.tick_registro))}</td>
      <td class="num" style="white-space:nowrap">${esc(tickLabel(pessoa.tick_saida))}</td>
      <td style="white-space:nowrap">
        ${isArchived
          ? `<button class="btn-ghost btn-sm btn-reactivate-entity" data-etype="pessoa" data-eid="${esc(pessoa.id)}">🔄 Reativar</button>`
          : `<button class="btn-ghost btn-sm btn-archive-entity"    data-etype="pessoa" data-eid="${esc(pessoa.id)}">📤 Arquivar</button>`
        }
        <button class="btn-red btn-sm btn-delete-entity" data-etype="pessoa" data-eid="${esc(pessoa.id)}">🗑 Excluir</button>
      </td>
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

  const toShow = mostrarArquivados ? e : e.filter(x => !x.tick_saida);
  const { by, dir } = tableSorts.empresas;
  const sorted = sortedEntities(toShow, by, dir);
  const idxMap = new Map(e.map((item, i) => [item, i]));

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state">Todos os registros estão arquivados. Marque "Mostrar arquivados" para visualizá-los.</div>';
    return;
  }

  let html = `<div class="table-wrap"><table>
    <thead><tr>
      <th>ID</th>
      ${sortHeader('Nome', 'nome', 'empresas')}
      <th>Segmento</th>
      <th>Setor Econ.</th>
      <th>Status Econ.</th>
      <th>Dono</th><th>Estado</th>
      ${sortHeader('Patrimônio', 'patrimonio', 'empresas')}
      <th>Funcionários</th><th>Renda</th><th>Produção</th>
      <th>Moral Corp.</th><th>Rep. Corp.</th><th>Lucro</th>
      <th>Sal. Func.</th><th>Manutenção</th><th>Insumos</th>
      <th>Ativos</th><th>Registro</th><th>Saída</th><th>Ações</th>
    </tr></thead>
    <tbody>`;

  for (const emp of sorted) {
    const i = idxMap.get(emp);
    const isArchived = !!emp.tick_saida;
    html += `<tr${isArchived ? ' class="entity-archived"' : ''}>
      <td class="id-cell">${esc(emp.id)}</td>
      <td><input class="cell-input" data-entity="empresa" data-idx="${i}" data-field="nome" value="${esc(emp.nome)}" /></td>
      <td>
        <select class="cell-input" data-entity="empresa" data-idx="${i}" data-field="segmento" style="min-width:130px">
          <option value="POP_NAO_DURAVEL"${emp.segmento === 'POP_NAO_DURAVEL' ? ' selected' : ''}>🟢 Pop. N-D</option>
          <option value="POP_DURAVEL"${emp.segmento === 'POP_DURAVEL' ? ' selected' : ''}>🔵 Pop. Dur.</option>
          <option value="B2B"${emp.segmento === 'B2B' ? ' selected' : ''}>🟡 B2B</option>
          <option value="ESTADO"${emp.segmento === 'ESTADO' ? ' selected' : ''}>⚫ Estado</option>
          <option value="CLUBE"${emp.segmento === 'CLUBE' ? ' selected' : ''}>⚽ Clube</option>
        </select>
      </td>
      <td>${setorEconomicoSelect(i, emp.setor_economico)}</td>
      <td>${statusEconomicoSelect('empresa', i, emp.status_economico)}</td>
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
      <td class="num" style="white-space:nowrap">${esc(tickLabel(emp.tick_registro))}</td>
      <td class="num" style="white-space:nowrap">${esc(tickLabel(emp.tick_saida))}</td>
      <td style="white-space:nowrap">
        ${isArchived
          ? `<button class="btn-ghost btn-sm btn-reactivate-entity" data-etype="empresa" data-eid="${esc(emp.id)}">🔄 Reativar</button>`
          : `<button class="btn-ghost btn-sm btn-archive-entity"    data-etype="empresa" data-eid="${esc(emp.id)}">📤 Arquivar</button>`
        }
        <button class="btn-red btn-sm btn-delete-entity" data-etype="empresa" data-eid="${esc(emp.id)}">🗑 Excluir</button>
      </td>
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

  const toShow = mostrarArquivados ? s : s.filter(x => !x.tick_saida);
  const { by, dir } = tableSorts.estados;
  const sorted = sortedEntities(toShow, by, dir);
  const idxMap = new Map(s.map((item, i) => [item, i]));

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state">Todos os registros estão arquivados. Marque "Mostrar arquivados" para visualizá-los.</div>';
    return;
  }

  // Pre-compute set of estado IDs that have at least one direct child
  const parentIds = new Set(s.filter(x => x.parent_id).map(x => x.parent_id));

  let html = `<div class="table-wrap"><table>
    <thead><tr>
      <th>ID</th>
      ${sortHeader('Nome', 'nome', 'estados')}
      <th>Tipo</th><th>Parent</th><th>Descrição</th>
      <th>Status Econ.</th>
      ${sortHeader('Patrimônio', 'patrimonio', 'estados')}
      <th>Populacão</th><th>Forças Arm.</th><th>Cultura</th><th>Moral Pop.</th>
      <th>Renda Trib.</th><th>IR PF</th><th>IR PJ</th><th>Imp. Prod.</th>
      <th>Sal. Pol.</th><th>Incent. Emp.</th><th>Inv. Cultura</th><th>Inv. FA</th>
      <th>Ativos</th><th>Registro</th><th>Saída</th><th>Ações</th>
    </tr></thead>
    <tbody>`;

  for (const est of sorted) {
    const i = idxMap.get(est);
    const isArchived  = !!est.tick_saida;
    const hasChildren = parentIds.has(est.id);
    const parentOpts = s
      .filter(x => x.id !== est.id)
      .map(x => `<option value="${esc(x.id)}" ${est.parent_id === x.id ? 'selected' : ''}>${esc(x.nome || x.id)}</option>`)
      .join('');
    const parentValid = !est.parent_id || s.some(x => x.id === est.parent_id && x.id !== est.id);
    const parentWarn  = est.parent_id && !parentValid
      ? ` style="border-color:var(--red)" title="parent_id '${esc(est.parent_id)}' não encontrado"` : '';

    html += `<tr${isArchived ? ' class="entity-archived"' : ''}>
      <td class="id-cell">${esc(est.id)}</td>
      <td><input class="cell-input" data-entity="estado" data-idx="${i}" data-field="nome" value="${esc(est.nome)}" /></td>
      <td><input class="cell-input" list="tipo-options" data-entity="estado" data-idx="${i}" data-field="tipo" value="${esc(est.tipo || '')}" style="width:100px" placeholder="ex: pais" /></td>
      <td><select class="cell-input" data-entity="estado" data-idx="${i}" data-field="parent_id" style="width:130px"${parentWarn}>
        <option value="" ${!est.parent_id ? 'selected' : ''}>— sem pai —</option>
        ${parentOpts}
      </select></td>
      <td><input class="cell-input" data-entity="estado" data-idx="${i}" data-field="descricao" value="${esc(est.descricao || '')}" style="width:160px" /></td>
      <td>${statusEconomicoSelect('estado', i, est.status_economico)}</td>
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
      <td class="num" style="white-space:nowrap">${esc(tickLabel(est.tick_registro))}</td>
      <td class="num" style="white-space:nowrap">${esc(tickLabel(est.tick_saida))}</td>
      <td style="white-space:nowrap">
        ${hasChildren ? `<button class="btn-ghost btn-sm btn-update-pop" data-eid="${esc(est.id)}" title="Soma a população dos filhos diretos">👥 Atualizar população</button>` : ''}
        ${isArchived
          ? `<button class="btn-ghost btn-sm btn-reactivate-entity" data-etype="estado" data-eid="${esc(est.id)}">🔄 Reativar</button>`
          : `<button class="btn-ghost btn-sm btn-archive-entity"    data-etype="estado" data-eid="${esc(est.id)}">📤 Arquivar</button>`
        }
        <button class="btn-red btn-sm btn-delete-entity" data-etype="estado" data-eid="${esc(est.id)}">🗑 Excluir</button>
      </td>
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
      triggerSave();
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
      triggerSave();
    });
  });

  // Checkboxes
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const { entity, idx, field } = cb.dataset;
      const obj = getEntityArray(entity)[parseInt(idx)];
      if (!obj) return;
      setEntityField(obj, field, cb.checked);
      triggerSave();
    });
  });

  // Ativos buttons
  container.querySelectorAll('.btn-ativos').forEach(btn => {
    btn.addEventListener('click', () => openAtivosModal(btn.dataset.etype, btn.dataset.eid));
  });

  // Archive entity buttons
  container.querySelectorAll('.btn-archive-entity').forEach(btn => {
    btn.addEventListener('click', () => archiveEntity(btn.dataset.etype, btn.dataset.eid));
  });

  // Reactivate entity buttons
  container.querySelectorAll('.btn-reactivate-entity').forEach(btn => {
    btn.addEventListener('click', () => reactivateEntity(btn.dataset.etype, btn.dataset.eid));
  });

  // Update population buttons (estados with children)
  container.querySelectorAll('.btn-update-pop').forEach(btn => {
    btn.addEventListener('click', () => updatePopulacaoPai(btn.dataset.eid));
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
  // Economic status (pessoa, empresa, estado)
  status_economico: (e, v) => { e.status_economico = v; },
  // Pessoa top-level text
  classe:    (e, v) => { e.classe    = v; },
  // Pessoa atributos
  'atributos.influencia': (e, v) => { e.atributos.influencia = v; },
  'atributos.moral':      (e, v) => { e.atributos.moral      = v; },
  'atributos.reputacao':  (e, v) => { e.atributos.reputacao  = v; },
  // Empresa atributos
  segmento: (e, v) => { e.segmento = v; },
  setor_economico: (e, v) => { e.setor_economico = v; },
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
  // Pessoa jogador stats
  nota_scouting: (e, v) => { e.nota_scouting = v; },
  valor_mercado:  (e, v) => { e.valor_mercado  = Math.max(0, v); },
  posicao:        (e, v) => { e.posicao        = v; },
  clube:             (e, v) => { e.clube             = v; },
  clube_emprestador: (e, v) => { e.clube_emprestador = v; },
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
    triggerSave();
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

// ── Jogadores (player stats) ──────────────────────────────────────────────────

function renderJogadoresTable() {
  const container = document.getElementById('table-jogadores');
  if (!container) return;
  const all = world.pessoas.filter(p => p.classe === 'jogador');

  if (!all.length) {
    container.innerHTML = '<div class="empty-state">Nenhum jogador carregado. Carregue pessoas com classe "jogador".</div>';
    return;
  }

  // Populate the club filter dropdown
  const filterEl = document.getElementById('jogadores-clube-filter');
  if (filterEl) {
    const clubs = [...new Set(all.map(j => j.clube).filter(c => c))].sort((a, b) => {
      const na = world.empresas.find(e => e.id === a)?.nome || a;
      const nb = world.empresas.find(e => e.id === b)?.nome || b;
      return na.localeCompare(nb, 'pt-BR');
    });
    filterEl.innerHTML = '<option value="">— Todos os clubes —</option>' +
      clubs.map(c => {
        const label = world.empresas.find(e => e.id === c)?.nome || c;
        return `<option value="${esc(c)}">${esc(label)}</option>`;
      }).join('');
    // Re-apply saved filter state (reset if the filtered club no longer exists)
    if (clubs.includes(jogadoresClubeFilter)) {
      filterEl.value = jogadoresClubeFilter;
    } else {
      jogadoresClubeFilter = '';
      filterEl.value = '';
    }
  }

  // Filter by club if a filter is active
  const filtered = jogadoresClubeFilter
    ? all.filter(j => j.clube === jogadoresClubeFilter)
    : all;

  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state">Nenhum jogador encontrado para o clube selecionado.</div>';
    return;
  }

  const { by, dir } = tableSorts.jogadores;
  const sorted = sortedEntities(filtered, by, dir);
  const idxMap = new Map(all.map(item => [item, world.pessoas.indexOf(item)]));

  let html = `<div class="table-wrap"><table>
    <thead><tr>
      <th>ID</th>
      ${sortHeader('Nome', 'nome', 'jogadores')}
      <th>Estado</th>
      <th>Posição</th>
      <th>Clube</th>
      <th>Empréstimo</th>
      ${sortHeader('Nota de Scouting', 'nota_scouting', 'jogadores')}
      ${sortHeader('Valor de Mercado', 'valor_mercado', 'jogadores')}
      <th>Scouts</th>
    </tr></thead>
    <tbody>`;

  for (const jogador of sorted) {
    const i = idxMap.get(jogador);
    const emprestador = jogador.clube_emprestador
      ? (world.empresas.find(e => e.id === jogador.clube_emprestador)?.nome || jogador.clube_emprestador)
      : '';
    const clubeSelectOpts = world.empresas.map(e =>
      `<option value="${esc(e.id)}" ${jogador.clube === e.id ? 'selected' : ''}>${esc(e.nome || e.id)}</option>`
    ).join('');
    html += `<tr>
      <td class="id-cell">${esc(jogador.id)}</td>
      <td>${esc(jogador.nome)}</td>
      <td class="id-cell">${esc(jogador.estado_id || '–')}</td>
      <td>
        <input class="cell-input" data-entity="pessoa" data-idx="${i}" data-field="posicao"
          value="${esc(jogador.posicao || '')}" style="width:110px" placeholder="ex: goleiro" />
      </td>
      <td>
        <select class="cell-input" data-entity="pessoa" data-idx="${i}" data-field="clube" style="width:150px">
          <option value="" ${!jogador.clube ? 'selected' : ''}>— sem clube —</option>
          ${clubeSelectOpts}
        </select>
      </td>
      <td class="id-cell">
        ${emprestador ? `<span style="color:var(--yellow)" title="Emprestado por: ${esc(emprestador)}">🔁 ${esc(emprestador)}</span>` : '–'}
      </td>
      <td class="num">
        <input class="cell-input num" type="number" step="0.01" min="0"
          data-entity="pessoa" data-idx="${i}" data-field="nota_scouting"
          value="${fmtDec(jogador.nota_scouting || 0, 2)}" style="width:90px" />
      </td>
      <td class="num">
        <input class="cell-input num" type="number" min="0" step="0.01"
          data-entity="pessoa" data-idx="${i}" data-field="valor_mercado"
          value="${jogador.valor_mercado || 0}" style="width:130px" />
      </td>
      <td>
        <button class="btn-blue btn-sm btn-scouts" data-eid="${esc(jogador.id)}">⚽ Scouts</button>
      </td>
    </tr>`;
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;
  bindTableInputs(container);

  container.querySelectorAll('.btn-scouts').forEach(btn => {
    btn.addEventListener('click', () => openScoutsModal(btn.dataset.eid));
  });
}

// ── Scouts Modal ──────────────────────────────────────────────────────────────

function openScoutsModal(pessoaId) {
  const pessoa = world.pessoas.find(p => p.id === pessoaId);
  if (!pessoa) return;

  scoutModalPessoaId = pessoaId;
  scoutCounts = {};

  const isGoleiro = (pessoa.posicao || '').trim().toLowerCase() === 'goleiro';
  document.getElementById('scouts-modal-title').textContent = `⚽ Scouts — ${pessoa.nome}`;

  renderScoutsForm(isGoleiro);
  updateScoutsResult(pessoa);

  document.getElementById('modal-scouts').classList.add('open');
}

function renderScoutsForm(isGoleiro) {
  const container = document.getElementById('scouts-form');

  const buildSection = (title, scouts) => {
    let s = `<div class="scouts-section"><h4 class="scouts-section-title">${esc(title)}</h4>`;
    for (const sc of scouts) {
      const gkOnly    = !!sc.gk;
      const disabled  = gkOnly && !isGoleiro ? 'disabled' : '';
      const gkBadge   = gkOnly ? ' <span class="scouts-gk-badge">GK</span>' : '';
      const ptsStr    = (sc.pts >= 0 ? '+' : '') + sc.pts.toFixed(1);
      s += `<div class="scout-row">
        <label class="scout-label">${esc(sc.label)}${gkBadge} <span class="scouts-pts">${esc(ptsStr)}</span></label>
        <input type="number" class="cell-input num scouts-count" min="0" step="1" value="0"
          data-scout="${esc(sc.id)}" style="width:65px" ${disabled} />
      </div>`;
    }
    s += '</div>';
    return s;
  };

  container.innerHTML = `<div class="scouts-sections">
    ${buildSection('⚔️ Ataque', SCOUTS_ATAQUE)}
    ${buildSection('🛡️ Defesa', SCOUTS_DEFESA)}
  </div>`;

  container.querySelectorAll('.scouts-count').forEach(input => {
    input.addEventListener('input', () => {
      const pessoa = world.pessoas.find(p => p.id === scoutModalPessoaId);
      if (!pessoa) return;
      scoutCounts[input.dataset.scout] = parseInt(input.value) || 0;
      updateScoutsResult(pessoa);
    });
  });
}

function updateScoutsResult(pessoa) {
  const matchScore = calcMatchScore(scoutCounts);
  const prevScore  = pessoa.nota_scouting || 0;
  const newAvg     = calcNewAverage(prevScore, matchScore);
  const newMktVal  = calcNewMarketValue(pessoa.valor_mercado || 0, prevScore, newAvg);

  document.getElementById('scouts-match-score').textContent = fmtDec(matchScore, 2);
  document.getElementById('scouts-new-avg').textContent     = fmtDec(newAvg, 2);
  document.getElementById('scouts-new-market').textContent  = fmtNum(newMktVal);
}

function applyScouts() {
  const pessoa = world.pessoas.find(p => p.id === scoutModalPessoaId);
  if (!pessoa) return;

  const matchScore = calcMatchScore(scoutCounts);
  const prevScore  = pessoa.nota_scouting || 0;
  const newAvg     = calcNewAverage(prevScore, matchScore);
  const newMktVal  = calcNewMarketValue(pessoa.valor_mercado || 0, prevScore, newAvg);

  pessoa.nota_scouting = newAvg;
  pessoa.valor_mercado = newMktVal;

  closeScoutsModal();
  renderJogadoresTable();
  triggerSave();
  setStatus(`✅ Scouts aplicados para ${pessoa.nome}: nota ${fmtDec(newAvg, 2)}, mercado ${fmtNum(newMktVal)}.`);
}

function closeScoutsModal() {
  document.getElementById('modal-scouts').classList.remove('open');
  scoutModalPessoaId = null;
  scoutCounts = {};
}

document.getElementById('btn-scouts-apply')?.addEventListener('click', applyScouts);
document.getElementById('btn-scouts-cancel')?.addEventListener('click', closeScoutsModal);
document.getElementById('modal-scouts')?.addEventListener('click', e => {
  if (e.target === document.getElementById('modal-scouts')) closeScoutsModal();
});

// Jogadores clube filter
document.getElementById('jogadores-clube-filter')?.addEventListener('change', e => {
  jogadoresClubeFilter = e.target.value;
  renderJogadoresTable();
});

// ── Transferências ────────────────────────────────────────────────────────────

/**
 * Populate both entity selects in the transfer form based on the currently
 * chosen entity types.
 */
function populateTransferSelects() {
  for (const side of ['src', 'dst']) {
    const typeEl   = document.getElementById(`tr-${side}-type`);
    const entityEl = document.getElementById(`tr-${side}-entity`);
    if (!typeEl || !entityEl) return;
    const arr = getEntityArray(typeEl.value);
    entityEl.innerHTML = arr.length
      ? arr.map(x => `<option value="${esc(x.id)}">${esc(x.nome || x.id)}</option>`).join('')
      : '<option value="">— sem dados carregados —</option>';
  }
}

document.getElementById('tr-src-type')?.addEventListener('change', populateTransferSelects);
document.getElementById('tr-dst-type')?.addEventListener('change', populateTransferSelects);

document.getElementById('btn-execute-transfer')?.addEventListener('click', () => {
  const srcType  = document.getElementById('tr-src-type').value;
  const srcId    = document.getElementById('tr-src-entity').value;
  const dstType  = document.getElementById('tr-dst-type').value;
  const dstId    = document.getElementById('tr-dst-entity').value;
  const amount   = parseFloat(document.getElementById('tr-amount').value) || 0;
  const trType   = document.getElementById('tr-type').value;

  if (!srcId || !dstId) {
    setStatus('⚠ Selecione origem e destino.');
    return;
  }

  let result;
  if (trType === 'fundos') {
    result = transferFundos(world, srcType, srcId, dstType, dstId, amount);
  } else {
    result = transferPatrimonio(world, srcType, srcId, dstType, dstId, amount);
  }

  const logEl = document.getElementById('tr-log');
  if (result.ok) {
    renderAll();
    triggerSave();
    if (logEl) {
      const ts = new Date().toLocaleTimeString('pt-BR');
      logEl.textContent = `[${ts}] ${result.msg}\n` + logEl.textContent;
    }
    setStatus(`✅ ${result.msg}`);
  } else {
    setStatus(`⚠ ${result.msg}`);
  }
});

// ── Transferência de Jogador ──────────────────────────────────────────────────

/**
 * Populate selects for the player transfer form.
 * Origem/destino are clube (empresa) selects; jogador select is filtered by origem clube.
 */
function populateJogadorTransferSelects() {
  const srcEl  = document.getElementById('jtr-src-clube');
  const dstEl  = document.getElementById('jtr-dst-clube');
  const jogEl  = document.getElementById('jtr-jogador');
  if (!srcEl || !dstEl || !jogEl) return;

  const emptyOpt    = '<option value="">— sem dados carregados —</option>';
  const semClubeOpt = '<option value="__SEM_CLUBE__">🚫 Sem clube</option>';
  const clubeOpts   = world.empresas.length
    ? world.empresas.map(e => `<option value="${esc(e.id)}">${esc(e.nome || e.id)}</option>`).join('')
    : emptyOpt;

  srcEl.innerHTML = `<option value="">— Selecione origem —</option>${semClubeOpt}${clubeOpts}`;
  dstEl.innerHTML = `<option value="">— Selecione destino —</option>${semClubeOpt}${clubeOpts}`;

  populateJtrJogadorSelect();
}

function populateJtrJogadorSelect() {
  const srcId = document.getElementById('jtr-src-clube')?.value;
  const jogEl = document.getElementById('jtr-jogador');
  if (!jogEl) return;

  if (!srcId) {
    jogEl.innerHTML = `<option value="">— Selecione uma origem primeiro —</option>`;
    return;
  }

  // Players belonging to the selected origin clube (or free agents when "sem clube")
  const isSemClube = srcId === '__SEM_CLUBE__';
  const jogadores  = world.pessoas.filter(p =>
    p.classe === 'jogador' && (isSemClube ? !p.clube : p.clube === srcId)
  );
  jogEl.innerHTML = jogadores.length
    ? `<option value="">— Selecione jogador —</option>` +
      jogadores.map(j => `<option value="${esc(j.id)}">${esc(j.nome || j.id)}</option>`).join('')
    : `<option value="">— nenhum jogador neste clube —</option>`;
}

document.getElementById('jtr-src-clube')?.addEventListener('change', populateJtrJogadorSelect);

document.getElementById('btn-execute-jtr')?.addEventListener('click', () => {
  const srcClubeId = document.getElementById('jtr-src-clube').value;
  const dstClubeId = document.getElementById('jtr-dst-clube').value;
  const jogadorId  = document.getElementById('jtr-jogador').value;
  const jtrType    = document.getElementById('jtr-type').value;

  if (!srcClubeId || !dstClubeId || !jogadorId) {
    setStatus('⚠ Selecione clube origem, destino e jogador.');
    return;
  }
  if (srcClubeId === dstClubeId) {
    setStatus('⚠ Clube origem e destino devem ser diferentes.');
    return;
  }

  const jogador = world.pessoas.find(p => p.id === jogadorId);
  if (!jogador) {
    setStatus('⚠ Jogador não encontrado.');
    return;
  }

  // Resolve actual clube IDs (__SEM_CLUBE__ sentinel → empty string)
  const srcId = srcClubeId === '__SEM_CLUBE__' ? '' : srcClubeId;
  const dstId = dstClubeId === '__SEM_CLUBE__' ? '' : dstClubeId;

  const srcClube = world.empresas.find(e => e.id === srcId);
  const dstClube = world.empresas.find(e => e.id === dstId);
  const srcNome  = srcClubeId === '__SEM_CLUBE__' ? 'Sem clube' : (srcClube?.nome || srcClubeId);
  const dstNome  = dstClubeId === '__SEM_CLUBE__' ? 'Sem clube' : (dstClube?.nome || dstClubeId);

  if (jtrType === 'definitiva') {
    jogador.clube             = dstId;
    jogador.clube_emprestador = '';
  } else {
    // Empréstimo: record the original club as emprestador
    const emprestador = jogador.clube_emprestador || jogador.clube;
    jogador.clube_emprestador = emprestador || srcId;
    jogador.clube             = dstId;
  }

  const logEl = document.getElementById('jtr-log');
  const tipoLabel = jtrType === 'definitiva' ? 'Transferência definitiva' : 'Empréstimo';
  const msg = `${tipoLabel}: ${jogador.nome} de ${srcNome} → ${dstNome}`;
  if (logEl) {
    const ts = new Date().toLocaleTimeString('pt-BR');
    logEl.textContent = `[${ts}] ${msg}\n` + logEl.textContent;
  }

  renderAll();
  triggerSave();
  setStatus(`✅ ${msg}.`);
});

// ── Elenco do Clube ───────────────────────────────────────────────────────────

/**
 * Render the club roster tab. Shows players belonging to the selected clube.
 */
function renderElencoTab() {
  const selectEl    = document.getElementById('elenco-clube-select');
  const container   = document.getElementById('table-elenco');
  if (!selectEl || !container) return;

  // Populate club dropdown
  const curVal = selectEl.value;
  selectEl.innerHTML = '<option value="">— Selecione um clube —</option>' +
    '<option value="__SEM_CLUBE__">🚫 Sem clube</option>' +
    world.empresas.map(e => `<option value="${esc(e.id)}">${esc(e.nome || e.id)}</option>`).join('');
  if (curVal === '__SEM_CLUBE__' || (curVal && world.empresas.some(e => e.id === curVal))) {
    selectEl.value = curVal;
  }

  const clubeId = selectEl.value;
  if (!clubeId) {
    container.innerHTML = '<div class="empty-state">Selecione um clube para ver seu elenco.</div>';
    return;
  }

  if (clubeId === '__SEM_CLUBE__') {
    const semClube = world.pessoas.filter(p => p.classe === 'jogador' && !p.clube);
    if (!semClube.length) {
      container.innerHTML = '<div class="empty-state">Nenhum jogador sem clube encontrado.</div>';
      return;
    }
    const buildSemClubeRows = list => list.map(j => `<tr>
      <td>${esc(j.nome)}</td>
      <td>${esc(j.posicao || '–')}</td>
      <td class="num">${fmtDec(j.nota_scouting || 0, 2)}</td>
      <td class="num">${fmtNum(j.valor_mercado || 0)}</td>
      <td>–</td>
    </tr>`).join('');
    container.innerHTML = `<div class="table-wrap"><table>
      <thead><tr>
        <th>Nome</th><th>Posição</th><th>Nota Scouting</th><th>Valor de Mercado</th><th>Status</th>
      </tr></thead>
      <tbody>${buildSemClubeRows(semClube)}</tbody>
    </table></div>`;
    return;
  }

  const jogadores = world.pessoas.filter(p => p.classe === 'jogador' && p.clube === clubeId);
  const emprestados = world.pessoas.filter(p => p.classe === 'jogador' && p.clube_emprestador === clubeId);

  if (!jogadores.length && !emprestados.length) {
    container.innerHTML = '<div class="empty-state">Nenhum jogador encontrado neste clube.</div>';
    return;
  }

  const buildRows = (list, isEmprestado) => list.map(j => {
    const empresLabel = isEmprestado
      ? `<td><span style="color:var(--yellow)">🔁 Emprestado a ${esc(world.empresas.find(e => e.id === j.clube)?.nome || j.clube)}</span></td>`
      : `<td>–</td>`;
    return `<tr>
      <td>${esc(j.nome)}</td>
      <td>${esc(j.posicao || '–')}</td>
      <td class="num">${fmtDec(j.nota_scouting || 0, 2)}</td>
      <td class="num">${fmtNum(j.valor_mercado || 0)}</td>
      ${empresLabel}
    </tr>`;
  }).join('');

  let html = `<div class="table-wrap"><table>
    <thead><tr>
      <th>Nome</th><th>Posição</th><th>Nota Scouting</th><th>Valor de Mercado</th><th>Status</th>
    </tr></thead>
    <tbody>
      ${buildRows(jogadores, false)}
      ${buildRows(emprestados, true)}
    </tbody>
  </table></div>`;

  container.innerHTML = html;
}

document.getElementById('elenco-clube-select')?.addEventListener('change', renderElencoTab);

// ── Scheduling tab ────────────────────────────────────────────────────────────
document.querySelectorAll('.entity-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.entity-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    scheduleEntityType = btn.dataset.etype;
    renderConversionMatrix();
  });
});

document.getElementById('sched-tick-month').addEventListener('change', renderConversionMatrix);
document.getElementById('sched-tick-year').addEventListener('change', renderConversionMatrix);

function renderScheduleTab() {
  // Sync both sets of date inputs to the current game tick
  const { month, year } = tickToDate(getCurrentTick());
  document.getElementById('sched-tick-month').value = month;
  document.getElementById('sched-tick-year').value  = year;
  document.getElementById('inj-tick-month').value   = month;
  document.getElementById('inj-tick-year').value    = year;
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
  const tick      = getSchedTick();
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
  const tick   = getInjTick();

  if (!id)     { setStatus('⚠ Selecione uma entidade.'); return; }
  if (!amount) { setStatus('⚠ Informe um valor positivo.'); return; }

  scheduleInjection(tick, type, id, amount);
  renderInjectionsList();
  setStatus(`Aporte de ${fmtNum(amount)} agendado para ${type} "${id}" em ${tickLabel(tick)}.`);
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
      <th>Mês/Ano</th><th>Tipo</th><th>Entidade</th><th>Valor</th><th></th>
    </tr></thead>
    <tbody>`;

  for (const inj of all) {
    html += `<tr>
      <td class="num">${esc(tickLabel(inj.tick))}</td>
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

// ── Archive / Reactivate Entity ───────────────────────────────────────────────

/** Return a human-readable label for an entity type. */
function entityTypeLabel(type) {
  return type === 'pessoa' ? 'Pessoa' : type === 'empresa' ? 'Empresa' : 'Estado';
}

/**
 * Mark an entity as removed from the registry by setting tick_saida to the current tick.
 * The entity remains in the world data and can be reactivated.
 * @param {'pessoa'|'empresa'|'estado'} type
 * @param {string} id
 */
function archiveEntity(type, id) {
  const entity = getEntityArray(type).find(x => x.id === id);
  if (!entity) return;
  entity.tick_saida = getCurrentTick();
  if (type === 'pessoa')       renderPessoasTable();
  else if (type === 'empresa') renderEmpresasTable();
  else                         renderEstadosTable();
  triggerSave();
  setStatus(`📤 ${entityTypeLabel(type)} "${entity.nome || id}" arquivado(a) em ${tickLabel(entity.tick_saida)}.`);
}

/**
 * Restore a previously archived entity by clearing its tick_saida.
 * @param {'pessoa'|'empresa'|'estado'} type
 * @param {string} id
 */
function reactivateEntity(type, id) {
  const entity = getEntityArray(type).find(x => x.id === id);
  if (!entity) return;
  entity.tick_saida = 0;
  if (type === 'pessoa')       renderPessoasTable();
  else if (type === 'empresa') renderEmpresasTable();
  else                         renderEstadosTable();
  triggerSave();
  setStatus(`🔄 ${entityTypeLabel(type)} "${entity.nome || id}" reativado(a).`);
}

// ── Population aggregation ────────────────────────────────────────────────────

/**
 * Sum the populations of the direct children of a given parent estado.
 * Only immediate children (parent_id === parentId) are counted; grandchildren
 * and deeper descendants are intentionally excluded to avoid double counting.
 * @param {string} parentId
 * @param {Object[]} estados
 * @returns {number}
 */
function sumDirectChildrenPopulation(parentId, estados) {
  return estados
    .filter(s => s.parent_id === parentId)
    .reduce((sum, child) => sum + (child.atributos?.populacao || 0), 0);
}

/**
 * Update the population of a parent estado to the sum of its direct children's populations.
 * @param {string} parentId
 */
function updatePopulacaoPai(parentId) {
  const parent = world.estados.find(s => s.id === parentId);
  if (!parent) return;
  if (!parent.atributos) parent.atributos = { populacao: 0, forcas_armadas: 1, cultura: 1, moral_populacao: 3 };
  const total = sumDirectChildrenPopulation(parentId, world.estados);
  parent.atributos.populacao = total;
  renderEstadosTable();
  triggerSave();
  setStatus(`✅ População de "${parent.nome || parent.id}" atualizada: ${fmtNum(total)}`);
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
      const names = deps.map(e => `"${e.id}"`).join(', ');
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
    const mapaCells = findCellsByEstado(mapaWorld, id);
    if (mapaCells.length) {
      const sample = mapaCells.slice(0, 5).map(c => `(${c.lat},${c.lon})`).join(', ');
      const extra  = mapaCells.length > 5 ? ` e mais ${mapaCells.length - 5}` : '';
      msgs.push(`${mapaCells.length} célula(s) no mapa: ${sample}${extra}`);
    }
    if (msgs.length) {
      setStatus(`⛔ Não é possível excluir o estado "${id}". Dependências: ${msgs.join('; ')}.`);
      return;
    }
  }

  // ── Confirmation dialog ────────────────────────────────────────────────
  const label       = entityTypeLabel(type);
  const entity      = getEntityArray(type).find(x => x.id === id);
  const displayName = entity ? (entity.nome || entity.id) : id;
  if (!window.confirm(`Excluir ${label} "${displayName}" (${id})?\nEsta ação não pode ser desfeita.`)) return;

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
  triggerSave();
  setStatus(`🗑 ${label} "${id}" excluído(a).`);
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
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-status-economico-pessoa">Status Econômico</label>
        <select id="nef-status-economico-pessoa" class="cell-input">
          <option value="recessao">📉 Recessão</option>
          <option value="estagnacao" selected>➡ Estagnação</option>
          <option value="crescimento">📈 Crescimento</option>
        </select>
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
        <label class="form-label" for="nef-segmento">Segmento (Público-alvo)</label>
        <select id="nef-segmento" class="cell-input">
          <option value="POP_NAO_DURAVEL">🟢 Pop. Não Durável</option>
          <option value="POP_DURAVEL">🔵 Pop. Durável</option>
          <option value="B2B">🟡 B2B (Insumos)</option>
          <option value="ESTADO">⚫ Estado/Governo</option>
          <option value="CLUBE">⚽ Clube</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-setor-economico">Setor Econômico</label>
        <select id="nef-setor-economico" class="cell-input">
          <option value="agricola">🌾 Agrícola</option>
          <option value="industrial">🏭 Industrial</option>
          <option value="servicos" selected>🏢 Serviços</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="nef-status-economico-empresa">Status Econômico</label>
        <select id="nef-status-economico-empresa" class="cell-input">
          <option value="recessao">📉 Recessão</option>
          <option value="estagnacao" selected>➡ Estagnação</option>
          <option value="crescimento">📈 Crescimento</option>
        </select>
      </div>
    </div>
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
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="nef-status-economico-estado">Status Econômico</label>
        <select id="nef-status-economico-estado" class="cell-input">
          <option value="recessao">📉 Recessão</option>
          <option value="estagnacao" selected>➡ Estagnação</option>
          <option value="crescimento">📈 Crescimento</option>
        </select>
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
      status_economico: document.getElementById('nef-status-economico-pessoa').value || 'estagnacao',
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
      nota_scouting:     0,
      valor_mercado:     0,
      posicao:           '',
      clube:             '',
      clube_emprestador: '',
      tick_registro:     getCurrentTick(),
      tick_saida:        0,
      ativos: { patrimonio_geral: patrimonio },
    });
    renderPessoasTable();
  } else if (type === 'empresa') {
    const patrimonio = parseFloat(document.getElementById('nef-patrimonio').value) || 0;
    world.empresas.push({
      id,
      nome,
      dono_id:         document.getElementById('nef-dono').value,
      estado_id:       document.getElementById('nef-estado').value,
      segmento:        document.getElementById('nef-segmento').value        || 'POP_NAO_DURAVEL',
      setor_economico: document.getElementById('nef-setor-economico').value || 'servicos',
      status_economico: document.getElementById('nef-status-economico-empresa').value || 'estagnacao',
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
      tick_registro: getCurrentTick(),
      tick_saida:    0,
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
      status_economico: document.getElementById('nef-status-economico-estado').value || 'estagnacao',
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
      tick_registro: getCurrentTick(),
      tick_saida:    0,
    });
    renderEstadosTable();
  }

  closeAddEntityModal();
  triggerSave();
  setStatus(`✅ ${entityTypeLabel(type)} "${id}" adicionado(a) em ${tickLabel(getCurrentTick())}.`);
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

// ── Mapa ─────────────────────────────────────────────────────────────────────

async function loadMapaConfig() {
  if (mapaConfig) return mapaConfig;
  const [biomas, climas] = await Promise.all([
    fetch('../data/config/biomas.json').then(r => r.json()),
    fetch('../data/config/climas.json').then(r => r.json()),
  ]);
  mapaConfig = { biomas, climas };
  return mapaConfig;
}

/**
 * Compute the inclusive lat/lon bounds of the current viewport.
 * Coordinates are clamped to valid globe ranges (-90..90 lat, -180..180 lon).
 * The viewport is centred on `mapaVp.latCenter` / `mapaVp.lonCenter`.
 * @returns {{ latMin: number, latMax: number, lonMin: number, lonMax: number }}
 *   All values are integers; lat rows run top (latMax) to bottom (latMin),
 *   lon columns run left (lonMin) to right (lonMax).
 */
function mapaViewportBounds() {
  const { latCenter, lonCenter, rows, cols } = mapaVp;
  const latMax = Math.min(90,   Math.round(latCenter + (rows - 1) / 2));
  const latMin = Math.max(-90,  latMax - rows + 1);
  const lonMin = Math.max(-180, Math.round(lonCenter - (cols - 1) / 2));
  const lonMax = Math.min(180,  lonMin + cols - 1);
  return { latMin, latMax, lonMin, lonMax };
}

/** Build the CSS class string for a cell at (lat, lon). */
function cellCssClass(lat, lon) {
  const cell = getCell(mapaWorld, lat, lon);
  let cls = 'mc ';
  if (!cell || !cell.tipo)     cls += 'mc-empty';
  else if (cell.tipo === 'agua') cls += 'mc-agua';
  else                           cls += 'mc-terra';
  if (cell && cell.estado_id)  cls += ' mc-has-estado';
  if (lat === 0)               cls += ' mc-zero-lat';
  if (lon === 0)               cls += ' mc-zero-lon';
  return cls;
}

/** Update just the visual state of one cell element (after a paint). */
function updateCellElement(lat, lon) {
  const el = document.querySelector(`.mapa-grid [data-lat="${lat}"][data-lon="${lon}"]`);
  if (!el) return;
  el.className = cellCssClass(lat, lon);
  if (mapaSelectedCell && mapaSelectedCell.lat === lat && mapaSelectedCell.lon === lon) {
    el.classList.add('mc-selected');
  }
  // Update tooltip
  const cell = getCell(mapaWorld, lat, lon);
  el.title = cell
    ? `(${lat}, ${lon}) tipo:${cell.tipo || '–'} estado:${cell.estado_id || '–'} bioma:${cell.bioma || '–'} clima:${cell.clima || '–'}`
    : `(${lat}, ${lon})`;
}

/** (Re)render the full map grid for the current viewport. */
function renderMapaGrid() {
  const grid = document.getElementById('mapa-grid');
  if (!grid) return;

  const { latMin, latMax, lonMin, lonMax } = mapaViewportBounds();
  const rows = latMax - latMin + 1;
  const cols = lonMax - lonMin + 1;
  const cs   = mapaVp.cellSize;

  grid.style.setProperty('--mc-size', `${cs}px`);
  grid.style.gridTemplateColumns = `28px repeat(${cols}, ${cs}px)`;
  grid.style.gridTemplateRows    = `16px repeat(${rows}, ${cs}px)`;

  let html = '';

  // ── Corner cell ──
  html += '<div class="mc-corner"></div>';

  // ── Longitude header row ──
  for (let lon = lonMin; lon <= lonMax; lon++) {
    const label = (lon === 0 || lon % 10 === 0) ? String(lon) : '';
    const zeroCls = lon === 0 ? ' mc-lon-label-zero' : '';
    html += `<div class="mc-lon-label${zeroCls}" title="lon ${lon}">${esc(label)}</div>`;
  }

  // ── Latitude rows (top = north = latMax) ──
  for (let lat = latMax; lat >= latMin; lat--) {
    const latLabel = (lat === 0 || lat % 5 === 0) ? String(lat) : '';
    const zeroCls = lat === 0 ? ' mc-lat-label-zero' : '';
    html += `<div class="mc-lat-label${zeroCls}" title="lat ${lat}">${esc(latLabel)}</div>`;

    for (let lon = lonMin; lon <= lonMax; lon++) {
      const cell    = getCell(mapaWorld, lat, lon);
      const tip     = cell
        ? `(${lat}, ${lon}) tipo:${cell.tipo || '–'} estado:${cell.estado_id || '–'} bioma:${cell.bioma || '–'} clima:${cell.clima || '–'}`
        : `(${lat}, ${lon})`;
      const selected = mapaSelectedCell &&
                       mapaSelectedCell.lat === lat && mapaSelectedCell.lon === lon;
      html += `<div class="${cellCssClass(lat, lon)}${selected ? ' mc-selected' : ''}" data-lat="${lat}" data-lon="${lon}" title="${esc(tip)}"></div>`;
    }
  }

  grid.innerHTML = html;

  // ── Bind pointer events for brush painting ──
  grid.querySelectorAll('.mc[data-lat]').forEach(el => {
    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      mapaBrushDown = true;
      mapaDragMoved = false;
      const lat = parseInt(el.dataset.lat, 10);
      const lon = parseInt(el.dataset.lon, 10);
      applyMapaBrush(lat, lon);
    });

    el.addEventListener('mouseenter', () => {
      if (!mapaBrushDown) return;
      mapaDragMoved = true;
      applyMapaBrush(
        parseInt(el.dataset.lat, 10),
        parseInt(el.dataset.lon, 10),
      );
    });

    el.addEventListener('mouseup', e => {
      if (e.button !== 0) return;
      const wasDrag = mapaDragMoved;
      mapaBrushDown = false;
      if (!wasDrag) {
        openMapaCellEditor(
          parseInt(el.dataset.lat, 10),
          parseInt(el.dataset.lon, 10),
        );
      }
    });
  });

  // Update zoom info display
  const zoomEl = document.getElementById('mapa-zoom-info');
  if (zoomEl) zoomEl.textContent = `${cols}×${rows} (${cs}px)`;
}

/**
 * Apply the active brush (or eraser) to the map cell at (lat, lon).
 * In eraser mode the cell is removed entirely from mapaWorld.
 * Otherwise, all locked fields from `mapaBrushValues` are written to the cell;
 * unlocked fields are left unchanged.
 * @param {number} lat
 * @param {number} lon
 */
function applyMapaBrush(lat, lon) {
  if (mapaEraserMode) {
    clearCell(mapaWorld, lat, lon);
  } else {
    const fields = {};
    for (const f of ['tipo', 'estado_id', 'bioma', 'clima']) {
      if (mapaBrushLocks[f]) {
        fields[f] = mapaBrushValues[f];
      }
    }
    if (Object.keys(fields).length) {
      setCell(mapaWorld, lat, lon, fields);
    }
  }
  updateCellElement(lat, lon);
}

/**
 * Select a cell for editing and populate the cell editor panel.
 * Highlights the cell in the grid and shows its current property values.
 * @param {number} lat
 * @param {number} lon
 */
function openMapaCellEditor(lat, lon) {
  // Clear previous selection highlight
  if (mapaSelectedCell) {
    const prev = document.querySelector(
      `.mapa-grid [data-lat="${mapaSelectedCell.lat}"][data-lon="${mapaSelectedCell.lon}"]`,
    );
    if (prev) prev.classList.remove('mc-selected');
  }

  mapaSelectedCell = { lat, lon };
  const el = document.querySelector(`.mapa-grid [data-lat="${lat}"][data-lon="${lon}"]`);
  if (el) el.classList.add('mc-selected');

  const cell = getCell(mapaWorld, lat, lon) || {};
  document.getElementById('mapa-cell-coords').textContent = `(${lat}, ${lon})`;
  document.getElementById('mapa-edit-tipo').value    = cell.tipo       || '';
  document.getElementById('mapa-edit-estado').value  = cell.estado_id  || '';
  document.getElementById('mapa-edit-bioma').value   = cell.bioma      || '';
  document.getElementById('mapa-edit-clima').value   = cell.clima      || '';
  document.getElementById('mapa-cell-editor').style.display = '';
}

/**
 * Read current brush control values from the DOM into the global brush state
 * variables (`mapaBrushValues`, `mapaBrushLocks`, `mapaEraserMode`).
 * Called on every `change` event from a brush control.
 */
function syncMapaBrushState() {
  mapaBrushValues.tipo      = document.getElementById('mapa-brush-tipo').value;
  mapaBrushValues.estado_id = document.getElementById('mapa-brush-estado').value;
  mapaBrushValues.bioma     = document.getElementById('mapa-brush-bioma').value;
  mapaBrushValues.clima     = document.getElementById('mapa-brush-clima').value;
  mapaBrushLocks.tipo       = document.getElementById('mapa-lock-tipo').checked;
  mapaBrushLocks.estado_id  = document.getElementById('mapa-lock-estado').checked;
  mapaBrushLocks.bioma      = document.getElementById('mapa-lock-bioma').checked;
  mapaBrushLocks.clima      = document.getElementById('mapa-lock-clima').checked;
  mapaEraserMode            = document.getElementById('mapa-eraser').checked;
}

/**
 * Populate the estado dropdown options in both the brush panel and cell editor
 * from the currently loaded `world.estados` array.
 * Preserves the previously selected value when options are rebuilt.
 */
function populateMapaEstadoSelects() {
  const opts = world.estados
    .map(s => `<option value="${esc(s.id)}">${esc(s.nome || s.id)}</option>`)
    .join('');

  for (const id of ['mapa-brush-estado', 'mapa-edit-estado']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const prev = sel.value;
    sel.innerHTML = `<option value="">(nenhum)</option>${opts}`;
    sel.value = prev;   // restore selection if still valid
  }
}

/**
 * Populate bioma and clima select elements from the provided config arrays.
 * Applied to both the brush panel selects and the cell editor selects.
 * @param {string[]} biomas  List of biome names
 * @param {string[]} climas  List of climate names
 */
function populateMapaBiomaClimaSelects(biomas, climas) {
  const makeOpts = arr =>
    arr.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');

  const biomaOpts = `<option value="">(nenhum)</option>${makeOpts(biomas)}`;
  const climaOpts = `<option value="">(nenhum)</option>${makeOpts(climas)}`;

  for (const id of ['mapa-brush-bioma', 'mapa-edit-bioma']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = biomaOpts;
  }
  for (const id of ['mapa-brush-clima', 'mapa-edit-clima']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = climaOpts;
  }
}

/** Initialise the Mapa tab (called once on first activation and on subsequent visits). */
let mapaTabInitialised = false;
async function initMapaTab() {
  try {
    const cfg = await loadMapaConfig();
    if (!mapaTabInitialised) {
      populateMapaBiomaClimaSelects(cfg.biomas, cfg.climas);
      mapaTabInitialised = true;
    }
    populateMapaEstadoSelects();
    renderMapaGrid();
  } catch (err) {
    setStatus(`Erro ao inicializar mapa: ${err.message}`);
    console.error(err);
  }
}

// ── Mapa import / export ──────────────────────────────────────────────────────

document.getElementById('file-mapa').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const rows = parseCsv(await readFile(file));
    const ignored = rows.filter(r => {
      const lat = parseInt(r.lat, 10);
      const lon = parseInt(r.lon, 10);
      return !Number.isInteger(lat) || lat < -90  || lat > 90 ||
             !Number.isInteger(lon) || lon < -180 || lon > 180;
    }).length;
    mapaWorld = rowsToMapa(rows);
    const imported = rows.length - ignored;
    renderMapaGrid();
    setStatus(`Mapa carregado: ${file.name} — ${imported} células importadas${ignored ? `, ${ignored} ignoradas` : ''}.`);
  } catch (err) {
    setStatus(`Erro ao importar mapa: ${err.message}`);
  }
  e.target.value = '';
});

document.getElementById('btn-export-mapa').addEventListener('click', () => {
  const rows = mapaToRows(mapaWorld);
  const csv  = rows.length > 0
    ? unparseCsv(rows)
    : 'lat,lon,tipo,estado_id,bioma,clima';
  downloadText('mapa.csv', csv);
  setStatus('⬇ mapa.csv exportado.');
});

// ── Mapa viewport controls ────────────────────────────────────────────────────

document.getElementById('mapa-lat-center').addEventListener('change', e => {
  mapaVp.latCenter = Math.max(-90, Math.min(90, parseInt(e.target.value, 10) || 0));
  renderMapaGrid();
});

document.getElementById('mapa-lon-center').addEventListener('change', e => {
  mapaVp.lonCenter = Math.max(-180, Math.min(180, parseInt(e.target.value, 10) || 0));
  renderMapaGrid();
});

const MAPA_PAN_STEP = 10;

document.getElementById('mapa-pan-n').addEventListener('click', () => {
  mapaVp.latCenter = Math.min(90, mapaVp.latCenter + MAPA_PAN_STEP);
  document.getElementById('mapa-lat-center').value = mapaVp.latCenter;
  renderMapaGrid();
});
document.getElementById('mapa-pan-s').addEventListener('click', () => {
  mapaVp.latCenter = Math.max(-90, mapaVp.latCenter - MAPA_PAN_STEP);
  document.getElementById('mapa-lat-center').value = mapaVp.latCenter;
  renderMapaGrid();
});
document.getElementById('mapa-pan-w').addEventListener('click', () => {
  mapaVp.lonCenter = Math.max(-180, mapaVp.lonCenter - MAPA_PAN_STEP);
  document.getElementById('mapa-lon-center').value = mapaVp.lonCenter;
  renderMapaGrid();
});
document.getElementById('mapa-pan-e').addEventListener('click', () => {
  mapaVp.lonCenter = Math.min(180, mapaVp.lonCenter + MAPA_PAN_STEP);
  document.getElementById('mapa-lon-center').value = mapaVp.lonCenter;
  renderMapaGrid();
});

document.getElementById('mapa-zoom-in').addEventListener('click', () => {
  mapaVp.cellSize = Math.min(32, mapaVp.cellSize + 4);
  renderMapaGrid();
});
document.getElementById('mapa-zoom-out').addEventListener('click', () => {
  mapaVp.cellSize = Math.max(4, mapaVp.cellSize - 4);
  renderMapaGrid();
});

// ── Mapa brush controls ───────────────────────────────────────────────────────

['mapa-brush-tipo','mapa-brush-estado','mapa-brush-bioma','mapa-brush-clima',
 'mapa-lock-tipo','mapa-lock-estado','mapa-lock-bioma','mapa-lock-clima',
 'mapa-eraser',
].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', syncMapaBrushState);
});

// Stop brush when mouse leaves the grid or is released anywhere on the page
document.getElementById('mapa-grid').addEventListener('mouseleave', () => {
  mapaBrushDown = false;
});
document.addEventListener('mouseup', () => {
  mapaBrushDown = false;
});

// ── Mapa cell editor save / clear ─────────────────────────────────────────────

document.getElementById('mapa-edit-save').addEventListener('click', () => {
  if (!mapaSelectedCell) return;
  const { lat, lon } = mapaSelectedCell;
  setCell(mapaWorld, lat, lon, {
    tipo:      document.getElementById('mapa-edit-tipo').value,
    estado_id: document.getElementById('mapa-edit-estado').value,
    bioma:     document.getElementById('mapa-edit-bioma').value,
    clima:     document.getElementById('mapa-edit-clima').value,
  });
  updateCellElement(lat, lon);
  setStatus(`Célula (${lat}, ${lon}) atualizada.`);
});

document.getElementById('mapa-edit-clear').addEventListener('click', () => {
  if (!mapaSelectedCell) return;
  const { lat, lon } = mapaSelectedCell;
  clearCell(mapaWorld, lat, lon);
  updateCellElement(lat, lon);
  document.getElementById('mapa-edit-tipo').value    = '';
  document.getElementById('mapa-edit-estado').value  = '';
  document.getElementById('mapa-edit-bioma').value   = '';
  document.getElementById('mapa-edit-clima').value   = '';
  setStatus(`Célula (${lat}, ${lon}) limpa.`);
});

// ── Simulação Econômica ───────────────────────────────────────────────────────

/** Last simulation result, keyed by stateId, for display persistence. */
const lastSimResults = {};

/**
 * Populate the estado select in the simulação tab from the loaded world.
 */
function populateSimulacaoEstadoSelect() {
  const sel = document.getElementById('sim-estado-select');
  if (!sel) return;
  const prev = sel.value;
  const opts = world.estados
    .map(s => `<option value="${esc(s.id)}">${esc(s.nome || s.id)}</option>`)
    .join('');
  sel.innerHTML = `<option value="">— Selecione um estado —</option>${opts}`;
  if (prev) sel.value = prev;
}

/**
 * Render the simulação tab UI and restore any previous result.
 */
function renderSimulacaoTab() {
  populateSimulacaoEstadoSelect();
  const sel       = document.getElementById('sim-estado-select');
  const stateId   = sel ? sel.value : '';
  if (stateId && lastSimResults[stateId]) {
    displaySimResult(lastSimResults[stateId]);
  }
}

/**
 * Display a simulation result in the UI.
 * Accepts the result of simulateEconomyBySegment() which embeds the macro result.
 * @param {{ macro: Object, shares: Object, segments: Object }} result
 */
function displaySimResult(result) {
  // Support both old (simulateEconomy) and new (simulateEconomyBySegment) shapes
  const hasSeg = result.segments != null;
  const { targetCompanies, series, meta } = hasSeg ? result.macro : result;
  const container = document.getElementById('sim-result');
  if (!container) return;

  const crisisCount = meta.totalCrises;

  // Summary cards
  let html = `
    <div class="sim-summary-grid">
      <div class="sim-card">
        <div class="sim-card-label">Empresas-alvo (base)</div>
        <div class="sim-card-value">${fmtNum(targetCompanies)}</div>
      </div>
      <div class="sim-card">
        <div class="sim-card-label">Empresas ao final</div>
        <div class="sim-card-value">${fmtNum(meta.finalCompanies)}</div>
      </div>
      <div class="sim-card">
        <div class="sim-card-label">Total de crises</div>
        <div class="sim-card-value" style="color:var(--red)">${crisisCount}</div>
      </div>
      <div class="sim-card">
        <div class="sim-card-label">Prob. crise/passo</div>
        <div class="sim-card-value">${(meta.crisisProb * 100).toFixed(0)}%</div>
      </div>
      <div class="sim-card">
        <div class="sim-card-label">Choque mín–máx</div>
        <div class="sim-card-value">${(meta.crisisMinShock*100).toFixed(0)}%–${(meta.crisisMaxShock*100).toFixed(0)}%</div>
      </div>
      <div class="sim-card">
        <div class="sim-card-label">Recuperação média</div>
        <div class="sim-card-value">${meta.avgRecoverySteps} passos</div>
      </div>
    </div>`;

  // ── Segment breakdown ────────────────────────────────────────────────────────
  if (hasSeg) {
    const segKeys   = Object.values(SEGMENTO);
    const segColors = {
      [SEGMENTO.POP_NAO_DURAVEL]: 'var(--green)',
      [SEGMENTO.POP_DURAVEL]:     'var(--blue)',
      [SEGMENTO.B2B]:             'var(--yellow)',
      [SEGMENTO.ESTADO]:          'var(--muted)',
    };

    html += `
      <h4 style="margin:1rem 0 0.4rem;font-size:0.85rem">📦 Segmentos (Público-Alvo)</h4>
      <div class="sim-summary-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">`;

    for (const seg of segKeys) {
      const sm      = SEGMENTO_META[seg];
      const segData = result.segments[seg];
      const last    = segData[segData.length - 1];
      const share   = ((result.shares[seg] ?? 0) * 100).toFixed(0);
      const hasStock = last.stockLevel != null;
      const stockLine = hasStock
        ? `<div style="font-size:0.72rem;color:var(--muted)">Estoque: ${(last.stockLevel * 100).toFixed(1)}%</div>`
        : '';
      html += `
        <div class="sim-card">
          <div class="sim-card-label" style="color:${segColors[seg]}">${esc(sm.label)}</div>
          <div class="sim-card-value">${fmtNum(last.companies)}</div>
          <div style="font-size:0.72rem;color:var(--muted)">Participação: ${share}%</div>
          <div style="font-size:0.72rem;color:var(--muted)">Demanda: ${(last.demand * 100).toFixed(1)}%</div>
          ${stockLine}
        </div>`;
    }
    html += '</div>';

    // Segment time-series table (collapsible via details)
    const MAX_ROWS = 120;
    const shown    = series.slice(0, MAX_ROWS);
    const hidden   = series.length - shown.length;

    html += `
      <details style="margin-top:1rem">
        <summary style="cursor:pointer;font-size:0.85rem;font-weight:600">
          📊 Série temporal por segmento
        </summary>
        <div class="table-wrap" style="margin-top:0.5rem;max-height:50vh;overflow-y:auto">
          <table>
            <thead><tr>
              <th>Passo</th>
              <th>Crise?</th>
              <th class="num">🟢 Pop. N-D</th>
              <th class="num">🔵 Pop. Dur.</th>
              <th class="num">Estoque (%)</th>
              <th class="num">🟡 B2B</th>
              <th class="num">⚫ Estado</th>
            </tr></thead>
            <tbody>`;

    for (const macroRow of shown) {
      const s = macroRow.step;
      const crisisFlag = macroRow.crisis
        ? '<span style="color:var(--red);font-weight:700">⚡</span>'
        : '<span style="color:var(--muted)">—</span>';

      // Segment series steps are 1-based and always align with macro steps (verified by simulation logic)
      const nd  = result.segments[SEGMENTO.POP_NAO_DURAVEL][s - 1];
      const dur = result.segments[SEGMENTO.POP_DURAVEL][s - 1];
      const b2b = result.segments[SEGMENTO.B2B][s - 1];
      const est = result.segments[SEGMENTO.ESTADO][s - 1];

      // Highlight durable demand in red when below 70% baseline (noticeable distress)
      const DUR_DEMAND_WARN = 0.70;
      // Use threshold from simulation params so UI and model stay in sync
      const DUR_STOCK_WARN  = SEGMENTO_DEMAND_PARAMS[SEGMENTO.POP_DURAVEL].stockThreshold;

      const durStyle = dur.demand < DUR_DEMAND_WARN ? ' style="color:var(--red)"' : '';
      const stockTxt = `${(dur.stockLevel * 100).toFixed(1)}%`;

      html += `<tr${macroRow.crisis ? ' style="background:rgba(248,113,113,0.08)"' : ''}>
        <td class="num">${s}</td>
        <td style="text-align:center">${crisisFlag}</td>
        <td class="num">${fmtNum(nd.companies)} <small style="color:var(--muted)">(${(nd.demand*100).toFixed(0)}%)</small></td>
        <td class="num"${durStyle}>${fmtNum(dur.companies)} <small style="color:var(--muted)">(${(dur.demand*100).toFixed(0)}%)</small></td>
        <td class="num" style="color:${dur.stockLevel < DUR_STOCK_WARN ? 'var(--yellow)' : 'inherit'}">${stockTxt}</td>
        <td class="num">${fmtNum(b2b.companies)} <small style="color:var(--muted)">(${(b2b.demand*100).toFixed(0)}%)</small></td>
        <td class="num">${fmtNum(est.companies)} <small style="color:var(--muted)">(${(est.demand*100).toFixed(0)}%)</small></td>
      </tr>`;
    }

    html += '</tbody></table></div>';
    if (hidden > 0) {
      html += `<p style="font-size:0.75rem;color:var(--muted);margin-top:0.4rem">… e mais ${hidden} passos (limitado a ${MAX_ROWS} linhas na exibição).</p>`;
    }
    html += '</details>';

  } else {
    // Fallback: legacy macro-only table
    const MAX_ROWS = 120;
    const shown  = series.slice(0, MAX_ROWS);
    const hidden = series.length - shown.length;

    html += `
      <div class="table-wrap" style="margin-top:1rem;max-height:50vh;overflow-y:auto">
        <table>
          <thead><tr>
            <th>Passo</th>
            <th class="num">Empresas</th>
            <th>Crise?</th>
            <th class="num">Choque</th>
            <th>Recuperando?</th>
          </tr></thead>
          <tbody>`;

    for (const row of shown) {
      const crisisFlag = row.crisis
        ? '<span style="color:var(--red);font-weight:700">⚡ sim</span>'
        : '<span style="color:var(--muted)">—</span>';
      const recFlag = row.recovering
        ? '<span style="color:var(--yellow)">↗ sim</span>'
        : '<span style="color:var(--muted)">—</span>';
      const shockFmt = row.crisis
        ? `<span style="color:var(--red)">-${(row.crisisShock * 100).toFixed(1)}%</span>`
        : '<span style="color:var(--muted)">—</span>';
      html += `<tr${row.crisis ? ' style="background:rgba(248,113,113,0.08)"' : ''}>
        <td class="num">${row.step}</td>
        <td class="num">${fmtNum(row.companies)}</td>
        <td style="text-align:center">${crisisFlag}</td>
        <td class="num">${shockFmt}</td>
        <td style="text-align:center">${recFlag}</td>
      </tr>`;
    }

    html += '</tbody></table></div>';
    if (hidden > 0) {
      html += `<p style="font-size:0.75rem;color:var(--muted);margin-top:0.4rem">… e mais ${hidden} passos (limitado a ${MAX_ROWS} linhas na exibição).</p>`;
    }
  }

  container.innerHTML = html;
}

// ── Simulation run handler ────────────────────────────────────────────────────
document.getElementById('btn-run-sim')?.addEventListener('click', () => {
  const stateId = document.getElementById('sim-estado-select')?.value;
  if (!stateId) {
    setStatus('⚠ Selecione um estado para simular.');
    return;
  }

  const estado = world.estados.find(s => s.id === stateId);
  if (!estado) {
    setStatus('⚠ Estado não encontrado.');
    return;
  }

  const population    = estado.atributos?.populacao ?? 0;
  const economicState = document.getElementById('sim-econ-state')?.value ?? 'estavel';
  const steps         = parseInt(document.getElementById('sim-steps')?.value ?? '60', 10) || 60;
  const k             = parseFloat(document.getElementById('sim-k')?.value ?? '1000') || 1000;
  const seedRaw       = document.getElementById('sim-seed')?.value?.trim();
  const seed          = seedRaw ? (parseInt(seedRaw, 10) || undefined) : undefined;

  try {
    const result = simulateEconomyBySegment({ stateId, population, economicState, steps, k, seed });
    lastSimResults[stateId] = result;
    displaySimResult(result);
    setStatus(
      `✅ Simulação de "${esc(estado.nome || stateId)}" concluída: ` +
      `${result.macro.meta.totalCrises} crises em ${steps} passos.`
    );
    // Persist last simulation result to IDB via regular save cycle
    if (db) scheduleAutoSave(db);
  } catch (err) {
    setStatus(`Erro na simulação: ${err.message}`);
    console.error('[simulacao]', err);
  }
});

// Update simulation tab select when states change
document.getElementById('sim-estado-select')?.addEventListener('change', () => {
  const stateId = document.getElementById('sim-estado-select').value;
  const container = document.getElementById('sim-result');
  if (!stateId || !lastSimResults[stateId]) {
    if (container) container.innerHTML = '<div class="empty-state">Configure os parâmetros e clique em "▶ Simular".</div>';
  } else {
    displaySimResult(lastSimResults[stateId]);
  }
});

// ── Initialise ────────────────────────────────────────────────────────────────
async function initApp() {
  updateTickCounter();
  populateInjectionEntitySelect();
  renderInjectionsList();
  populateTransferSelects();

  setStatus('Inicializando banco de dados…');
  try {
    db    = await getDb();
    world = loadWorldFromDb(db);
    renderAll();
    setStatus(
      world.pessoas.length || world.empresas.length || world.estados.length
        ? '✅ Dados carregados do banco.'
        : '💡 Banco de dados vazio. Adicione estados, pessoas e empresas.'
    );
  } catch (err) {
    setStatus(`Erro ao inicializar banco: ${err.message}`);
    console.error('[initApp]', err);
  }
}

initApp();
