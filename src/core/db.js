/**
 * db.js — SQLite persistence layer using sql.js (WASM) + IndexedDB.
 *
 * Startup flow:
 *  1. initDb() tries to load DB bytes from IndexedDB.
 *  2. If found, opens the DB from those bytes and runs any pending migrations.
 *  3. If not found, creates a fresh DB, applies the schema, seeds from CSV
 *     default files (fetched from the server), and persists to IndexedDB.
 *
 * After every write operation (mutations) the caller should call:
 *   saveDbBytesToIdb(db.export())
 * The app.js layer does this with a debounced auto-save helper.
 *
 * Schema version: 1
 */

import { loadDbBytesFromIdb, saveDbBytesToIdb } from './idb.js';
import { parseCsv } from './csv.js';
import {
  rowsToPessoas, pessoasToRows,
  rowsToEmpresas, empresasToRows,
  rowsToEstados,  estadosToRows,
  applyAtivos, worldAtivosToRows,
} from './world.js';
import { rowsToMapa, mapaToRows } from './map.js';

/** Current schema version stored in the `schema_version` table. */
export const SCHEMA_VERSION = 1;

/** CDN base URL for sql.js assets (script + WASM). */
const SQL_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0';

// Module-level cache so initSqlJs() is only called once.
let _sqlJsPromise = null;

// ── SQL.js loader ─────────────────────────────────────────────────────────────

/**
 * Obtain the sql.js library.
 * In the browser, `window.initSqlJs` must have been loaded via the CDN
 * <script> tag in index.html before this is called.
 * Pass an injected library object when testing (avoids CDN dependency).
 *
 * @param {object|null} [injected]  pre-initialised SQL.js library (for tests)
 * @returns {Promise<object>}  sql.js SQL namespace
 */
async function getSqlJs(injected) {
  if (injected) return injected;
  if (_sqlJsPromise) return _sqlJsPromise;
  if (typeof window === 'undefined' || typeof window.initSqlJs !== 'function') {
    throw new Error(
      'sql.js not loaded. Add <script src="…/sql-wasm.js"></script> to index.html.',
    );
  }
  _sqlJsPromise = window.initSqlJs({
    locateFile: file => `${SQL_JS_CDN}/${file}`,
  });
  return _sqlJsPromise;
}

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * Create all tables and record the schema version.
 * Safe to call on a freshly opened DB (uses CREATE TABLE IF NOT EXISTS).
 * @param {object} db  sql.js Database instance
 */
export function createSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id      INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL
    );
    INSERT OR REPLACE INTO schema_version (id, version) VALUES (1, ${SCHEMA_VERSION});

    CREATE TABLE IF NOT EXISTS pessoas (
      id                  TEXT PRIMARY KEY,
      nome                TEXT,
      classe              TEXT,
      estado_id           TEXT,
      influencia          REAL,
      patrimonio          REAL,
      moral               REAL,
      reputacao           REAL,
      renda_mensal        REAL,
      caixa               REAL,
      gastos_influencia   INTEGER,
      gastos_moral        INTEGER,
      gastos_reputacao    INTEGER,
      nota_scouting       REAL,
      valor_mercado       REAL,
      posicao             TEXT,
      clube               TEXT,
      clube_emprestador   TEXT,
      tick_registro       INTEGER,
      tick_saida          INTEGER
    );

    CREATE TABLE IF NOT EXISTS empresas (
      id                    TEXT PRIMARY KEY,
      nome                  TEXT,
      dono_id               TEXT,
      estado_id             TEXT,
      patrimonio            REAL,
      funcionarios          REAL,
      renda                 REAL,
      producao              REAL,
      moral_corporativa     REAL,
      reputacao_corporativa REAL,
      lucro                 REAL,
      salario_funcionario   REAL,
      manutencao            REAL,
      insumos               REAL,
      tick_registro         INTEGER,
      tick_saida            INTEGER
    );

    CREATE TABLE IF NOT EXISTS estados (
      id                    TEXT PRIMARY KEY,
      nome                  TEXT,
      tipo                  TEXT,
      parent_id             TEXT,
      descricao             TEXT,
      patrimonio            REAL,
      populacao             REAL,
      forcas_armadas        REAL,
      cultura               REAL,
      moral_populacao       REAL,
      renda_tributaria      REAL,
      ir_pf                 REAL,
      ir_pj                 REAL,
      imp_prod              REAL,
      salarios_politicos    REAL,
      incentivos_empresas   REAL,
      investimento_cultura  REAL,
      investimento_fa       REAL,
      tick_registro         INTEGER,
      tick_saida            INTEGER
    );

    CREATE TABLE IF NOT EXISTS ativos (
      owner_type  TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      ativo_id    TEXT NOT NULL,
      valor       REAL,
      PRIMARY KEY (owner_type, owner_id, ativo_id)
    );

    CREATE TABLE IF NOT EXISTS mapa (
      lat       INTEGER NOT NULL,
      lon       INTEGER NOT NULL,
      tipo      TEXT,
      estado_id TEXT,
      bioma     TEXT,
      clima     TEXT,
      PRIMARY KEY (lat, lon)
    );
  `);
}

// ── Migrations ────────────────────────────────────────────────────────────────

/**
 * Check the stored schema version and apply any pending migrations.
 * If the schema_version table is missing (newly created DB) the schema is created.
 * @param {object} db
 */
function runMigrations(db) {
  const tables = db.exec(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`,
  );
  if (!tables.length || !tables[0].values.length) {
    // Brand-new DB without schema — create it now.
    createSchema(db);
    return;
  }
  const rows    = db.exec('SELECT version FROM schema_version WHERE id = 1');
  const current = rows[0]?.values[0]?.[0] ?? 0;
  if (current < SCHEMA_VERSION) {
    // Placeholder for future migrations.
    db.run('UPDATE schema_version SET version = ? WHERE id = 1', [SCHEMA_VERSION]);
  }
}

// ── CSV seed helpers ──────────────────────────────────────────────────────────

/**
 * Fetch the default CSV seed files from the server.
 * @param {string} [base='..']  base URL relative to the page
 * @returns {Promise<{pessoas:string, empresas:string, estados:string, ativos:string, mapa:string}>}
 */
export async function fetchCsvSeeds(base = '..') {
  const [pessoas, empresas, estados, ativos, mapa] = await Promise.all([
    fetch(`${base}/data/world/pessoas.csv`).then(r => r.text()).catch(() => ''),
    fetch(`${base}/data/world/empresas.csv`).then(r => r.text()).catch(() => ''),
    fetch(`${base}/data/world/estados.csv`).then(r => r.text()).catch(() => ''),
    fetch(`${base}/data/world/ativos.csv`).then(r => r.text()).catch(() => ''),
    fetch(`${base}/data/world/mapa.csv`).then(r => r.text()).catch(() => ''),
  ]);
  return { pessoas, empresas, estados, ativos, mapa };
}

/**
 * Populate the database from CSV text strings.
 * Replaces all existing rows in pessoas/empresas/estados/ativos/mapa.
 *
 * @param {object} db
 * @param {{pessoas?:string, empresas?:string, estados?:string, ativos?:string, mapa?:string}} csvTexts
 */
export function seedDbFromCsvText(db, csvTexts) {
  const {
    pessoas  = '',
    empresas = '',
    estados  = '',
    ativos   = '',
    mapa     = '',
  } = csvTexts;

  const worldData = { pessoas: [], empresas: [], estados: [] };
  if (pessoas)  worldData.pessoas  = rowsToPessoas(parseCsv(pessoas));
  if (empresas) worldData.empresas = rowsToEmpresas(parseCsv(empresas));
  if (estados)  worldData.estados  = rowsToEstados(parseCsv(estados));
  if (ativos)   applyAtivos(worldData, parseCsv(ativos));

  const mapaData = mapa ? rowsToMapa(parseCsv(mapa)) : {};

  saveWorldToDb(db, worldData, mapaData);
}

// ── Save world to DB ──────────────────────────────────────────────────────────

/**
 * Persist the entire world state into the SQLite database (full replace).
 * Wraps all deletes + inserts in a single transaction.
 *
 * @param {object} db
 * @param {{ pessoas: object[], empresas: object[], estados: object[] }} world
 * @param {object} [mapaWorld]
 */
export function saveWorldToDb(db, world, mapaWorld = {}) {
  db.run('BEGIN TRANSACTION');
  try {
    db.run('DELETE FROM pessoas');
    db.run('DELETE FROM empresas');
    db.run('DELETE FROM estados');
    db.run('DELETE FROM ativos');
    db.run('DELETE FROM mapa');

    // ── Pessoas ──────────────────────────────────────────────────────────
    for (const r of pessoasToRows(world.pessoas || [])) {
      db.run(
        `INSERT INTO pessoas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          r.id, r.nome, r.classe, r.estado_id,
          r.influencia, r.patrimonio, r.moral, r.reputacao,
          r.renda_mensal, r.caixa,
          r.gastos_influencia, r.gastos_moral, r.gastos_reputacao,
          r.nota_scouting, r.valor_mercado,
          r.posicao, r.clube, r.clube_emprestador,
          r.tick_registro, r.tick_saida,
        ],
      );
    }

    // ── Empresas ─────────────────────────────────────────────────────────
    for (const r of empresasToRows(world.empresas || [])) {
      db.run(
        `INSERT INTO empresas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          r.id, r.nome, r.dono_id, r.estado_id,
          r.patrimonio, r.funcionarios, r.renda, r.producao,
          r.moral_corporativa, r.reputacao_corporativa, r.lucro,
          r.salario_funcionario, r.manutencao, r.insumos,
          r.tick_registro, r.tick_saida,
        ],
      );
    }

    // ── Estados ──────────────────────────────────────────────────────────
    for (const r of estadosToRows(world.estados || [])) {
      db.run(
        `INSERT INTO estados VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          r.id, r.nome, r.tipo, r.parent_id, r.descricao,
          r.patrimonio, r.populacao, r.forcas_armadas, r.cultura, r.moral_populacao,
          r.renda_tributaria, r.ir_pf, r.ir_pj, r.imp_prod,
          r.salarios_politicos, r.incentivos_empresas, r.investimento_cultura, r.investimento_fa,
          r.tick_registro, r.tick_saida,
        ],
      );
    }

    // ── Ativos ───────────────────────────────────────────────────────────
    for (const r of worldAtivosToRows(world)) {
      db.run(
        `INSERT INTO ativos VALUES (?,?,?,?)`,
        [r.owner_type, r.owner_id, r.ativo_id, r.valor],
      );
    }

    // ── Mapa ─────────────────────────────────────────────────────────────
    for (const r of mapaToRows(mapaWorld)) {
      db.run(
        `INSERT INTO mapa VALUES (?,?,?,?,?,?)`,
        [r.lat, r.lon, r.tipo || '', r.estado_id || '', r.bioma || '', r.clima || ''],
      );
    }

    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }
}

// ── Load world from DB ────────────────────────────────────────────────────────

/**
 * Load all world entities and the map from the SQLite database.
 * Ativos are merged into their owning entities after loading.
 *
 * @param {object} db
 * @returns {{ world: {pessoas:object[], empresas:object[], estados:object[]}, mapaWorld: object }}
 */
export function loadWorldFromDb(db) {
  const world = { pessoas: [], empresas: [], estados: [] };

  // Helper: query result → array of plain objects
  function toObjects(result) {
    if (!result.length) return [];
    const cols = result[0].columns;
    return result[0].values.map(row =>
      Object.fromEntries(cols.map((c, i) => [c, row[i]])),
    );
  }

  // ── Load ativos first (applied after entities are created) ───────────
  const ativosRows = toObjects(
    db.exec('SELECT owner_type, owner_id, ativo_id, valor FROM ativos'),
  );

  // ── Pessoas ──────────────────────────────────────────────────────────
  const pessoaRows = toObjects(db.exec(`
    SELECT id, nome, classe, estado_id,
           influencia, patrimonio, moral, reputacao,
           renda_mensal, caixa,
           gastos_influencia, gastos_moral, gastos_reputacao,
           nota_scouting, valor_mercado,
           posicao, clube, clube_emprestador,
           tick_registro, tick_saida
    FROM pessoas
  `));
  world.pessoas = rowsToPessoas(pessoaRows);

  // ── Empresas ─────────────────────────────────────────────────────────
  const empresaRows = toObjects(db.exec(`
    SELECT id, nome, dono_id, estado_id,
           patrimonio, funcionarios, renda, producao,
           moral_corporativa, reputacao_corporativa, lucro,
           salario_funcionario, manutencao, insumos,
           tick_registro, tick_saida
    FROM empresas
  `));
  world.empresas = rowsToEmpresas(empresaRows);

  // ── Estados ──────────────────────────────────────────────────────────
  const estadoRows = toObjects(db.exec(`
    SELECT id, nome, tipo, parent_id, descricao,
           patrimonio, populacao, forcas_armadas, cultura, moral_populacao,
           renda_tributaria, ir_pf, ir_pj, imp_prod,
           salarios_politicos, incentivos_empresas, investimento_cultura, investimento_fa,
           tick_registro, tick_saida
    FROM estados
  `));
  world.estados = rowsToEstados(estadoRows);

  // ── Apply ativos to all entities ─────────────────────────────────────
  if (ativosRows.length) applyAtivos(world, ativosRows);

  // ── Mapa ─────────────────────────────────────────────────────────────
  const mapaDbRows = toObjects(
    db.exec('SELECT lat, lon, tipo, estado_id, bioma, clima FROM mapa'),
  );
  // rowsToMapa expects string lat/lon keys (it calls parseInt internally)
  const mapaWorld = mapaDbRows.length
    ? rowsToMapa(mapaDbRows.map(r => ({
        lat:      String(r.lat),
        lon:      String(r.lon),
        tipo:     r.tipo      ?? '',
        estado_id: r.estado_id ?? '',
        bioma:    r.bioma     ?? '',
        clima:    r.clima     ?? '',
      })))
    : {};

  return { world, mapaWorld };
}

// ── Main initialiser ──────────────────────────────────────────────────────────

/**
 * Initialise the SQLite database.
 *
 * 1. Attempts to restore the DB from IndexedDB bytes (returning user).
 * 2. Falls back to creating a fresh DB seeded from the default CSV files.
 *
 * @param {object} [options]
 * @param {object}  [options.sqlJs]     injected SQL.js library (for tests)
 * @param {object}  [options.csvSeeds]  {pessoas,empresas,estados,ativos,mapa} CSV strings (for tests)
 * @param {boolean} [options.skipIdb]   skip IndexedDB entirely (for tests)
 * @param {string}  [options.dataBase]  base URL for fetching CSV seeds (default '..')
 * @returns {Promise<object>}  sql.js Database instance
 */
export async function initDb(options = {}) {
  const SQL = await getSqlJs(options.sqlJs ?? null);

  // ── Try to restore from IndexedDB ────────────────────────────────────
  if (!options.skipIdb) {
    try {
      const bytes = await loadDbBytesFromIdb();
      if (bytes) {
        const db = new SQL.Database(bytes);
        runMigrations(db);
        return db;
      }
    } catch (err) {
      console.warn('matchday: IDB load failed, creating fresh DB:', err);
    }
  }

  // ── Create fresh database ────────────────────────────────────────────
  const db = new SQL.Database();
  createSchema(db);

  // Seed from CSV data
  const seeds = options.csvSeeds !== undefined
    ? options.csvSeeds
    : await fetchCsvSeeds(options.dataBase);
  if (seeds && typeof seeds === 'object' && Object.keys(seeds).length > 0) {
    seedDbFromCsvText(db, seeds);
  }

  // Persist initial state
  if (!options.skipIdb) {
    try {
      await saveDbBytesToIdb(db.export());
    } catch (err) {
      console.warn('matchday: IDB save failed:', err);
    }
  }

  return db;
}

// ── Reset helper ──────────────────────────────────────────────────────────────

/**
 * Re-seed the database from the default CSV files (or provided csvSeeds).
 * Clears all world data first, then imports fresh CSV content.
 * Persists updated bytes to IndexedDB unless skipIdb is true.
 *
 * @param {object}  db
 * @param {object}  [options]
 * @param {object}  [options.csvSeeds]  pre-loaded CSV strings (skips fetch)
 * @param {boolean} [options.skipIdb]   skip IndexedDB persistence
 * @param {string}  [options.dataBase]  base URL for CSV files
 * @returns {Promise<void>}
 */
export async function resetDbFromCsvSeeds(db, options = {}) {
  const seeds = options.csvSeeds !== undefined
    ? options.csvSeeds
    : await fetchCsvSeeds(options.dataBase);

  seedDbFromCsvText(db, seeds ?? {});

  if (!options.skipIdb) {
    try {
      await saveDbBytesToIdb(db.export());
    } catch (err) {
      console.warn('matchday: IDB save after reset failed:', err);
    }
  }
}

// ── Export helper ─────────────────────────────────────────────────────────────

/**
 * Trigger a browser download of the SQLite database as a .db file.
 * @param {object} db
 * @param {string} [filename='matchday.db']
 */
export function exportDbFile(db, filename = 'matchday.db') {
  const bytes = db.export();
  const blob  = new Blob([bytes], { type: 'application/octet-stream' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
