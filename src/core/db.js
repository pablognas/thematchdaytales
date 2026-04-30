/**
 * db.js — SQLite persistence layer using sql.js + IndexedDB.
 *
 * Browser: sql.js is loaded from CDN (initSqlJs on globalThis).
 * Tests:   call setInitSqlJs(fn) before getDb() to inject the Node.js factory.
 *
 * Public API:
 *   setInitSqlJs(fn)           — inject sql.js factory (for tests)
 *   getDb()                    — async singleton; returns an initialised SQL.Database
 *   loadWorldFromDb(db)        — read all world entities from the SQLite DB
 *   saveWorldToDb(db, world)   — replace all world entities in the SQLite DB (sync)
 *   scheduleAutoSave(db)       — debounced (500 ms) persist of DB bytes to IndexedDB
 *   exportDbFile(db)           — download a .sqlite backup (browser only)
 *   importDbFromBuffer(bytes)  — restore DB from a .sqlite backup Uint8Array (browser only)
 *   resetDb()                  — clear IndexedDB entry and reload (browser only)
 */

import { loadDbFromIndexedDb, saveDbToIndexedDb, clearDbFromIndexedDb } from './idb.js';
import {
  rowsToPessoas,  pessoasToRows,
  rowsToEmpresas, empresasToRows,
  rowsToEstados,  estadosToRows,
  applyAtivos,    worldAtivosToRows,
} from './world.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_VERSION   = 1;
const WASM_CDN_URL = 'https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist/';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS estados (
  id                   TEXT PRIMARY KEY,
  nome                 TEXT NOT NULL DEFAULT '',
  tipo                 TEXT DEFAULT '',
  parent_id            TEXT DEFAULT '',
  descricao            TEXT DEFAULT '',
  patrimonio           REAL DEFAULT 0,
  populacao            REAL DEFAULT 0,
  forcas_armadas       REAL DEFAULT 1,
  cultura              REAL DEFAULT 1,
  moral_populacao      REAL DEFAULT 3,
  renda_tributaria     REAL DEFAULT 0,
  ir_pf                REAL DEFAULT 0,
  ir_pj                REAL DEFAULT 0,
  imp_prod             REAL DEFAULT 0,
  salarios_politicos   REAL DEFAULT 0,
  incentivos_empresas  REAL DEFAULT 0,
  investimento_cultura REAL DEFAULT 0,
  investimento_fa      REAL DEFAULT 0,
  infra_creche            INTEGER DEFAULT 0,
  infra_escola_primaria   INTEGER DEFAULT 0,
  infra_escola_secundaria INTEGER DEFAULT 0,
  infra_ensino_medio      INTEGER DEFAULT 0,
  infra_universidade      INTEGER DEFAULT 0,
  infra_rodoviaria        INTEGER DEFAULT 0,
  infra_aeroporto         INTEGER DEFAULT 0,
  infra_porto             INTEGER DEFAULT 0,
  infra_estacao_trem      INTEGER DEFAULT 0,
  infra_metro             INTEGER DEFAULT 0,
  infra_onibus_municipais INTEGER DEFAULT 0,
  infra_centro_comercial  INTEGER DEFAULT 0,
  tick_registro        INTEGER DEFAULT 0,
  tick_saida           INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS empresas (
  id                    TEXT PRIMARY KEY,
  nome                  TEXT NOT NULL DEFAULT '',
  dono_id               TEXT DEFAULT '',
  estado_id             TEXT DEFAULT '',
  segmento              TEXT DEFAULT 'POP_NAO_DURAVEL',
  infraestrutura        TEXT DEFAULT '',
  patrimonio            REAL DEFAULT 0,
  funcionarios          REAL DEFAULT 0,
  renda                 REAL DEFAULT 0,
  producao              REAL DEFAULT 0,
  moral_corporativa     REAL DEFAULT 3,
  reputacao_corporativa REAL DEFAULT 3,
  lucro                 REAL DEFAULT 0,
  salario_funcionario   REAL DEFAULT 0,
  manutencao            REAL DEFAULT 0,
  insumos               REAL DEFAULT 0,
  tick_registro         INTEGER DEFAULT 0,
  tick_saida            INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pessoas (
  id                TEXT PRIMARY KEY,
  nome              TEXT NOT NULL DEFAULT '',
  classe            TEXT DEFAULT '',
  estado_id         TEXT DEFAULT '',
  influencia        REAL DEFAULT 1,
  patrimonio        REAL DEFAULT 1,
  moral             REAL DEFAULT 3,
  reputacao         REAL DEFAULT 1,
  renda_mensal      REAL DEFAULT 0,
  caixa             REAL DEFAULT 0,
  gastos_influencia INTEGER DEFAULT 1,
  gastos_moral      INTEGER DEFAULT 1,
  gastos_reputacao  INTEGER DEFAULT 1,
  nota_scouting     REAL DEFAULT 0,
  valor_mercado     REAL DEFAULT 0,
  posicao           TEXT DEFAULT '',
  clube             TEXT DEFAULT '',
  clube_emprestador TEXT DEFAULT '',
  tick_registro     INTEGER DEFAULT 0,
  tick_saida        INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ativos (
  owner_type TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  ativo_id   TEXT NOT NULL,
  valor      REAL DEFAULT 0,
  PRIMARY KEY (owner_type, owner_id, ativo_id)
);
`;

// ── Internal state ────────────────────────────────────────────────────────────

let _initSqlJs = null;   // injected for tests; otherwise uses globalThis.initSqlJs
let _db        = null;   // singleton sql.js Database instance
let _saveTimer = null;   // debounce timer for auto-saves

// ── sql.js factory injection (for tests) ─────────────────────────────────────

/**
 * Inject a custom sql.js initialiser function.
 * Must be called before getDb() when running in Node.js / tests.
 * @param {Function} fn  The initSqlJs factory (as exported by the sql.js npm package).
 */
export function setInitSqlJs(fn) {
  _initSqlJs = fn;
}

/**
 * Reset the singleton for testing so that getDb() creates a fresh instance.
 */
export function resetDbSingleton() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  _db = null;
}

// ── sql.js loader ─────────────────────────────────────────────────────────────

async function loadSqlJs() {
  if (_initSqlJs) {
    // Test / Node.js environment — factory provided explicitly; no locateFile needed.
    return _initSqlJs();
  }
  const globalFactory = typeof globalThis !== 'undefined' && globalThis.initSqlJs;
  if (globalFactory) {
    // Browser environment — point to CDN for the WASM file.
    return globalFactory({ locateFile: f => `${WASM_CDN_URL}${f}` });
  }
  throw new Error(
    'sql.js não disponível. Carregue o script sql-wasm.js ou chame setInitSqlJs().'
  );
}

// ── Migrations ────────────────────────────────────────────────────────────────

function runMigrations(db) {
  db.run(SCHEMA_SQL);
  db.run(`INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)`, [String(DB_VERSION)]);
}

// ── Singleton DB accessor ─────────────────────────────────────────────────────

/**
 * Return the initialised sql.js Database singleton.
 * On first call:
 *   - Attempts to load existing DB bytes from IndexedDB.
 *   - If found, opens DB from those bytes and runs any pending migrations.
 *   - If not found, creates a new empty DB, runs schema, and persists it.
 * @returns {Promise<import('sql.js').Database>}
 */
export async function getDb() {
  if (_db) return _db;

  const SQL   = await loadSqlJs();
  const bytes = await loadDbFromIndexedDb();

  if (bytes) {
    _db = new SQL.Database(bytes);
    runMigrations(_db);          // apply any new migrations on existing DB
  } else {
    _db = new SQL.Database();
    runMigrations(_db);
    await saveDbToIndexedDb(_db.export());  // persist the initial empty schema
  }

  return _db;
}

// ── SQL helpers ───────────────────────────────────────────────────────────────

/**
 * Convert sql.js exec() result to an array of plain objects.
 * @param {Array} result  The return value of db.exec(sql)
 * @returns {Object[]}
 */
function sqlToRows(result) {
  if (!result || !result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

/**
 * Insert an array of flat-row objects into a table using a prepared statement.
 * @param {import('sql.js').Database} db
 * @param {string}   table
 * @param {string[]} columns  ordered list of column names
 * @param {Object[]} rows
 */
function insertRows(db, table, columns, rows) {
  if (!rows.length) return;
  const placeholders = columns.map(() => '?').join(', ');
  const stmt = db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
  );
  for (const row of rows) {
    stmt.run(columns.map(c => row[c] ?? null));
  }
  stmt.free();
}

// ── Column definitions ────────────────────────────────────────────────────────

const PESSOAS_COLS = [
  'id', 'nome', 'classe', 'estado_id',
  'influencia', 'patrimonio', 'moral', 'reputacao',
  'renda_mensal', 'caixa',
  'gastos_influencia', 'gastos_moral', 'gastos_reputacao',
  'nota_scouting', 'valor_mercado',
  'posicao', 'clube', 'clube_emprestador',
  'tick_registro', 'tick_saida',
];

const EMPRESAS_COLS = [
  'id', 'nome', 'dono_id', 'estado_id', 'segmento', 'infraestrutura',
  'patrimonio', 'funcionarios', 'renda', 'producao',
  'moral_corporativa', 'reputacao_corporativa', 'lucro',
  'salario_funcionario', 'manutencao', 'insumos',
  'tick_registro', 'tick_saida',
];

const ESTADOS_COLS = [
  'id', 'nome', 'tipo', 'parent_id', 'descricao',
  'patrimonio', 'populacao', 'forcas_armadas', 'cultura', 'moral_populacao',
  'renda_tributaria', 'ir_pf', 'ir_pj', 'imp_prod',
  'salarios_politicos', 'incentivos_empresas', 'investimento_cultura', 'investimento_fa',
  'infra_creche', 'infra_escola_primaria', 'infra_escola_secundaria', 'infra_ensino_medio',
  'infra_universidade', 'infra_rodoviaria', 'infra_aeroporto', 'infra_porto',
  'infra_estacao_trem', 'infra_metro', 'infra_onibus_municipais', 'infra_centro_comercial',
  'tick_registro', 'tick_saida',
];

const ATIVOS_COLS = ['owner_type', 'owner_id', 'ativo_id', 'valor'];

// ── World ↔ DB ────────────────────────────────────────────────────────────────

/**
 * Load all world entities from the SQLite database.
 * @param {import('sql.js').Database} db
 * @returns {{ pessoas: Object[], empresas: Object[], estados: Object[] }}
 */
export function loadWorldFromDb(db) {
  const pessoas  = rowsToPessoas( sqlToRows(db.exec('SELECT * FROM pessoas')));
  const empresas = rowsToEmpresas(sqlToRows(db.exec('SELECT * FROM empresas')));
  const estados  = rowsToEstados( sqlToRows(db.exec('SELECT * FROM estados')));
  const world    = { pessoas, empresas, estados };

  const ativosRows = sqlToRows(db.exec('SELECT * FROM ativos'));
  if (ativosRows.length) applyAtivos(world, ativosRows);

  return world;
}

/**
 * Persist all world entities to the SQLite database (synchronous, in a transaction).
 * Replaces all existing rows in the entity tables.
 * @param {import('sql.js').Database} db
 * @param {{ pessoas: Object[], empresas: Object[], estados: Object[] }} world
 */
export function saveWorldToDb(db, world) {
  db.run('BEGIN TRANSACTION');
  try {
    db.run('DELETE FROM pessoas');
    db.run('DELETE FROM empresas');
    db.run('DELETE FROM estados');
    db.run('DELETE FROM ativos');

    insertRows(db, 'pessoas',  PESSOAS_COLS,  pessoasToRows(world.pessoas));
    insertRows(db, 'empresas', EMPRESAS_COLS, empresasToRows(world.empresas));
    insertRows(db, 'estados',  ESTADOS_COLS,  estadosToRows(world.estados));
    insertRows(db, 'ativos',   ATIVOS_COLS,   worldAtivosToRows(world));

    db.run('COMMIT');
  } catch (err) {
    try { db.run('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

// ── Auto-save ─────────────────────────────────────────────────────────────────

/**
 * Schedule a debounced (500 ms) export of DB bytes to IndexedDB.
 * Calling this repeatedly resets the timer (batches rapid changes).
 * @param {import('sql.js').Database} db
 */
export function scheduleAutoSave(db) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    _saveTimer = null;
    try {
      await saveDbToIndexedDb(db.export());
    } catch (err) {
      console.error('[db] auto-save failed:', err);
    }
  }, 500);
}

// ── Developer utilities ───────────────────────────────────────────────────────

/**
 * Download the current DB as a .sqlite backup file (browser only).
 * @param {import('sql.js').Database} db
 */
export function exportDbFile(db) {
  const bytes = db.export();
  const blob  = new Blob([bytes], { type: 'application/x-sqlite3' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = 'matchday-tales.sqlite';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * SQLite file magic header (first 16 bytes of any valid .sqlite file).
 * ASCII: "SQLite format 3\000"
 */
const SQLITE_MAGIC = [0x53,0x51,0x4C,0x69,0x74,0x65,0x20,0x66,0x6F,0x72,0x6D,0x61,0x74,0x20,0x33,0x00];

/**
 * Validate that the given bytes look like a SQLite database.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function isSqliteBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) return false;
  return SQLITE_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Restore the database from a raw .sqlite backup buffer.
 * Validates the magic header, applies any pending migrations, persists the
 * new bytes to IndexedDB, and reloads the page.  Browser only.
 *
 * @param {Uint8Array} bytes  Raw bytes of a .sqlite backup file.
 * @throws {Error} If the bytes do not appear to be a valid SQLite file.
 */
export async function importDbFromBuffer(bytes) {
  if (!isSqliteBytes(bytes)) {
    throw new Error('Arquivo inválido: não é um banco de dados SQLite (.sqlite).');
  }

  const SQL = await loadSqlJs();
  let imported;
  try {
    imported = new SQL.Database(bytes);
  } catch (err) {
    throw new Error(`Falha ao abrir o arquivo SQLite: ${err.message}`);
  }

  // Apply any pending schema migrations so the imported DB is up-to-date.
  runMigrations(imported);

  // Cancel any in-flight auto-save and discard the current singleton.
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  _db = null;

  // Persist the imported bytes to IndexedDB, then reload.
  await saveDbToIndexedDb(imported.export());
  imported.close();
  globalThis.location.reload();
}

/**
 * Clear the stored DB bytes from IndexedDB and reload the page (full reset).
 * Browser only.
 */
export async function resetDb() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  _db = null;
  await clearDbFromIndexedDb();
  globalThis.location.reload();
}
