/**
 * engine.test.js — Unit tests for src/core/engine.js (tickMensal).
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';

import { tickMensal } from '../src/core/engine.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Minimal config stub that satisfies tickMensal's needs. */
function makeConfig() {
  return {
    classes:    { classes: [] },
    atributos:  {},
    conversoes: {},
    fluxos:     {},
    produtos:   {},
  };
}

/** Build a minimal Empresa object. */
function makeEmpresa({
  id = 'e1',
  nome = 'Empresa Teste',
  estado_id = 'est1',
  dono_id = '',
  funcionarios = 10,
  lucro = 1000,
  manutencao = 0,
  insumos = 0,
} = {}) {
  return {
    id,
    nome,
    dono_id,
    estado_id,
    segmento: 'POP_NAO_DURAVEL',
    patrimonio: 0,
    atributos: {
      funcionarios,
      renda: 0,
      producao: 0,
      moral_corporativa: 3,
      reputacao_corporativa: 3,
      lucro,
    },
    custos: { salario_funcionario: 0, manutencao, insumos },
    tick_registro: 0,
    tick_saida: 0,
    ativos: { patrimonio_geral: 0 },
  };
}

/** Build a minimal Estado object. */
function makeEstado({ id = 'est1' } = {}) {
  return {
    id,
    nome: 'Estado Teste',
    atributos: {
      populacao: 1000,
      forcas_armadas: 3,
      cultura: 3,
      moral_populacao: 3,
    },
    impostos: { ir_pf: 0, ir_pj: 0 },
    financas: {
      renda_tributaria: 0,
      salarios_politicos: 0,
      investimento_cultura: 0,
      investimento_fa: 0,
    },
    tick_registro: 0,
    tick_saida: 0,
    patrimonio: 0,
    ativos: { patrimonio_geral: 0 },
  };
}

/** Minimal world stub. */
function makeWorld({ empresas = [], pessoas = [], estados = [] } = {}) {
  return { empresas, pessoas, estados };
}

// ── Produção formula tests ─────────────────────────────────────────────────────

test('producao = funcionarios when insumos=0 and manutencao=0 (neutral exponent clamped to 1)', () => {
  const emp    = makeEmpresa({ funcionarios: 10, manutencao: 0, insumos: 0 });
  const world  = makeWorld({ empresas: [emp], estados: [makeEstado()] });
  tickMensal(makeConfig(), world);
  // ins=0 → expo clamped to 1 → 10 ** 1 = 10
  assert.strictEqual(emp.atributos.producao, 10);
});

test('producao uses right-associative exponentiation: funcionarios**(insumos**manutencao)', () => {
  const emp    = makeEmpresa({ funcionarios: 10, manutencao: 0.5, insumos: 0.5 });
  const world  = makeWorld({ empresas: [emp], estados: [makeEstado()] });
  tickMensal(makeConfig(), world);
  // 10 ** (0.5 ** 0.5)
  const expected = 10 ** (0.5 ** 0.5);
  assert.ok(
    Math.abs(emp.atributos.producao - expected) < 1e-9,
    `expected ${expected}, got ${emp.atributos.producao}`,
  );
});

test('producao = funcionarios when insumos=0 regardless of manutencao (edge case clamp)', () => {
  const emp    = makeEmpresa({ funcionarios: 5, manutencao: 0.3, insumos: 0 });
  const world  = makeWorld({ empresas: [emp], estados: [makeEstado()] });
  tickMensal(makeConfig(), world);
  // ins=0 → expo clamped to 1 → 5 ** 1 = 5
  assert.strictEqual(emp.atributos.producao, 5);
});

test('producao = funcionarios when insumos > 0 and manutencao=0 (expo = insumos**0 = 1)', () => {
  const emp    = makeEmpresa({ funcionarios: 7, manutencao: 0, insumos: 0.5 });
  const world  = makeWorld({ empresas: [emp], estados: [makeEstado()] });
  tickMensal(makeConfig(), world);
  // ins=0.5, man=0: expo = 0.5 ** 0 = 1 → 7 ** 1 = 7
  assert.strictEqual(emp.atributos.producao, 7);
});

test('producao = 0 when funcionarios = 0', () => {
  const emp   = makeEmpresa({ funcionarios: 0, manutencao: 0.5, insumos: 0.5 });
  const world = makeWorld({ empresas: [emp], estados: [makeEstado()] });
  tickMensal(makeConfig(), world);
  assert.strictEqual(emp.atributos.producao, 0);
});

test('negative percentages are clamped to 0 (no penalty below zero)', () => {
  const emp   = makeEmpresa({ funcionarios: 8, manutencao: -0.5, insumos: -0.5 });
  const world = makeWorld({ empresas: [emp], estados: [makeEstado()] });
  tickMensal(makeConfig(), world);
  // Both clamped to 0: ins=0 → expo clamped to 1 → 8 ** 1 = 8
  assert.strictEqual(emp.atributos.producao, 8);
});

test('log contains a [Produção] entry for each empresa', () => {
  const emp1  = makeEmpresa({ id: 'e1', nome: 'Alpha', funcionarios: 5 });
  const emp2  = makeEmpresa({ id: 'e2', nome: 'Beta',  funcionarios: 7, estado_id: 'est1' });
  const world = makeWorld({ empresas: [emp1, emp2], estados: [makeEstado()] });
  const log   = tickMensal(makeConfig(), world);
  const prodLines = log.filter(l => l.startsWith('[Produção]'));
  assert.strictEqual(prodLines.length, 2);
  assert.ok(prodLines.some(l => l.includes('Alpha')));
  assert.ok(prodLines.some(l => l.includes('Beta')));
});

// ── Lucro formula tests ───────────────────────────────────────────────────────
// Note: empresa state_id is set to 'NONE' in these tests so the IRPJ/dividends
// step (which requires a matching estado) is skipped, allowing us to verify the
// raw lucro formula output without the 30% dividend deduction.

test('lucro = funcionarios when insumos=0 and manutencao=0 (neutral exponent clamped to 1)', () => {
  const emp   = makeEmpresa({ funcionarios: 10, insumos: 0, manutencao: 0, estado_id: 'NONE' });
  const world = makeWorld({ empresas: [emp] });
  tickMensal(makeConfig(), world);
  // ins=0 → expo clamped to 1 → 10 ** 1 = 10
  assert.strictEqual(emp.atributos.lucro, 10);
});

test('lucro uses right-associative exponentiation: funcionarios**(insumos**manutencao)', () => {
  const emp   = makeEmpresa({ funcionarios: 10, insumos: 0.5, manutencao: 0.5, estado_id: 'NONE' });
  const world = makeWorld({ empresas: [emp] });
  tickMensal(makeConfig(), world);
  const expected = 10 ** (0.5 ** 0.5);
  assert.ok(
    Math.abs(emp.atributos.lucro - expected) < 1e-9,
    `expected ${expected}, got ${emp.atributos.lucro}`,
  );
});

test('lucro = funcionarios when insumos=0 regardless of manutencao (edge case clamp)', () => {
  const emp   = makeEmpresa({ funcionarios: 8, insumos: 0, manutencao: 0.3, estado_id: 'NONE' });
  const world = makeWorld({ empresas: [emp] });
  tickMensal(makeConfig(), world);
  // ins=0 → expo clamped to 1 → 8 ** 1 = 8
  assert.strictEqual(emp.atributos.lucro, 8);
});

test('lucro = 0 when funcionarios = 0', () => {
  const emp   = makeEmpresa({ funcionarios: 0, insumos: 0.5, manutencao: 0.5, estado_id: 'NONE' });
  const world = makeWorld({ empresas: [emp] });
  tickMensal(makeConfig(), world);
  assert.strictEqual(emp.atributos.lucro, 0);
});

test('lucro negative percentages are clamped to 0 for insumos and manutencao', () => {
  const emp   = makeEmpresa({ funcionarios: 5, insumos: -0.5, manutencao: -0.5, estado_id: 'NONE' });
  const world = makeWorld({ empresas: [emp] });
  tickMensal(makeConfig(), world);
  // ins clamped to 0 → expo clamped to 1 → 5 ** 1 = 5
  assert.strictEqual(emp.atributos.lucro, 5);
});

test('log contains a [Lucro] entry for each empresa', () => {
  const emp1  = makeEmpresa({ id: 'e1', nome: 'Alpha', funcionarios: 5 });
  const emp2  = makeEmpresa({ id: 'e2', nome: 'Beta',  funcionarios: 7, estado_id: 'est1' });
  const world = makeWorld({ empresas: [emp1, emp2], estados: [makeEstado()] });
  const log   = tickMensal(makeConfig(), world);
  const lucroLines = log.filter(l => l.startsWith('[Lucro]'));
  assert.strictEqual(lucroLines.length, 2);
  assert.ok(lucroLines.some(l => l.includes('Alpha')));
  assert.ok(lucroLines.some(l => l.includes('Beta')));
});
