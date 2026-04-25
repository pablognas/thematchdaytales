/**
 * db.test.js — Unit tests for schema creation and basic CRUD in db.js.
 *
 * Uses the npm version of sql.js for Node.js (no WASM file location needed).
 * All tests skip IndexedDB (skipIdb: true) to run without a browser environment.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJsNode from 'sql.js';

import {
  createSchema,
  saveWorldToDb,
  loadWorldFromDb,
  SCHEMA_VERSION,
} from '../src/core/db.js';

/** Minimal valid pessoa object matching the world.js structure. */
function makePessoa(id = 'p1', extra = {}) {
  return {
    id,
    nome: `Pessoa ${id}`,
    classe: 'trabalhador',
    estado_id: '',
    atributos: { influencia: 1, patrimonio: 100, moral: 3, reputacao: 1 },
    renda_mensal: 0,
    caixa: 500,
    gastos_mensais_pagos: { influencia: true, moral: true, reputacao: false },
    nota_scouting: 0,
    valor_mercado: 0,
    posicao: '',
    clube: '',
    clube_emprestador: '',
    tick_registro: 1,
    tick_saida: 0,
    ativos: { patrimonio_geral: 100 },
    ...extra,
  };
}

/** Minimal valid empresa object. */
function makeEmpresa(id = 'e1') {
  return {
    id,
    nome: `Empresa ${id}`,
    dono_id: '',
    estado_id: '',
    patrimonio: 50000,
    atributos: {
      funcionarios: 10, renda: 10000, producao: 100,
      moral_corporativa: 3, reputacao_corporativa: 3, lucro: 5000,
    },
    custos: { salario_funcionario: 1000, manutencao: 500, insumos: 2000 },
    tick_registro: 1,
    tick_saida: 0,
    ativos: { patrimonio_geral: 50000 },
  };
}

/** Minimal valid estado object. */
function makeEstado(id = 's1', parentId = '') {
  return {
    id,
    nome: `Estado ${id}`,
    tipo: 'estado',
    parent_id: parentId,
    descricao: '',
    patrimonio: 1000000,
    atributos: { populacao: 500000, forcas_armadas: 2, cultura: 3, moral_populacao: 3 },
    impostos: { ir_pf: 0.15, ir_pj: 0.20, imp_prod: 0.05 },
    financas: {
      renda_tributaria: 200000,
      salarios_politicos: 10000,
      incentivos_empresas: 5000,
      investimento_cultura: 3000,
      investimento_fa: 8000,
    },
    tick_registro: 1,
    tick_saida: 0,
    ativos: { patrimonio_geral: 1000000 },
  };
}

describe('DB schema', () => {
  let SQL;

  before(async () => {
    SQL = await initSqlJsNode();
  });

  test('createSchema creates all required tables', () => {
    const db = new SQL.Database();
    createSchema(db);

    const result = db.exec(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    );
    assert.ok(result.length > 0, 'Expected at least one table');
    const tables = result[0].values.map(r => r[0]);

    for (const expected of ['ativos', 'empresas', 'estados', 'mapa', 'pessoas', 'schema_version']) {
      assert.ok(tables.includes(expected), `Missing table: ${expected}`);
    }
  });

  test('schema_version table contains correct version', () => {
    const db = new SQL.Database();
    createSchema(db);

    const result = db.exec('SELECT version FROM schema_version');
    assert.ok(result.length > 0);
    const version = result[0].values[0][0];
    assert.equal(version, SCHEMA_VERSION);
  });
});

describe('DB CRUD — pessoas', () => {
  let SQL;

  before(async () => {
    SQL = await initSqlJsNode();
  });

  test('saves and loads a single pessoa', () => {
    const db    = new SQL.Database();
    createSchema(db);
    const world = { pessoas: [makePessoa('joao')], empresas: [], estados: [] };

    saveWorldToDb(db, world, {});
    const { world: loaded } = loadWorldFromDb(db);

    assert.equal(loaded.pessoas.length, 1);
    const p = loaded.pessoas[0];
    assert.equal(p.id,   'joao');
    assert.equal(p.nome, 'Pessoa joao');
    assert.equal(p.caixa, 500);
    assert.equal(p.atributos.patrimonio, 100);
    assert.equal(p.gastos_mensais_pagos.influencia, true);
    assert.equal(p.gastos_mensais_pagos.reputacao,  false);
  });

  test('saveWorldToDb replaces all existing rows on each call', () => {
    const db    = new SQL.Database();
    createSchema(db);
    const world = { pessoas: [makePessoa('p1'), makePessoa('p2')], empresas: [], estados: [] };

    saveWorldToDb(db, world, {});
    // Replace with only one pessoa
    saveWorldToDb(db, { pessoas: [makePessoa('p1')], empresas: [], estados: [] }, {});

    const { world: loaded } = loadWorldFromDb(db);
    assert.equal(loaded.pessoas.length, 1);
    assert.equal(loaded.pessoas[0].id, 'p1');
  });

  test('saves and loads multiple pessoas', () => {
    const db    = new SQL.Database();
    createSchema(db);
    const world = {
      pessoas:  [makePessoa('a'), makePessoa('b'), makePessoa('c')],
      empresas: [],
      estados:  [],
    };

    saveWorldToDb(db, world, {});
    const { world: loaded } = loadWorldFromDb(db);

    assert.equal(loaded.pessoas.length, 3);
    const ids = loaded.pessoas.map(p => p.id).sort();
    assert.deepEqual(ids, ['a', 'b', 'c']);
  });
});

describe('DB CRUD — empresas', () => {
  let SQL;

  before(async () => {
    SQL = await initSqlJsNode();
  });

  test('saves and loads an empresa', () => {
    const db    = new SQL.Database();
    createSchema(db);
    const world = { pessoas: [], empresas: [makeEmpresa('corp1')], estados: [] };

    saveWorldToDb(db, world, {});
    const { world: loaded } = loadWorldFromDb(db);

    assert.equal(loaded.empresas.length, 1);
    const e = loaded.empresas[0];
    assert.equal(e.id,   'corp1');
    assert.equal(e.nome, 'Empresa corp1');
    assert.equal(e.atributos.funcionarios, 10);
    assert.equal(e.custos.manutencao, 500);
  });
});

describe('DB CRUD — estados', () => {
  let SQL;

  before(async () => {
    SQL = await initSqlJsNode();
  });

  test('saves and loads an estado with parent_id', () => {
    const db    = new SQL.Database();
    createSchema(db);
    const parent = makeEstado('pais1', '');
    const child  = makeEstado('estado1', 'pais1');
    const world  = { pessoas: [], empresas: [], estados: [parent, child] };

    saveWorldToDb(db, world, {});
    const { world: loaded } = loadWorldFromDb(db);

    assert.equal(loaded.estados.length, 2);
    const loadedChild = loaded.estados.find(s => s.id === 'estado1');
    assert.ok(loadedChild, 'child estado not found');
    assert.equal(loadedChild.parent_id, 'pais1');
    assert.equal(loadedChild.atributos.populacao, 500000);
    assert.equal(loadedChild.impostos.ir_pf, 0.15);
  });
});

describe('DB CRUD — ativos', () => {
  let SQL;

  before(async () => {
    SQL = await initSqlJsNode();
  });

  test('ativos are persisted and re-applied on load', () => {
    const db = new SQL.Database();
    createSchema(db);
    const pessoa = makePessoa('rico');
    pessoa.ativos = { imoveis: 500000, investimentos: 100000 };
    pessoa.atributos.patrimonio = 600000;

    const world = { pessoas: [pessoa], empresas: [], estados: [] };
    saveWorldToDb(db, world, {});

    const { world: loaded } = loadWorldFromDb(db);
    const p = loaded.pessoas[0];
    assert.ok(p.ativos, 'ativos should be present');
    assert.equal(p.ativos.imoveis,      500000);
    assert.equal(p.ativos.investimentos, 100000);
    assert.equal(p.atributos.patrimonio, 600000);
  });
});

describe('DB CRUD — mapa', () => {
  let SQL;

  before(async () => {
    SQL = await initSqlJsNode();
  });

  test('saves and loads mapa cells', () => {
    const db = new SQL.Database();
    createSchema(db);

    const mapaWorld = {
      '10': { '20': { tipo: 'terra', estado_id: 's1', bioma: 'floresta', clima: 'tropical' } },
      '-5': { '30': { tipo: 'agua' } },
    };
    saveWorldToDb(db, { pessoas: [], empresas: [], estados: [] }, mapaWorld);

    const { mapaWorld: loaded } = loadWorldFromDb(db);
    assert.ok(loaded['10'], 'lat 10 should be present');
    const cell = loaded['10']['20'];
    assert.ok(cell, 'cell (10,20) should be present');
    assert.equal(cell.tipo,      'terra');
    assert.equal(cell.estado_id, 's1');
    assert.equal(cell.bioma,     'floresta');
  });
});
