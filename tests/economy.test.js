/**
 * economy.test.js — Unit tests for the economic simulation module (src/core/economy.js).
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';

import {
  simulateEconomy,
  simulateEconomyBySegment,
  PUBLICO_ALVO,
  TIPO_BEM,
  SEGMENTO,
  SEGMENTO_META,
} from '../src/core/economy.js';

// ── Basic return shape ────────────────────────────────────────────────────────

test('simulateEconomy returns expected shape', () => {
  const result = simulateEconomy({ population: 100000, steps: 12 });
  assert.ok(typeof result.targetCompanies === 'number');
  assert.ok(Array.isArray(result.series));
  assert.strictEqual(result.series.length, 12);
  assert.ok(typeof result.meta === 'object');
});

test('series has correct step numbers', () => {
  const { series } = simulateEconomy({ population: 50000, steps: 6 });
  for (let i = 0; i < 6; i++) {
    assert.strictEqual(series[i].step, i + 1);
  }
});

test('each series entry has required fields', () => {
  const { series } = simulateEconomy({ population: 200000, steps: 3 });
  for (const s of series) {
    assert.ok('step'        in s, 'step present');
    assert.ok('companies'   in s, 'companies present');
    assert.ok('crisis'      in s, 'crisis present');
    assert.ok('crisisShock' in s, 'crisisShock present');
    assert.ok('recovering'  in s, 'recovering present');
    assert.ok(Number.isFinite(s.companies) && s.companies >= 1,
      `companies >= 1 at step ${s.step}`);
    assert.ok(typeof s.crisis === 'boolean');
    assert.ok(typeof s.recovering === 'boolean');
  }
});

// ── targetCompanies ───────────────────────────────────────────────────────────

test('targetCompanies = round(population / k)', () => {
  const { targetCompanies } = simulateEconomy({ population: 100000, k: 1000 });
  assert.strictEqual(targetCompanies, 100);
});

test('targetCompanies is at least 1 for tiny population', () => {
  const { targetCompanies } = simulateEconomy({ population: 1, k: 1000 });
  assert.strictEqual(targetCompanies, 1);
});

test('custom k scales targetCompanies correctly', () => {
  const { targetCompanies } = simulateEconomy({ population: 500000, k: 5000 });
  assert.strictEqual(targetCompanies, 100);
});

// ── Reproducibility via seed ──────────────────────────────────────────────────

test('same seed produces identical series', () => {
  const a = simulateEconomy({ population: 1000000, economicState: 'instavel', seed: 42, steps: 24 });
  const b = simulateEconomy({ population: 1000000, economicState: 'instavel', seed: 42, steps: 24 });
  assert.deepStrictEqual(a.series, b.series);
  assert.strictEqual(a.meta.totalCrises, b.meta.totalCrises);
});

test('different seeds produce different series (very likely)', () => {
  const a = simulateEconomy({ population: 500000, economicState: 'instavel', seed: 1,   steps: 60 });
  const b = simulateEconomy({ population: 500000, economicState: 'instavel', seed: 9999, steps: 60 });
  // With 60 steps at 20% crisis probability, at least one value should differ
  const same = a.series.every((s, i) => s.companies === b.series[i].companies);
  assert.ok(!same, 'series should differ with different seeds');
});

// ── Economic state params ─────────────────────────────────────────────────────

test('instavel has higher crisis probability than estavel (reflected in meta)', () => {
  const estavel  = simulateEconomy({ population: 100000, economicState: 'estavel'  });
  const instavel = simulateEconomy({ population: 100000, economicState: 'instavel' });
  assert.ok(instavel.meta.crisisProb > estavel.meta.crisisProb);
});

test('instavel has higher max shock than estavel', () => {
  const estavel  = simulateEconomy({ population: 100000, economicState: 'estavel'  });
  const instavel = simulateEconomy({ population: 100000, economicState: 'instavel' });
  assert.ok(instavel.meta.crisisMaxShock > estavel.meta.crisisMaxShock);
});

test('instavel has longer average recovery than estavel', () => {
  const estavel  = simulateEconomy({ population: 100000, economicState: 'estavel'  });
  const instavel = simulateEconomy({ population: 100000, economicState: 'instavel' });
  assert.ok(instavel.meta.avgRecoverySteps > estavel.meta.avgRecoverySteps);
});

test('unknown economicState falls back to estavel params', () => {
  const fallback = simulateEconomy({ population: 100000, economicState: 'unknown' });
  const estavel  = simulateEconomy({ population: 100000, economicState: 'estavel' });
  assert.strictEqual(fallback.meta.crisisProb, estavel.meta.crisisProb);
});

// ── Crisis behaviour ──────────────────────────────────────────────────────────

test('crisisShock is 0 when no crisis occurred', () => {
  const { series } = simulateEconomy({ population: 100000, steps: 60 });
  for (const s of series) {
    if (!s.crisis) {
      assert.strictEqual(s.crisisShock, 0);
    }
  }
});

test('crisisShock > 0 when crisis occurred', () => {
  // Use instavel + long run to guarantee at least one crisis with a fixed seed
  const { series } = simulateEconomy({
    population: 500000, economicState: 'instavel', seed: 7, steps: 120,
  });
  const crises = series.filter(s => s.crisis);
  assert.ok(crises.length > 0, 'expected at least one crisis');
  for (const s of crises) {
    assert.ok(s.crisisShock > 0, `crisisShock should be > 0 at step ${s.step}`);
  }
});

test('companies never drop below 1', () => {
  const { series } = simulateEconomy({
    population: 100, economicState: 'instavel', seed: 13, steps: 120,
  });
  for (const s of series) {
    assert.ok(s.companies >= 1, `companies < 1 at step ${s.step}: ${s.companies}`);
  }
});

// ── Meta fields ───────────────────────────────────────────────────────────────

test('meta.totalCrises matches crisis count in series', () => {
  const { series, meta } = simulateEconomy({
    population: 1000000, economicState: 'instavel', seed: 99, steps: 60,
  });
  const counted = series.filter(s => s.crisis).length;
  assert.strictEqual(meta.totalCrises, counted);
});

test('meta.finalCompanies matches last series entry', () => {
  const { series, meta } = simulateEconomy({ population: 200000, steps: 24, seed: 5 });
  assert.strictEqual(meta.finalCompanies, series[series.length - 1].companies);
});

test('meta.stateId is passed through', () => {
  const { meta } = simulateEconomy({ stateId: 'br_sp', population: 50000, steps: 6 });
  assert.strictEqual(meta.stateId, 'br_sp');
});

// ── Validation ────────────────────────────────────────────────────────────────

test('throws RangeError for negative population', () => {
  assert.throws(
    () => simulateEconomy({ population: -1 }),
    (err) => err instanceof RangeError,
  );
});

test('throws RangeError for steps < 1', () => {
  assert.throws(
    () => simulateEconomy({ population: 100000, steps: 0 }),
    (err) => err instanceof RangeError,
  );
});

test('throws RangeError for k <= 0', () => {
  assert.throws(
    () => simulateEconomy({ population: 100000, k: 0 }),
    (err) => err instanceof RangeError,
  );
});

test('zero population returns 1 company (minimum)', () => {
  const { targetCompanies } = simulateEconomy({ population: 0 });
  assert.strictEqual(targetCompanies, 1);
});

// ── Segment constants ─────────────────────────────────────────────────────────

test('PUBLICO_ALVO has expected keys', () => {
  assert.strictEqual(PUBLICO_ALVO.POPULACAO, 'POPULACAO');
  assert.strictEqual(PUBLICO_ALVO.EMPRESAS,  'EMPRESAS');
  assert.strictEqual(PUBLICO_ALVO.ESTADO,    'ESTADO');
});

test('TIPO_BEM has expected keys', () => {
  assert.strictEqual(TIPO_BEM.DURAVEL,     'DURAVEL');
  assert.strictEqual(TIPO_BEM.NAO_DURAVEL, 'NAO_DURAVEL');
});

test('SEGMENTO has expected keys', () => {
  assert.strictEqual(SEGMENTO.POP_NAO_DURAVEL, 'POP_NAO_DURAVEL');
  assert.strictEqual(SEGMENTO.POP_DURAVEL,     'POP_DURAVEL');
  assert.strictEqual(SEGMENTO.B2B,             'B2B');
  assert.strictEqual(SEGMENTO.ESTADO,          'ESTADO');
});

test('SEGMENTO_META has entry for every SEGMENTO key', () => {
  for (const seg of Object.values(SEGMENTO)) {
    assert.ok(seg in SEGMENTO_META, `SEGMENTO_META missing entry for ${seg}`);
    assert.ok(typeof SEGMENTO_META[seg].label === 'string');
    assert.ok(typeof SEGMENTO_META[seg].publicoAlvo === 'string');
  }
});

test('SEGMENTO_META.POP_NAO_DURAVEL publicoAlvo is POPULACAO and tipoBem is NAO_DURAVEL', () => {
  assert.strictEqual(SEGMENTO_META[SEGMENTO.POP_NAO_DURAVEL].publicoAlvo, PUBLICO_ALVO.POPULACAO);
  assert.strictEqual(SEGMENTO_META[SEGMENTO.POP_NAO_DURAVEL].tipoBem,     TIPO_BEM.NAO_DURAVEL);
});

test('SEGMENTO_META.POP_DURAVEL publicoAlvo is POPULACAO and tipoBem is DURAVEL', () => {
  assert.strictEqual(SEGMENTO_META[SEGMENTO.POP_DURAVEL].publicoAlvo, PUBLICO_ALVO.POPULACAO);
  assert.strictEqual(SEGMENTO_META[SEGMENTO.POP_DURAVEL].tipoBem,     TIPO_BEM.DURAVEL);
});

test('SEGMENTO_META.B2B publicoAlvo is EMPRESAS', () => {
  assert.strictEqual(SEGMENTO_META[SEGMENTO.B2B].publicoAlvo, PUBLICO_ALVO.EMPRESAS);
  assert.strictEqual(SEGMENTO_META[SEGMENTO.B2B].tipoBem,     null);
});

test('SEGMENTO_META.ESTADO publicoAlvo is ESTADO', () => {
  assert.strictEqual(SEGMENTO_META[SEGMENTO.ESTADO].publicoAlvo, PUBLICO_ALVO.ESTADO);
  assert.strictEqual(SEGMENTO_META[SEGMENTO.ESTADO].tipoBem,     null);
});

// ── simulateEconomyBySegment — basic shape ────────────────────────────────────

test('simulateEconomyBySegment returns macro, shares, segments', () => {
  const result = simulateEconomyBySegment({ population: 100000, steps: 12, seed: 1 });
  assert.ok(typeof result.macro === 'object', 'macro present');
  assert.ok(typeof result.shares === 'object', 'shares present');
  assert.ok(typeof result.segments === 'object', 'segments present');
});

test('simulateEconomyBySegment macro matches simulateEconomy with same params', () => {
  const params = { population: 200000, economicState: 'instavel', seed: 42, steps: 24 };
  const macro  = simulateEconomy(params);
  const seg    = simulateEconomyBySegment(params);
  assert.deepStrictEqual(seg.macro.series,           macro.series);
  assert.strictEqual(    seg.macro.meta.totalCrises, macro.meta.totalCrises);
});

test('simulateEconomyBySegment segments have all SEGMENTO keys', () => {
  const result = simulateEconomyBySegment({ population: 100000, steps: 6, seed: 5 });
  for (const seg of Object.values(SEGMENTO)) {
    assert.ok(seg in result.segments, `segments missing ${seg}`);
    assert.strictEqual(result.segments[seg].length, 6);
  }
});

test('each segment series entry has required fields', () => {
  const result = simulateEconomyBySegment({ population: 100000, steps: 3, seed: 7 });
  for (const seg of Object.values(SEGMENTO)) {
    for (const entry of result.segments[seg]) {
      assert.ok('step'         in entry, `${seg}: step present`);
      assert.ok('companies'    in entry, `${seg}: companies present`);
      assert.ok('demand'       in entry, `${seg}: demand present`);
      assert.ok('revenueIndex' in entry, `${seg}: revenueIndex present`);
      assert.ok(entry.companies >= 1, `${seg}: companies >= 1`);
      assert.ok(entry.demand > 0,     `${seg}: demand > 0`);
    }
  }
});

test('POP_DURAVEL segment entries include stockLevel', () => {
  const result  = simulateEconomyBySegment({ population: 100000, steps: 3, seed: 9 });
  const entries = result.segments[SEGMENTO.POP_DURAVEL];
  for (const entry of entries) {
    assert.ok('stockLevel' in entry, 'POP_DURAVEL must have stockLevel');
    assert.ok(entry.stockLevel > 0 && entry.stockLevel <= 1.0,
      `stockLevel out of range: ${entry.stockLevel}`);
  }
});

test('POP_NAO_DURAVEL segment entries do not include stockLevel', () => {
  const result  = simulateEconomyBySegment({ population: 100000, steps: 3, seed: 9 });
  const entries = result.segments[SEGMENTO.POP_NAO_DURAVEL];
  for (const entry of entries) {
    assert.ok(!('stockLevel' in entry), 'POP_NAO_DURAVEL must not have stockLevel');
  }
});

// ── Shares normalisation ──────────────────────────────────────────────────────

test('shares sum to approximately 1.0', () => {
  const { shares } = simulateEconomyBySegment({ population: 100000, steps: 6, seed: 1 });
  const total = Object.values(shares).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1.0) < 1e-9, `shares sum ${total} ≠ 1`);
});

test('custom shares override defaults and are normalised', () => {
  const customShares = {
    [SEGMENTO.POP_NAO_DURAVEL]: 0.50,
    [SEGMENTO.POP_DURAVEL]:     0.50,
    [SEGMENTO.B2B]:             0.00,
    [SEGMENTO.ESTADO]:          0.00,
  };
  const { shares } = simulateEconomyBySegment({ population: 100000, steps: 6, seed: 2, shares: customShares });
  // After normalisation only POP_NAO_DURAVEL and POP_DURAVEL have share > 0
  assert.ok(shares[SEGMENTO.POP_NAO_DURAVEL] > 0);
  assert.ok(shares[SEGMENTO.POP_DURAVEL]     > 0);
  const total = Object.values(shares).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1.0) < 1e-9, `normalised shares sum ${total} ≠ 1`);
});

// ── Durables vs non-durables dynamic differences ──────────────────────────────

test('POP_DURAVEL stockLevel depreciates over time without crises', () => {
  // Use a seed with no crises to isolate depreciation behaviour
  const result = simulateEconomyBySegment({
    population: 1000000, economicState: 'estavel', seed: 100, steps: 30,
  });
  const dur = result.segments[SEGMENTO.POP_DURAVEL];
  // Stock should be less than 1 after some steps due to depreciation
  const finalStock = dur[dur.length - 1].stockLevel;
  assert.ok(finalStock < 1.0, `Expected stockLevel < 1.0, got ${finalStock}`);
});

test('POP_DURAVEL demand drops more than POP_NAO_DURAVEL in a crisis scenario', () => {
  // Use instavel + guaranteed crisis seed to trigger at least one crisis
  const result = simulateEconomyBySegment({
    population: 1000000, economicState: 'instavel', seed: 7, steps: 120,
  });
  // Find the first crisis step
  const crisisIdx = result.macro.series.findIndex(s => s.crisis);
  if (crisisIdx < 0) return; // skip if no crisis (extremely unlikely with seed 7)

  // Check the step after crisis: durables demand should be lower (or equal) vs non-durables
  const stepAfter = crisisIdx + 1;
  if (stepAfter >= 120) return;

  const ndDemand  = result.segments[SEGMENTO.POP_NAO_DURAVEL][stepAfter].demand;
  const durDemand = result.segments[SEGMENTO.POP_DURAVEL][stepAfter].demand;
  // Durables factor (1.2) > non-durables factor (0.8), so durables demand drops more
  assert.ok(durDemand <= ndDemand + 0.01,
    `Expected durables demand (${durDemand}) ≤ non-durables demand (${ndDemand}) after crisis`);
});

test('ESTADO segment demand remains higher than B2B after a severe crisis', () => {
  const result = simulateEconomyBySegment({
    population: 1000000, economicState: 'instavel', seed: 7, steps: 120,
  });
  const crisisIdx = result.macro.series.findIndex(s => s.crisis);
  if (crisisIdx < 0) return;
  const stepAfter = crisisIdx + 1;
  if (stepAfter >= 120) return;

  const b2bDemand   = result.segments[SEGMENTO.B2B][stepAfter].demand;
  const estadoDemand = result.segments[SEGMENTO.ESTADO][stepAfter].demand;
  // Estado (inelastic, factor 0.20) should be less affected than B2B (factor 0.60)
  assert.ok(estadoDemand >= b2bDemand - 0.01,
    `Expected estado demand (${estadoDemand}) ≥ b2b demand (${b2bDemand}) after crisis`);
});

// ── Reproducibility ───────────────────────────────────────────────────────────

test('simulateEconomyBySegment same seed produces identical results', () => {
  const params = { population: 500000, economicState: 'instavel', seed: 99, steps: 24 };
  const a = simulateEconomyBySegment(params);
  const b = simulateEconomyBySegment(params);
  assert.deepStrictEqual(a.segments, b.segments);
  assert.deepStrictEqual(a.shares,   b.shares);
});

