/**
 * new-features.test.js — Unit tests for the new features:
 *   - pessoa.peso attribute
 *   - fornecedores_ids on pessoa, empresa, estado
 *   - clube entity type (world.js, db.js)
 *   - mapa persistence in SQLite (db.js)
 *   - Economic status calculation functions (economy.js)
 *   - tickMensal status recalculation (engine.js)
 */

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
} from '../src/core/db.js';

import {
  rowsToPessoas, pessoasToRows,
  rowsToEmpresas, empresasToRows,
  rowsToClubes, clubesToRows,
  rowsToEstados, estadosToRows,
  applyAtivos, worldAtivosToRows,
  calcularPopulacaoEstado,
} from '../src/core/world.js';

import {
  statusToScore,
  scoreToStatus,
  calcularNovoStatusEconomico,
  calcularStatusPessoa,
  calcularStatusEmpresa,
  calcularStatusEstado,
  STATUS_ECONOMICO,
} from '../src/core/economy.js';

import { tickMensal } from '../src/core/engine.js';

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

// ── Helper builders ───────────────────────────────────────────────────────────

function makePessoa(overrides = {}) {
  return {
    id: 'p1', nome: 'Teste', classe: 'trabalhador', estado_id: '',
    peso: 1,
    atributos: { influencia: 1, patrimonio: 10, moral: 3, reputacao: 1 },
    renda_mensal: 0, caixa: 0,
    gastos_mensais_pagos: { influencia: false, moral: false, reputacao: false },
    nota_scouting: 0, valor_mercado: 0, posicao: '', clube: '', clube_emprestador: '',
    tick_registro: 0, tick_saida: 0,
    status_economico: 'estagnacao',
    fornecedores_ids: [],
    ativos: { patrimonio_geral: 10 },
    ...overrides,
  };
}

function makeEmpresa(overrides = {}) {
  return {
    id: 'e1', nome: 'Empresa Teste', dono_id: '', estado_id: '',
    segmento: 'POP_NAO_DURAVEL', infraestrutura: '', patrimonio: 0,
    atributos: { funcionarios: 10, renda: 0, producao: 0, moral_corporativa: 3, reputacao_corporativa: 3, lucro: 0 },
    custos: { salario_funcionario: 0, manutencao: 0, insumos: 0 },
    tick_registro: 0, tick_saida: 0,
    status_economico: 'estagnacao',
    fornecedores_ids: [],
    ativos: { patrimonio_geral: 0 },
    ...overrides,
  };
}

function makeEstado(overrides = {}) {
  return {
    id: 'est1', nome: 'Estado Teste', tipo: '', parent_id: '', descricao: '',
    patrimonio: 0,
    atributos: { populacao: 1000, forcas_armadas: 1, cultura: 1, moral_populacao: 3 },
    impostos: { ir_pf: 0, ir_pj: 0, imp_prod: 0 },
    financas: { renda_tributaria: 0, salarios_politicos: 0, incentivos_empresas: 0, investimento_cultura: 0, investimento_fa: 0 },
    infraestrutura: {},
    tick_registro: 0, tick_saida: 0,
    status_economico: 'estagnacao',
    fornecedores_ids: [],
    ativos: { patrimonio_geral: 0 },
    ...overrides,
  };
}

function makeClube(overrides = {}) {
  const patrimonio = overrides.patrimonio ?? 0;
  return {
    id: 'c1', nome: 'Clube Teste', dono_id: '', estado_id: '',
    patrimonio,
    financas: {
      receita_bilheteria: 0, receita_tv: 0, receita_patrocinios: 0,
      receita_transferencias: 0, folha_salarial: 0, custo_infraestrutura: 0,
      custo_contratacoes: 0, saldo: 0,
    },
    atributos: { torcida: 0, reputacao: 3, instalacoes: 3 },
    tick_registro: 0, tick_saida: 0,
    status_economico: 'estagnacao',
    fornecedores_ids: [],
    ativos: { patrimonio_geral: patrimonio },
    ...overrides,
  };
}

function makeConfig() {
  return { classes: { classes: [] }, atributos: {}, conversoes: {}, fluxos: {}, produtos: {} };
}

function makeWorld(overrides = {}) {
  return { pessoas: [], empresas: [], estados: [], clubes: [], mapa: {}, ...overrides };
}

// ── Pessoa.peso ───────────────────────────────────────────────────────────────

test('rowsToPessoas defaults peso to 1 when not present', () => {
  const rows = [{ id: 'p1', nome: 'Test', classe: 'trabalhador', estado_id: '' }];
  const pessoas = rowsToPessoas(rows);
  assert.strictEqual(pessoas[0].peso, 1);
});

test('rowsToPessoas reads peso from row', () => {
  const rows = [{ id: 'p1', nome: 'Test', classe: 'trabalhador', estado_id: '', peso: '500' }];
  const pessoas = rowsToPessoas(rows);
  assert.strictEqual(pessoas[0].peso, 500);
});

test('pessoasToRows round-trip preserves peso', () => {
  const p = makePessoa({ peso: 250 });
  const rows = pessoasToRows([p]);
  assert.strictEqual(rows[0].peso, 250);
  const loaded = rowsToPessoas(rows);
  assert.strictEqual(loaded[0].peso, 250);
});

test('saveWorldToDb / loadWorldFromDb round-trips pessoa.peso', async () => {
  const db = await getDb();
  const world = makeWorld({ pessoas: [makePessoa({ id: 'p1', peso: 42 })] });
  saveWorldToDb(db, world);
  const loaded = loadWorldFromDb(db);
  assert.strictEqual(loaded.pessoas[0].peso, 42);
});

// ── Pessoa.fornecedores_ids ───────────────────────────────────────────────────

test('rowsToPessoas defaults fornecedores_ids to empty array', () => {
  const rows = [{ id: 'p1', nome: 'Test', classe: 'trabalhador', estado_id: '' }];
  const pessoas = rowsToPessoas(rows);
  assert.deepStrictEqual(pessoas[0].fornecedores_ids, []);
});

test('rowsToPessoas parses fornecedores_ids from JSON string', () => {
  const rows = [{ id: 'p1', nome: 'Test', classe: 'trabalhador', estado_id: '', fornecedores_ids: '["e1","e2"]' }];
  const pessoas = rowsToPessoas(rows);
  assert.deepStrictEqual(pessoas[0].fornecedores_ids, ['e1', 'e2']);
});

test('pessoasToRows serialises fornecedores_ids as JSON string', () => {
  const p = makePessoa({ fornecedores_ids: ['e1', 'e2'] });
  const rows = pessoasToRows([p]);
  assert.strictEqual(rows[0].fornecedores_ids, '["e1","e2"]');
});

test('saveWorldToDb / loadWorldFromDb round-trips pessoa.fornecedores_ids', async () => {
  const db = await getDb();
  const world = makeWorld({ pessoas: [makePessoa({ id: 'p1', fornecedores_ids: ['e1', 'e2'] })] });
  saveWorldToDb(db, world);
  const loaded = loadWorldFromDb(db);
  assert.deepStrictEqual(loaded.pessoas[0].fornecedores_ids, ['e1', 'e2']);
});

// ── Empresa.fornecedores_ids ──────────────────────────────────────────────────

test('rowsToEmpresas defaults fornecedores_ids to empty array', () => {
  const rows = [{ id: 'e1', nome: 'Test', dono_id: '', estado_id: '' }];
  const empresas = rowsToEmpresas(rows);
  assert.deepStrictEqual(empresas[0].fornecedores_ids, []);
});

test('rowsToEmpresas parses fornecedores_ids from JSON string', () => {
  const rows = [{ id: 'e1', nome: 'Test', dono_id: '', estado_id: '', fornecedores_ids: '["e2","e3"]' }];
  const empresas = rowsToEmpresas(rows);
  assert.deepStrictEqual(empresas[0].fornecedores_ids, ['e2', 'e3']);
});

test('empresasToRows serialises fornecedores_ids as JSON string', () => {
  const e = makeEmpresa({ fornecedores_ids: ['e2'] });
  const rows = empresasToRows([e]);
  assert.strictEqual(rows[0].fornecedores_ids, '["e2"]');
});

// ── Estado.fornecedores_ids ───────────────────────────────────────────────────

test('rowsToEstados defaults fornecedores_ids to empty array', () => {
  const rows = [{ id: 's1', nome: 'Test', tipo: '', parent_id: '', descricao: '' }];
  const estados = rowsToEstados(rows);
  assert.deepStrictEqual(estados[0].fornecedores_ids, []);
});

test('estadosToRows serialises fornecedores_ids as JSON string', () => {
  const est = makeEstado({ fornecedores_ids: ['e1'] });
  const rows = estadosToRows([est]);
  assert.strictEqual(rows[0].fornecedores_ids, '["e1"]');
});

// ── Clube entity ──────────────────────────────────────────────────────────────

test('rowsToClubes parses a clube row', () => {
  const rows = [{
    id: 'c1', nome: 'Flamengo', dono_id: 'p1', estado_id: 'rj',
    patrimonio: '1000000',
    receita_bilheteria: '500000', receita_tv: '200000',
    receita_patrocinios: '300000', receita_transferencias: '100000',
    folha_salarial: '400000', custo_infraestrutura: '50000',
    custo_contratacoes: '20000', saldo: '630000',
    torcida: '40000000', reputacao: '5', instalacoes: '4',
    tick_registro: '1', tick_saida: '0',
    status_economico: 'crescimento',
    fornecedores_ids: '["e1"]',
  }];
  const clubes = rowsToClubes(rows);
  assert.strictEqual(clubes[0].id, 'c1');
  assert.strictEqual(clubes[0].nome, 'Flamengo');
  assert.strictEqual(clubes[0].patrimonio, 1000000);
  assert.strictEqual(clubes[0].financas.receita_bilheteria, 500000);
  assert.strictEqual(clubes[0].financas.folha_salarial, 400000);
  assert.strictEqual(clubes[0].atributos.torcida, 40000000);
  assert.strictEqual(clubes[0].atributos.reputacao, 5);
  assert.strictEqual(clubes[0].status_economico, 'crescimento');
  assert.deepStrictEqual(clubes[0].fornecedores_ids, ['e1']);
});

test('clubesToRows / rowsToClubes round-trip', () => {
  const c = makeClube({
    id: 'c1', nome: 'Clube X', estado_id: 'est1',
    patrimonio: 500000,
    financas: {
      receita_bilheteria: 100000, receita_tv: 50000,
      receita_patrocinios: 30000, receita_transferencias: 10000,
      folha_salarial: 80000, custo_infraestrutura: 5000,
      custo_contratacoes: 2000, saldo: 103000,
    },
    atributos: { torcida: 10000, reputacao: 4, instalacoes: 3 },
    status_economico: 'crescimento',
    fornecedores_ids: ['e1', 'e2'],
  });
  const rows = clubesToRows([c]);
  const loaded = rowsToClubes(rows);
  assert.strictEqual(loaded[0].id, 'c1');
  assert.strictEqual(loaded[0].patrimonio, 500000);
  assert.strictEqual(loaded[0].financas.receita_bilheteria, 100000);
  assert.strictEqual(loaded[0].atributos.torcida, 10000);
  assert.strictEqual(loaded[0].status_economico, 'crescimento');
  assert.deepStrictEqual(loaded[0].fornecedores_ids, ['e1', 'e2']);
});

test('saveWorldToDb / loadWorldFromDb persists and loads clubes', async () => {
  const db = await getDb();
  const clube = makeClube({
    id: 'c1', nome: 'Flamengo', estado_id: 'est1',
    patrimonio: 2000000,
    financas: {
      receita_bilheteria: 300000, receita_tv: 100000,
      receita_patrocinios: 50000, receita_transferencias: 0,
      folha_salarial: 200000, custo_infraestrutura: 10000,
      custo_contratacoes: 5000, saldo: 235000,
    },
    atributos: { torcida: 50000000, reputacao: 5, instalacoes: 5 },
    status_economico: 'crescimento',
    fornecedores_ids: ['e1'],
  });
  const world = makeWorld({ clubes: [clube] });
  saveWorldToDb(db, world);
  const loaded = loadWorldFromDb(db);

  assert.strictEqual(loaded.clubes.length, 1);
  const c = loaded.clubes[0];
  assert.strictEqual(c.id, 'c1');
  assert.strictEqual(c.nome, 'Flamengo');
  assert.strictEqual(c.patrimonio, 2000000);
  assert.strictEqual(c.financas.receita_bilheteria, 300000);
  assert.strictEqual(c.atributos.torcida, 50000000);
  assert.strictEqual(c.status_economico, 'crescimento');
  assert.deepStrictEqual(c.fornecedores_ids, ['e1']);
});

test('loadWorldFromDb returns empty clubes array for fresh DB', async () => {
  const db = await getDb();
  const world = loadWorldFromDb(db);
  assert.ok(Array.isArray(world.clubes), 'clubes is an array');
  assert.strictEqual(world.clubes.length, 0);
});

test('applyAtivos handles clube type', () => {
  const clube = makeClube({ id: 'c1', patrimonio: 100 });
  const world = makeWorld({ clubes: [clube] });
  const ativosRows = [
    { owner_type: 'clube', owner_id: 'c1', ativo_id: 'estadio', valor: '1000000' },
  ];
  applyAtivos(world, ativosRows);
  assert.strictEqual(clube.ativos.estadio, 1000000);
  assert.strictEqual(clube.patrimonio, 1000000);
});

test('worldAtivosToRows includes clube ativos', () => {
  const clube = makeClube({ id: 'c1', ativos: { estadio: 500000, uniforme: 10000 } });
  const world = makeWorld({ clubes: [clube] });
  const rows = worldAtivosToRows(world);
  const clubeRows = rows.filter(r => r.owner_type === 'clube');
  assert.ok(clubeRows.length >= 2);
  const estadioRow = clubeRows.find(r => r.ativo_id === 'estadio');
  assert.ok(estadioRow, 'estadio ativo row present');
  assert.strictEqual(estadioRow.valor, 500000);
});

// ── Mapa persistence ──────────────────────────────────────────────────────────

test('saveWorldToDb / loadWorldFromDb round-trips mapa', async () => {
  const db = await getDb();
  const mapa = {};
  mapa['10'] = { '20': { tipo: 'terra', estado_id: 'est1', bioma: 'cerrado', clima: 'tropical' } };
  const world = makeWorld({ mapa });
  saveWorldToDb(db, world);
  const loaded = loadWorldFromDb(db);

  assert.ok(typeof loaded.mapa === 'object', 'mapa is an object');
  const cell = loaded.mapa['10']?.['20'];
  assert.ok(cell, 'cell (10,20) present after load');
  assert.strictEqual(cell.tipo, 'terra');
  assert.strictEqual(cell.estado_id, 'est1');
  assert.strictEqual(cell.bioma, 'cerrado');
  assert.strictEqual(cell.clima, 'tropical');
});

test('loadWorldFromDb returns empty mapa for fresh DB', async () => {
  const db = await getDb();
  const world = loadWorldFromDb(db);
  assert.ok(typeof world.mapa === 'object', 'mapa is an object');
  assert.strictEqual(Object.keys(world.mapa).length, 0);
});

test('schema contains clubes and mapa tables', async () => {
  const db = await getDb();
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const names = tables[0].values.map(r => r[0]);
  assert.ok(names.includes('clubes'), 'table clubes exists');
  assert.ok(names.includes('mapa'),   'table mapa exists');
});

// ── statusToScore / scoreToStatus ─────────────────────────────────────────────

test('statusToScore maps correctly', () => {
  assert.strictEqual(statusToScore('crescimento'), 1);
  assert.strictEqual(statusToScore('estagnacao'), 0);
  assert.strictEqual(statusToScore('recessao'), -1);
  assert.strictEqual(statusToScore('unknown'), 0);
});

test('scoreToStatus maps correctly', () => {
  assert.strictEqual(scoreToStatus(1),    'crescimento');
  assert.strictEqual(scoreToStatus(0.5),  'crescimento');
  assert.strictEqual(scoreToStatus(0.34), 'crescimento');
  assert.strictEqual(scoreToStatus(0.33), 'estagnacao');
  assert.strictEqual(scoreToStatus(0),    'estagnacao');
  assert.strictEqual(scoreToStatus(-0.33),'estagnacao');
  assert.strictEqual(scoreToStatus(-0.34),'recessao');
  assert.strictEqual(scoreToStatus(-1),   'recessao');
});

// ── calcularNovoStatusEconomico ───────────────────────────────────────────────

test('calcularNovoStatusEconomico returns valid status string', () => {
  const validStatuses = new Set(['recessao', 'estagnacao', 'crescimento']);
  const result = calcularNovoStatusEconomico(
    ['crescimento', 'crescimento'],
    [1, 1],
    1, // own score = crescimento
    2,
    () => 0.5, // deterministic rng (no noise)
  );
  assert.ok(validStatuses.has(result), `result "${result}" is a valid status`);
});

test('calcularNovoStatusEconomico with all crescimento inputs yields crescimento', () => {
  // With deterministic rng at 0.5, noise = 0; all inputs = crescimento → score = 1 → crescimento
  const result = calcularNovoStatusEconomico(
    ['crescimento', 'crescimento'],
    [1, 1],
    1, 2,
    () => 0.5,
  );
  assert.strictEqual(result, 'crescimento');
});

test('calcularNovoStatusEconomico with all recessao inputs yields recessao', () => {
  const result = calcularNovoStatusEconomico(
    ['recessao', 'recessao'],
    [1, 1],
    -1, 2,
    () => 0.5, // no noise
  );
  assert.strictEqual(result, 'recessao');
});

test('calcularNovoStatusEconomico with empty context uses only own score', () => {
  const result = calcularNovoStatusEconomico(
    [], [], 1, 2,
    () => 0.5,
  );
  assert.strictEqual(result, 'crescimento');
});

// ── calcularStatusEmpresa ─────────────────────────────────────────────────────

test('calcularStatusEmpresa considers estado and suppliers', () => {
  const estado = makeEstado({ id: 'est1', status_economico: 'crescimento' });
  const fornecedor = makeEmpresa({ id: 'e2', status_economico: 'crescimento' });
  const empresa = makeEmpresa({
    id: 'e1', estado_id: 'est1',
    status_economico: 'crescimento',
    fornecedores_ids: ['e2'],
  });
  const world = makeWorld({ empresas: [empresa, fornecedor], estados: [estado] });

  const rng = () => 0.5; // no noise
  const newStatus = calcularStatusEmpresa(empresa, world, rng);
  assert.strictEqual(newStatus, 'crescimento');
});

test('calcularStatusEmpresa ignores unknown supplier IDs', () => {
  const estado = makeEstado({ id: 'est1', status_economico: 'estagnacao' });
  const empresa = makeEmpresa({
    id: 'e1', estado_id: 'est1',
    status_economico: 'estagnacao',
    fornecedores_ids: ['nonexistent'],
  });
  const world = makeWorld({ empresas: [empresa], estados: [estado] });
  const rng = () => 0.5;
  const newStatus = calcularStatusEmpresa(empresa, world, rng);
  assert.ok(['recessao', 'estagnacao', 'crescimento'].includes(newStatus));
});

// ── calcularStatusEstado ──────────────────────────────────────────────────────

test('calcularStatusEstado considers citizens weighted by peso', () => {
  const estado = makeEstado({ id: 'est1', status_economico: 'crescimento' });
  // One pessoa with high peso and crescimento should dominate
  const p1 = makePessoa({ id: 'p1', estado_id: 'est1', peso: 1000, status_economico: 'crescimento' });
  const world = makeWorld({ pessoas: [p1], estados: [estado] });
  const rng = () => 0.5;
  const newStatus = calcularStatusEstado(estado, world, rng);
  assert.strictEqual(newStatus, 'crescimento');
});

test('calcularStatusEstado considers parent estado', () => {
  const parent = makeEstado({ id: 'parent', status_economico: 'crescimento' });
  const child  = makeEstado({ id: 'child', parent_id: 'parent', status_economico: 'crescimento' });
  const world  = makeWorld({ estados: [parent, child] });
  const rng = () => 0.5;
  const newStatus = calcularStatusEstado(child, world, rng);
  assert.strictEqual(newStatus, 'crescimento');
});

test('calcularStatusEstado considers child estados', () => {
  const parent = makeEstado({ id: 'parent', status_economico: 'crescimento' });
  const child  = makeEstado({ id: 'child', parent_id: 'parent', status_economico: 'crescimento' });
  const world  = makeWorld({ estados: [parent, child] });
  const rng = () => 0.5;
  const newStatus = calcularStatusEstado(parent, world, rng);
  assert.strictEqual(newStatus, 'crescimento');
});

// ── calcularStatusPessoa ──────────────────────────────────────────────────────

test('calcularStatusPessoa considers estado status', () => {
  const estado = makeEstado({ id: 'est1', status_economico: 'crescimento' });
  const pessoa = makePessoa({ id: 'p1', estado_id: 'est1', status_economico: 'crescimento' });
  const world  = makeWorld({ pessoas: [pessoa], estados: [estado] });
  const rng = () => 0.5;
  const newStatus = calcularStatusPessoa(pessoa, world, rng);
  assert.strictEqual(newStatus, 'crescimento');
});

// ── tickMensal status recalculation ──────────────────────────────────────────

test('tickMensal updates status_economico for all entities', () => {
  const estado = makeEstado({ id: 'est1', status_economico: 'crescimento' });
  const empresa = makeEmpresa({ id: 'e1', estado_id: 'est1', status_economico: 'crescimento' });
  const pessoa = makePessoa({ id: 'p1', estado_id: 'est1', status_economico: 'crescimento' });
  const world = makeWorld({ pessoas: [pessoa], empresas: [empresa], estados: [estado] });

  tickMensal(makeConfig(), world);

  // After tick, all status_economico should still be valid strings
  const valid = new Set(['recessao', 'estagnacao', 'crescimento']);
  assert.ok(valid.has(empresa.status_economico), `empresa status "${empresa.status_economico}" is valid`);
  assert.ok(valid.has(estado.status_economico),  `estado status "${estado.status_economico}" is valid`);
  assert.ok(valid.has(pessoa.status_economico),  `pessoa status "${pessoa.status_economico}" is valid`);
});

test('tickMensal with all crescimento world keeps entities in crescimento or estagnacao (weighted)', () => {
  const estado = makeEstado({ id: 'est1', status_economico: 'crescimento' });
  const emp1   = makeEmpresa({ id: 'e1', estado_id: 'est1', status_economico: 'crescimento' });
  const emp2   = makeEmpresa({ id: 'e2', estado_id: 'est1', status_economico: 'crescimento', fornecedores_ids: ['e1'] });
  const p1     = makePessoa({ id: 'p1', estado_id: 'est1', peso: 1, status_economico: 'crescimento' });
  const world  = makeWorld({ pessoas: [p1], empresas: [emp1, emp2], estados: [estado] });

  // Run 3 ticks; all inputs are crescimento so final statuses should trend crescimento
  for (let i = 0; i < 3; i++) tickMensal(makeConfig(), world);

  // There may be noise, but with strong inputs, should never hit recessao
  assert.notStrictEqual(emp2.status_economico, 'recessao',
    'empresa e2 with crescimento suppliers should not enter recessao');
});
