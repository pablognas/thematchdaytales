/**
 * db.js — SQLite persistence layer for the browser, powered by sql.js
 *         (SQLite compiled to WebAssembly).
 *
 * Usage:
 *   1. Load sql.js **before** this ES module:
 *        <script src="https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.min.js"></script>
 *   2. Call `await initDb()` once at startup.
 *   3. Call `loadWorldFromDb()` to get the world object.
 *   4. After every mutation call `saveWorldToDb(world)`.
 *
 * The database lives in memory (sql.js). After every write it is serialised
 * as a base64 blob and stored in localStorage (key: matchday_db_v1).
 * A .db file can be exported (exportDbFile) or imported (importDbFromBuffer).
 */

/** localStorage key for the persisted DB blob. */
const STORAGE_KEY = 'matchday_db_v1';

/** sql.js constructor (populated by initDb). @type {any} */
let SQL = null;

/** Live sql.js Database instance. @type {any} */
let _db = null;

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * Create all tables (idempotent — uses CREATE TABLE IF NOT EXISTS).
 * @param {any} db  sql.js Database
 */
function createSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS pessoas (
      id                TEXT PRIMARY KEY,
      nome              TEXT NOT NULL DEFAULT '',
      classe            TEXT NOT NULL DEFAULT '',
      estado_id         TEXT NOT NULL DEFAULT '',
      influencia        REAL NOT NULL DEFAULT 1,
      patrimonio        REAL NOT NULL DEFAULT 1,
      moral             REAL NOT NULL DEFAULT 3,
      reputacao         REAL NOT NULL DEFAULT 1,
      renda_mensal      REAL NOT NULL DEFAULT 0,
      caixa             REAL NOT NULL DEFAULT 0,
      gastos_influencia INTEGER NOT NULL DEFAULT 1,
      gastos_moral      INTEGER NOT NULL DEFAULT 1,
      gastos_reputacao  INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS empresas (
      id                    TEXT PRIMARY KEY,
      nome                  TEXT NOT NULL DEFAULT '',
      dono_id               TEXT NOT NULL DEFAULT '',
      estado_id             TEXT NOT NULL DEFAULT '',
      patrimonio            REAL NOT NULL DEFAULT 0,
      funcionarios          REAL NOT NULL DEFAULT 0,
      renda                 REAL NOT NULL DEFAULT 0,
      producao              REAL NOT NULL DEFAULT 0,
      moral_corporativa     REAL NOT NULL DEFAULT 3,
      reputacao_corporativa REAL NOT NULL DEFAULT 3,
      lucro                 REAL NOT NULL DEFAULT 0,
      salario_funcionario   REAL NOT NULL DEFAULT 0,
      manutencao            REAL NOT NULL DEFAULT 0,
      insumos               REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS estados (
      id                   TEXT PRIMARY KEY,
      nome                 TEXT NOT NULL DEFAULT '',
      patrimonio           REAL NOT NULL DEFAULT 0,
      populacao            REAL NOT NULL DEFAULT 0,
      forcas_armadas       REAL NOT NULL DEFAULT 1,
      cultura              REAL NOT NULL DEFAULT 1,
      moral_populacao      REAL NOT NULL DEFAULT 3,
      renda_tributaria     REAL NOT NULL DEFAULT 0,
      ir_pf                REAL NOT NULL DEFAULT 0,
      ir_pj                REAL NOT NULL DEFAULT 0,
      imp_prod             REAL NOT NULL DEFAULT 0,
      salarios_politicos   REAL NOT NULL DEFAULT 0,
      incentivos_empresas  REAL NOT NULL DEFAULT 0,
      investimento_cultura REAL NOT NULL DEFAULT 0,
      investimento_fa      REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ativos (
      owner_type TEXT NOT NULL,
      owner_id   TEXT NOT NULL,
      ativo_id   TEXT NOT NULL,
      valor      REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (owner_type, owner_id, ativo_id)
    );
  `);
}

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Initialise sql.js and open (or restore) the database.
 * Must be called once before any other db function.
 * Requires `window.initSqlJs` to be available (loaded via <script> tag).
 * @returns {Promise<void>}
 */
export async function initDb() {
  if (!window.initSqlJs) {
    throw new Error(
      'sql.js not loaded. Add ' +
      '<script src="https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.min.js"></script> ' +
      'before the app module.'
    );
  }

  SQL = await window.initSqlJs({
    locateFile: file =>
      `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/${file}`,
  });

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const binary = _base64ToUint8Array(saved);
      _db = new SQL.Database(binary);
      // Ensure any new tables added in schema updates exist.
      createSchema(_db);
      return;
    } catch (err) {
      console.warn('db.js: could not restore DB from localStorage — starting fresh.', err);
    }
  }

  _db = new SQL.Database();
  createSchema(_db);
}

/** @returns {any} The live sql.js Database instance (null before initDb). */
export function getDb() {
  return _db;
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Serialise the in-memory database to localStorage.
 * Called automatically by saveWorldToDb().
 */
export function saveDb() {
  if (!_db) return;
  try {
    const binary = _db.export();
    localStorage.setItem(STORAGE_KEY, _uint8ArrayToBase64(binary));
  } catch (err) {
    console.error('db.js: saveDb failed.', err);
  }
}

/**
 * Trigger a browser download of the current database as a binary .db file.
 */
export function exportDbFile() {
  if (!_db) return;
  const binary = _db.export();
  const blob = new Blob([binary.buffer], { type: 'application/x-sqlite3' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'world.db';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Replace the current in-memory database from a .db file the user uploaded.
 * @param {ArrayBuffer} buffer
 */
export function importDbFromBuffer(buffer) {
  if (!SQL) throw new Error('db.js: SQL not initialised. Call initDb() first.');
  _db = new SQL.Database(new Uint8Array(buffer));
  createSchema(_db); // ensure schema present in case the file predates a migration
  saveDb();
}

// ── Read world ────────────────────────────────────────────────────────────────

/** Safe numeric coercion. */
function n(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}

/** Execute a SELECT and return all rows as plain objects. */
function _queryAll(sql) {
  const results = _db.exec(sql);
  if (!results.length) return [];
  const { columns, values } = results[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

/**
 * Load the full world state from the database.
 * @returns {{ pessoas: Object[], empresas: Object[], estados: Object[] }}
 */
export function loadWorldFromDb() {
  // ── Ativos: build a lookup map ─────────────────────────────────────────────
  const ativosMap = new Map();
  for (const row of _queryAll('SELECT owner_type, owner_id, ativo_id, valor FROM ativos')) {
    const key = `${row.owner_type}:${row.owner_id}`;
    if (!ativosMap.has(key)) ativosMap.set(key, {});
    ativosMap.get(key)[row.ativo_id] = n(row.valor, 0);
  }

  function getAtivos(type, id) {
    const key = `${type}:${id}`;
    return ativosMap.has(key) ? { ...ativosMap.get(key) } : null;
  }

  // ── Pessoas ────────────────────────────────────────────────────────────────
  const pessoas = _queryAll('SELECT * FROM pessoas').map(r => {
    const ativos = getAtivos('pessoa', r.id);
    const patrimonioDb = n(r.patrimonio, 1);
    const patrimonioSum = ativos ? Object.values(ativos).reduce((a, b) => a + b, 0) : 0;
    const patrimonio    = ativos && patrimonioSum !== 0 ? patrimonioSum : patrimonioDb;
    return {
      id:        r.id,
      nome:      r.nome,
      classe:    r.classe,
      estado_id: r.estado_id || '',
      atributos: {
        influencia: n(r.influencia, 1),
        patrimonio,
        moral:      n(r.moral, 3),
        reputacao:  n(r.reputacao, 1),
      },
      renda_mensal: n(r.renda_mensal, 0),
      caixa:        n(r.caixa, 0),
      gastos_mensais_pagos: {
        influencia: r.gastos_influencia !== 0,
        moral:      r.gastos_moral      !== 0,
        reputacao:  r.gastos_reputacao  !== 0,
      },
      ativos: ativos ?? { patrimonio_geral: patrimonio },
    };
  });

  // ── Empresas ───────────────────────────────────────────────────────────────
  const empresas = _queryAll('SELECT * FROM empresas').map(r => {
    const ativos = getAtivos('empresa', r.id);
    const patrimonioDb  = n(r.patrimonio, 0);
    const patrimonioSum = ativos ? Object.values(ativos).reduce((a, b) => a + b, 0) : 0;
    const patrimonio    = ativos && patrimonioSum !== 0 ? patrimonioSum : patrimonioDb;
    return {
      id:        r.id,
      nome:      r.nome,
      dono_id:   r.dono_id   || '',
      estado_id: r.estado_id || '',
      patrimonio,
      atributos: {
        funcionarios:          n(r.funcionarios, 0),
        renda:                 n(r.renda, 0),
        producao:              n(r.producao, 0),
        moral_corporativa:     n(r.moral_corporativa, 3),
        reputacao_corporativa: n(r.reputacao_corporativa, 3),
        lucro:                 n(r.lucro, 0),
      },
      custos: {
        salario_funcionario: n(r.salario_funcionario, 0),
        manutencao:          n(r.manutencao, 0),
        insumos:             n(r.insumos, 0),
      },
      ativos: ativos ?? { patrimonio_geral: patrimonio },
    };
  });

  // ── Estados ────────────────────────────────────────────────────────────────
  const estados = _queryAll('SELECT * FROM estados').map(r => {
    const ativos = getAtivos('estado', r.id);
    const patrimonioDb  = n(r.patrimonio, 0);
    const patrimonioSum = ativos ? Object.values(ativos).reduce((a, b) => a + b, 0) : 0;
    const patrimonio    = ativos && patrimonioSum !== 0 ? patrimonioSum : patrimonioDb;
    return {
      id:        r.id,
      nome:      r.nome,
      patrimonio,
      atributos: {
        populacao:       n(r.populacao, 0),
        forcas_armadas:  n(r.forcas_armadas, 1),
        cultura:         n(r.cultura, 1),
        moral_populacao: n(r.moral_populacao, 3),
      },
      impostos: {
        ir_pf:    n(r.ir_pf, 0),
        ir_pj:    n(r.ir_pj, 0),
        imp_prod: n(r.imp_prod, 0),
      },
      financas: {
        renda_tributaria:     n(r.renda_tributaria, 0),
        salarios_politicos:   n(r.salarios_politicos, 0),
        incentivos_empresas:  n(r.incentivos_empresas, 0),
        investimento_cultura: n(r.investimento_cultura, 0),
        investimento_fa:      n(r.investimento_fa, 0),
      },
      ativos: ativos ?? { patrimonio_geral: patrimonio },
    };
  });

  return { pessoas, empresas, estados };
}

// ── Write world ───────────────────────────────────────────────────────────────

/**
 * Replace all data in the database with the current world state, then persist
 * to localStorage. Wrapped in a transaction for atomicity.
 * @param {{ pessoas: Object[], empresas: Object[], estados: Object[] }} world
 */
export function saveWorldToDb(world) {
  if (!_db) return;

  _db.run('BEGIN TRANSACTION');
  try {
    _db.run('DELETE FROM pessoas');
    _db.run('DELETE FROM empresas');
    _db.run('DELETE FROM estados');
    _db.run('DELETE FROM ativos');

    for (const p of world.pessoas) {
      _db.run(
        `INSERT INTO pessoas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          p.id, p.nome, p.classe, p.estado_id || '',
          p.atributos.influencia,
          p.atributos.patrimonio,
          p.atributos.moral,
          p.atributos.reputacao,
          p.renda_mensal,
          Math.round(p.caixa),
          p.gastos_mensais_pagos.influencia ? 1 : 0,
          p.gastos_mensais_pagos.moral      ? 1 : 0,
          p.gastos_mensais_pagos.reputacao  ? 1 : 0,
        ]
      );
      for (const [ativo_id, valor] of Object.entries(p.ativos || {})) {
        _db.run('INSERT INTO ativos VALUES (?,?,?,?)',
          ['pessoa', p.id, ativo_id, Math.round(valor)]);
      }
    }

    for (const e of world.empresas) {
      _db.run(
        `INSERT INTO empresas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          e.id, e.nome, e.dono_id || '', e.estado_id || '',
          Math.round(e.patrimonio || 0),
          e.atributos.funcionarios,
          e.atributos.renda,
          e.atributos.producao,
          e.atributos.moral_corporativa,
          e.atributos.reputacao_corporativa,
          Math.round(e.atributos.lucro),
          e.custos.salario_funcionario,
          e.custos.manutencao,
          e.custos.insumos,
        ]
      );
      for (const [ativo_id, valor] of Object.entries(e.ativos || {})) {
        _db.run('INSERT INTO ativos VALUES (?,?,?,?)',
          ['empresa', e.id, ativo_id, Math.round(valor)]);
      }
    }

    for (const s of world.estados) {
      _db.run(
        `INSERT INTO estados VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          s.id, s.nome,
          Math.round(s.patrimonio || 0),
          s.atributos.populacao,
          s.atributos.forcas_armadas,
          s.atributos.cultura,
          s.atributos.moral_populacao,
          Math.round(s.financas.renda_tributaria),
          s.impostos.ir_pf,
          s.impostos.ir_pj,
          s.impostos.imp_prod,
          s.financas.salarios_politicos,
          s.financas.incentivos_empresas,
          s.financas.investimento_cultura,
          s.financas.investimento_fa,
        ]
      );
      for (const [ativo_id, valor] of Object.entries(s.ativos || {})) {
        _db.run('INSERT INTO ativos VALUES (?,?,?,?)',
          ['estado', s.id, ativo_id, Math.round(valor)]);
      }
    }

    _db.run('COMMIT');
  } catch (err) {
    _db.run('ROLLBACK');
    throw err;
  }

  saveDb();
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Convert a Uint8Array to a base64 string without spread (avoids stack overflow on large arrays). */
function _uint8ArrayToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Convert a base64 string back to a Uint8Array. */
function _base64ToUint8Array(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
