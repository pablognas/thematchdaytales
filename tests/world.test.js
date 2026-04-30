/**
 * world.test.js — Unit tests for src/core/world.js.
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';

import {
  INFRAESTRUTURA_TIPOS,
  INFRAESTRUTURA_LABEL,
  recomputeEstadoInfrastrutura,
  rowsToEmpresas,
  empresasToRows,
  rowsToEstados,
  estadosToRows,
} from '../src/core/world.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEmpresa({ id = 'e1', estado_id = 'est1', infraestrutura = '', tick_saida = 0 } = {}) {
  return {
    id,
    nome: 'Empresa Teste',
    dono_id: '',
    estado_id,
    segmento: 'POP_NAO_DURAVEL',
    infraestrutura,
    patrimonio: 0,
    atributos: { funcionarios: 10, renda: 0, producao: 0, moral_corporativa: 3, reputacao_corporativa: 3, lucro: 0 },
    custos: { salario_funcionario: 0, manutencao: 0, insumos: 0 },
    tick_registro: 0,
    tick_saida,
    ativos: { patrimonio_geral: 0 },
  };
}

function makeEstado({ id = 'est1' } = {}) {
  return {
    id,
    nome: 'Estado Teste',
    tipo: '',
    parent_id: '',
    descricao: '',
    patrimonio: 0,
    atributos: { populacao: 0, forcas_armadas: 1, cultura: 1, moral_populacao: 3 },
    impostos: { ir_pf: 0, ir_pj: 0, imp_prod: 0 },
    financas: { renda_tributaria: 0, salarios_politicos: 0, incentivos_empresas: 0, investimento_cultura: 0, investimento_fa: 0 },
    infraestrutura: {},
    tick_registro: 0,
    tick_saida: 0,
    ativos: { patrimonio_geral: 0 },
  };
}

// ── INFRAESTRUTURA_TIPOS / INFRAESTRUTURA_LABEL ────────────────────────────────

test('INFRAESTRUTURA_TIPOS has 12 entries', () => {
  assert.strictEqual(INFRAESTRUTURA_TIPOS.length, 12);
});

test('INFRAESTRUTURA_LABEL has a label for every tipo', () => {
  for (const tipo of INFRAESTRUTURA_TIPOS) {
    assert.ok(INFRAESTRUTURA_LABEL[tipo], `Missing label for tipo: ${tipo}`);
  }
});

// ── recomputeEstadoInfrastrutura ──────────────────────────────────────────────

test('recomputeEstadoInfrastrutura sets no flags when there are no empresas', () => {
  const est   = makeEstado();
  const world = { pessoas: [], empresas: [], estados: [est] };
  recomputeEstadoInfrastrutura(world);
  for (const tipo of INFRAESTRUTURA_TIPOS) {
    assert.strictEqual(est.infraestrutura[tipo], false, `expected false for ${tipo}`);
  }
});

test('recomputeEstadoInfrastrutura sets flag when active empresa has matching infraestrutura', () => {
  const emp   = makeEmpresa({ estado_id: 'est1', infraestrutura: 'universidade' });
  const est   = makeEstado({ id: 'est1' });
  const world = { pessoas: [], empresas: [emp], estados: [est] };
  recomputeEstadoInfrastrutura(world);
  assert.strictEqual(est.infraestrutura.universidade, true);
  assert.strictEqual(est.infraestrutura.aeroporto, false);
});

test('recomputeEstadoInfrastrutura ignores archived empresas (tick_saida > 0)', () => {
  const emp   = makeEmpresa({ estado_id: 'est1', infraestrutura: 'aeroporto', tick_saida: 5 });
  const est   = makeEstado({ id: 'est1' });
  const world = { pessoas: [], empresas: [emp], estados: [est] };
  recomputeEstadoInfrastrutura(world);
  assert.strictEqual(est.infraestrutura.aeroporto, false);
});

test('recomputeEstadoInfrastrutura ignores empresa with empty infraestrutura', () => {
  const emp   = makeEmpresa({ estado_id: 'est1', infraestrutura: '' });
  const est   = makeEstado({ id: 'est1' });
  const world = { pessoas: [], empresas: [emp], estados: [est] };
  recomputeEstadoInfrastrutura(world);
  for (const tipo of INFRAESTRUTURA_TIPOS) {
    assert.strictEqual(est.infraestrutura[tipo], false);
  }
});

test('recomputeEstadoInfrastrutura does not affect unrelated estados', () => {
  const emp   = makeEmpresa({ estado_id: 'est1', infraestrutura: 'metro' });
  const est1  = makeEstado({ id: 'est1' });
  const est2  = makeEstado({ id: 'est2' });
  const world = { pessoas: [], empresas: [emp], estados: [est1, est2] };
  recomputeEstadoInfrastrutura(world);
  assert.strictEqual(est1.infraestrutura.metro, true);
  assert.strictEqual(est2.infraestrutura.metro, false);
});

test('recomputeEstadoInfrastrutura sets flag true when multiple empresas contribute same infra', () => {
  const emp1  = makeEmpresa({ id: 'e1', estado_id: 'est1', infraestrutura: 'creche' });
  const emp2  = makeEmpresa({ id: 'e2', estado_id: 'est1', infraestrutura: 'creche' });
  const est   = makeEstado({ id: 'est1' });
  const world = { pessoas: [], empresas: [emp1, emp2], estados: [est] };
  recomputeEstadoInfrastrutura(world);
  assert.strictEqual(est.infraestrutura.creche, true);
});

test('recomputeEstadoInfrastrutura resets existing flags before recomputing', () => {
  const emp   = makeEmpresa({ estado_id: 'est1', infraestrutura: 'porto' });
  const est   = makeEstado({ id: 'est1' });
  est.infraestrutura = { metro: true };  // stale flag
  const world = { pessoas: [], empresas: [emp], estados: [est] };
  recomputeEstadoInfrastrutura(world);
  assert.strictEqual(est.infraestrutura.metro, false);
  assert.strictEqual(est.infraestrutura.porto, true);
});

// ── rowsToEmpresas / empresasToRows round-trip with infraestrutura ─────────────

test('rowsToEmpresas defaults infraestrutura to empty string when not present', () => {
  const rows = [{ id: 'e1', nome: 'Test', dono_id: '', estado_id: '', segmento: '' }];
  const empresas = rowsToEmpresas(rows);
  assert.strictEqual(empresas[0].infraestrutura, '');
});

test('rowsToEmpresas preserves infraestrutura value from row', () => {
  const rows = [{ id: 'e1', nome: 'Test', dono_id: '', estado_id: '', infraestrutura: 'universidade' }];
  const empresas = rowsToEmpresas(rows);
  assert.strictEqual(empresas[0].infraestrutura, 'universidade');
});

test('empresasToRows round-trip preserves infraestrutura', () => {
  const emp = makeEmpresa({ infraestrutura: 'aeroporto' });
  const rows = empresasToRows([emp]);
  assert.strictEqual(rows[0].infraestrutura, 'aeroporto');
  const loaded = rowsToEmpresas(rows);
  assert.strictEqual(loaded[0].infraestrutura, 'aeroporto');
});

// ── rowsToEstados / estadosToRows round-trip with infra flags ─────────────────

test('rowsToEstados defaults all infra flags to false when not present', () => {
  const rows = [{ id: 's1', nome: 'Test', tipo: '', parent_id: '', descricao: '' }];
  const estados = rowsToEstados(rows);
  for (const tipo of INFRAESTRUTURA_TIPOS) {
    assert.strictEqual(estados[0].infraestrutura[tipo], false, `expected false for ${tipo}`);
  }
});

test('rowsToEstados reads infra flag from infra_* column', () => {
  const rows = [{ id: 's1', nome: 'Test', tipo: '', parent_id: '', descricao: '', infra_universidade: 1 }];
  const estados = rowsToEstados(rows);
  assert.strictEqual(estados[0].infraestrutura.universidade, true);
  assert.strictEqual(estados[0].infraestrutura.aeroporto, false);
});

test('estadosToRows / rowsToEstados round-trip preserves infra flags', () => {
  const est = makeEstado({ id: 's1' });
  est.infraestrutura = { universidade: true, aeroporto: false, creche: true, escola_primaria: false,
    escola_secundaria: false, ensino_medio: false, rodoviaria: false, porto: false,
    estacao_trem: false, metro: false, onibus_municipais: false, centro_comercial: false };
  const rows = estadosToRows([est]);
  assert.strictEqual(rows[0].infra_universidade, 1);
  assert.strictEqual(rows[0].infra_aeroporto, 0);
  assert.strictEqual(rows[0].infra_creche, 1);
  const loaded = rowsToEstados(rows);
  assert.strictEqual(loaded[0].infraestrutura.universidade, true);
  assert.strictEqual(loaded[0].infraestrutura.aeroporto, false);
  assert.strictEqual(loaded[0].infraestrutura.creche, true);
});
