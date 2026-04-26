/**
 * economy.test.js — Unit tests for the economic simulation module (src/core/economy.js).
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';

import { simulateEconomy } from '../src/core/economy.js';

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
