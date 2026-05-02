/**
 * db.test.js — Unit tests for the SQLite DAO layer (src/core/db.js).
 *
 * Uses:
 *   - fake-indexeddb to mock the browser IndexedDB API
 *   - sql.js npm package as the initSqlJs factory
 */

// Set up fake IndexedDB globals BEFORE importing db.js
import 'fake-indexeddb/auto';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJsNode from 'sql.js';

import {
  setInitSqlJs,
  resetDbSingleton,
  getDb,
  loadWorldFromDb,
  saveWorldToDb,
  SCHEMA_SQL,
} from '../src/core/db.js';
import { syncEstadosFromMapa } from '../src/core/import-cities.js';

// ── Setup helpers ─────────────────────────────────────────────────────────────

function resetIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('matchday-tales-db');
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

beforeEach(async () => {
  await resetIdb();
  resetDbSingleton();
  setInitSqlJs(initSqlJsNode);
});

// ── Schema / bootstrap ────────────────────────────────────────────────────────

test('getDb() creates a new database on first call', async () => {
  const db = await getDb();
  assert.ok(db, 'getDb() returned a truthy value');
});

test('getDb() returns the same singleton on subsequent calls', async () => {
  const db1 = await getDb();
  const db2 = await getDb();
  assert.strictEqual(db1, db2);
});

test('schema contains expected tables', async () => {
  const db = await getDb();
  const tables = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );
  const names = tables[0].values.map(r => r[0]);
  assert.ok(names.includes('pessoas'),  'table pessoas exists');
  assert.ok(names.includes('empresas'), 'table empresas exists');
  assert.ok(names.includes('estados'),  'table estados exists');
  assert.ok(names.includes('ativos'),   'table ativos exists');
  assert.ok(names.includes('meta'),     'table meta exists');
});

test('meta table contains schema_version', async () => {
  const db   = await getDb();
  const rows = db.exec("SELECT value FROM meta WHERE key = 'schema_version'");
  assert.ok(rows.length > 0);
  assert.strictEqual(rows[0].values[0][0], '1');
});

// ── loadWorldFromDb — empty DB ────────────────────────────────────────────────

test('loadWorldFromDb returns empty arrays for a fresh DB', async () => {
  const db    = await getDb();
  const world = loadWorldFromDb(db);
  assert.deepStrictEqual(world.pessoas,  []);
  assert.deepStrictEqual(world.empresas, []);
  assert.deepStrictEqual(world.estados,  []);
});

// ── saveWorldToDb / loadWorldFromDb round-trips ───────────────────────────────

test('saveWorldToDb persists a pessoa and loadWorldFromDb reads it back', async () => {
  const db    = await getDb();
  const world = {
    pessoas: [{
      id:     'p1',
      nome:   'João Silva',
      classe: 'jogador',
      estado_id: '',
      atributos: { influencia: 2, patrimonio: 100, moral: 4, reputacao: 3 },
      renda_mensal: 500,
      caixa: 1000,
      gastos_mensais_pagos: { influencia: true, moral: false, reputacao: true },
      nota_scouting: 7.5,
      valor_mercado: 50000,
      posicao: 'atacante',
      clube: '',
      clube_emprestador: '',
      tick_registro: 1,
      tick_saida: 0,
      ativos: { patrimonio_geral: 100 },
    }],
    empresas: [],
    estados:  [],
  };

  saveWorldToDb(db, world);
  const loaded = loadWorldFromDb(db);

  assert.strictEqual(loaded.pessoas.length, 1);
  const p = loaded.pessoas[0];
  assert.strictEqual(p.id,   'p1');
  assert.strictEqual(p.nome, 'João Silva');
  assert.strictEqual(p.classe, 'jogador');
  assert.strictEqual(p.atributos.influencia, 2);
  assert.strictEqual(p.atributos.patrimonio, 100);
  assert.strictEqual(p.nota_scouting, 7.5);
  assert.strictEqual(p.valor_mercado, 50000);
  assert.strictEqual(p.posicao, 'atacante');
  assert.strictEqual(p.tick_registro, 1);
  assert.strictEqual(p.tick_saida, 0);
  assert.ok(p.gastos_mensais_pagos.influencia);
  assert.ok(!p.gastos_mensais_pagos.moral);
});

test('saveWorldToDb persists an empresa and loadWorldFromDb reads it back', async () => {
  const db    = await getDb();
  const world = {
    pessoas:  [],
    empresas: [{
      id:        'e1',
      nome:      'Clube Esportivo',
      dono_id:   '',
      estado_id: '',
      patrimonio: 500000,
      atributos: {
        funcionarios: 50, renda: 100000, producao: 200,
        moral_corporativa: 3, reputacao_corporativa: 4, lucro: 10000,
      },
      custos: { salario_funcionario: 2000, manutencao: 5000, insumos: 3000 },
      tick_registro: 2,
      tick_saida: 0,
      ativos: { patrimonio_geral: 500000 },
    }],
    estados: [],
  };

  saveWorldToDb(db, world);
  const loaded = loadWorldFromDb(db);

  assert.strictEqual(loaded.empresas.length, 1);
  const e = loaded.empresas[0];
  assert.strictEqual(e.id,   'e1');
  assert.strictEqual(e.nome, 'Clube Esportivo');
  assert.strictEqual(e.patrimonio, 500000);
  assert.strictEqual(e.atributos.funcionarios, 50);
  assert.strictEqual(e.atributos.lucro, 10000);
  assert.strictEqual(e.custos.salario_funcionario, 2000);
});

test('saveWorldToDb persists an estado and loadWorldFromDb reads it back', async () => {
  const db    = await getDb();
  const world = {
    pessoas:  [],
    empresas: [],
    estados:  [{
      id:        's1',
      nome:      'Brasil',
      tipo:      'pais',
      parent_id: '',
      descricao: 'País do futebol',
      patrimonio: 1000000,
      atributos: { populacao: 215000000, forcas_armadas: 4, cultura: 3, moral_populacao: 3 },
      impostos:  { ir_pf: 0.27, ir_pj: 0.15, imp_prod: 0.12 },
      financas:  {
        renda_tributaria: 800000, salarios_politicos: 50000,
        incentivos_empresas: 30000, investimento_cultura: 20000, investimento_fa: 40000,
      },
      tick_registro: 0,
      tick_saida: 0,
      ativos: { patrimonio_geral: 1000000 },
    }],
  };

  saveWorldToDb(db, world);
  const loaded = loadWorldFromDb(db);

  assert.strictEqual(loaded.estados.length, 1);
  const s = loaded.estados[0];
  assert.strictEqual(s.id,   's1');
  assert.strictEqual(s.nome, 'Brasil');
  assert.strictEqual(s.tipo, 'pais');
  assert.strictEqual(s.atributos.populacao, 215000000);
  assert.strictEqual(s.impostos.ir_pf, 0.27);
  assert.strictEqual(s.financas.renda_tributaria, 800000);
});

test('saveWorldToDb replaces existing rows on each call', async () => {
  const db = await getDb();

  const worldV1 = {
    pessoas:  [{ id: 'p1', nome: 'Alice', classe: 'jogador', estado_id: '',
      atributos: { influencia: 1, patrimonio: 10, moral: 3, reputacao: 1 },
      renda_mensal: 0, caixa: 0, gastos_mensais_pagos: { influencia: false, moral: false, reputacao: false },
      nota_scouting: 0, valor_mercado: 0, posicao: '', clube: '', clube_emprestador: '',
      tick_registro: 0, tick_saida: 0, ativos: { patrimonio_geral: 10 } }],
    empresas: [],
    estados:  [],
  };
  saveWorldToDb(db, worldV1);

  const worldV2 = {
    pessoas:  [{ id: 'p2', nome: 'Bob', classe: 'trabalhador', estado_id: '',
      atributos: { influencia: 1, patrimonio: 5, moral: 3, reputacao: 1 },
      renda_mensal: 0, caixa: 0, gastos_mensais_pagos: { influencia: false, moral: false, reputacao: false },
      nota_scouting: 0, valor_mercado: 0, posicao: '', clube: '', clube_emprestador: '',
      tick_registro: 0, tick_saida: 0, ativos: { patrimonio_geral: 5 } }],
    empresas: [],
    estados:  [],
  };
  saveWorldToDb(db, worldV2);

  const loaded = loadWorldFromDb(db);
  assert.strictEqual(loaded.pessoas.length, 1);
  assert.strictEqual(loaded.pessoas[0].id, 'p2');
});

test('ativos are persisted and re-applied on load', async () => {
  const db    = await getDb();
  const world = {
    pessoas:  [],
    empresas: [{
      id: 'e1', nome: 'Clube', dono_id: '', estado_id: '', patrimonio: 300,
      atributos: { funcionarios: 0, renda: 0, producao: 0, moral_corporativa: 3, reputacao_corporativa: 3, lucro: 0 },
      custos: { salario_funcionario: 0, manutencao: 0, insumos: 0 },
      tick_registro: 0, tick_saida: 0,
      ativos: { estadio: 200, equipamento: 100 },
    }],
    estados: [],
  };

  saveWorldToDb(db, world);
  const loaded = loadWorldFromDb(db);

  const e = loaded.empresas[0];
  assert.strictEqual(e.patrimonio, 300);
  assert.ok(e.ativos.estadio   !== undefined, 'ativo estadio present');
  assert.ok(e.ativos.equipamento !== undefined, 'ativo equipamento present');
  assert.strictEqual(e.ativos.estadio,    200);
  assert.strictEqual(e.ativos.equipamento, 100);
});

// ── Persistence via IndexedDB ─────────────────────────────────────────────────

test('getDb() persists schema to IndexedDB; second call loads from IDB', async () => {
  // First call — creates empty DB and saves to IDB
  const db1 = await getDb();
  const world = {
    pessoas:  [],
    empresas: [],
    estados:  [{ id: 's1', nome: 'Paraná', tipo: '', parent_id: '', descricao: '',
      patrimonio: 0,
      atributos: { populacao: 12000000, forcas_armadas: 1, cultura: 1, moral_populacao: 3 },
      impostos: { ir_pf: 0, ir_pj: 0, imp_prod: 0 },
      financas:  { renda_tributaria: 0, salarios_politicos: 0, incentivos_empresas: 0, investimento_cultura: 0, investimento_fa: 0 },
      tick_registro: 0, tick_saida: 0, ativos: { patrimonio_geral: 0 } }],
  };
  saveWorldToDb(db1, world);
  // Manually export and save to IDB to simulate auto-save
  const { saveDbToIndexedDb: idbSave } = await import('../src/core/idb.js');
  await idbSave(db1.export());

  // Reset singleton — next call must load from IDB
  resetDbSingleton();
  setInitSqlJs(initSqlJsNode);

  const db2    = await getDb();
  const loaded = loadWorldFromDb(db2);
  assert.strictEqual(loaded.estados.length, 1);
  assert.strictEqual(loaded.estados[0].id, 's1');
  assert.strictEqual(loaded.estados[0].nome, 'Paraná');
});

// ── syncEstadosFromMapa + DB round-trip ───────────────────────────────────────

test('syncEstadosFromMapa + saveWorldToDb persists mapa-referenced estados on reload', async () => {
  // Simulate a database that has mapa data referencing estado IDs but no
  // corresponding entries in the estados table (e.g. data imported before the
  // mapa→estados sync was introduced).
  const db = await getDb();
  const world = {
    pessoas:  [],
    empresas: [],
    estados:  [],
    clubes:   [],
    mapa: {
      // lat -23, lon -46 → São Paulo;  lat -22, lon -43 → Rio de Janeiro
      '-23': { '-46': { tipo: 'terra', estado_id: 'br_sp' } },
      '-22': { '-43': { tipo: 'terra', estado_id: 'br_rj' } },
    },
  };
  // Save world with mapa but NO estados (simulates old/broken data)
  saveWorldToDb(db, world);

  // Load it back — at this point world.estados is empty
  const loaded = loadWorldFromDb(db);
  assert.strictEqual(loaded.estados.length, 0, 'should start with no estados');
  assert.ok(Object.keys(loaded.mapa).length > 0, 'mapa should have cells');

  // Simulate what initApp does: sync missing estados from the mapa, then save
  const { created } = syncEstadosFromMapa(loaded, { tick: 0 });
  assert.strictEqual(created.length, 2, 'should create 2 missing estados');
  assert.ok(created.includes('br_sp'), 'br_sp should be created');
  assert.ok(created.includes('br_rj'), 'br_rj should be created');

  // Persist the synced estados back to the DB
  saveWorldToDb(db, loaded);

  // Reload again — the estados must now be there
  const reloaded = loadWorldFromDb(db);
  assert.strictEqual(reloaded.estados.length, 2, 'estados should survive the DB round-trip');
  const ids = reloaded.estados.map(s => s.id).sort();
  assert.deepStrictEqual(ids, ['br_rj', 'br_sp']);
});
