/**
 * tick-helpers.test.js — Unit tests for the tick ↔ date helper functions
 * exported from src/core/scheduler.js, and for the parseTickInput / tick_registro
 * editing behaviour that those helpers underpin.
 *
 * These helpers were previously private to web/app.js (PR #32 introduced the
 * "Ir para Tick" widget that duplicated them there). After the revert they live
 * exclusively in scheduler.js and are importable here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// scheduler.js reads/writes localStorage; provide an in-memory stub.
const store = {};
global.localStorage = {
  getItem:    key        => store[key] ?? null,
  setItem:    (key, val) => { store[key] = String(val); },
  removeItem: key        => { delete store[key]; },
};

import {
  TICK_EPOCH_YEAR,
  tickToDate,
  dateToTick,
  tickLabel,
} from '../src/core/scheduler.js';

// ── TICK_EPOCH_YEAR ───────────────────────────────────────────────────────────

test('TICK_EPOCH_YEAR is 1850', () => {
  assert.equal(TICK_EPOCH_YEAR, 1850);
});

// ── tickToDate ────────────────────────────────────────────────────────────────

test('tickToDate: tick 1 = January 1850', () => {
  const { month, year } = tickToDate(1);
  assert.equal(month, 1);
  assert.equal(year, 1850);
});

test('tickToDate: tick 12 = December 1850', () => {
  const { month, year } = tickToDate(12);
  assert.equal(month, 12);
  assert.equal(year, 1850);
});

test('tickToDate: tick 13 = January 1851', () => {
  const { month, year } = tickToDate(13);
  assert.equal(month, 1);
  assert.equal(year, 1851);
});

test('tickToDate: tick 601 = January 1900', () => {
  // tick 601 = 600 offset → 600 / 12 = 50 years → 1850 + 50 = 1900, month = 1
  const { month, year } = tickToDate(601);
  assert.equal(month, 1);
  assert.equal(year, 1900);
});

test('tickToDate: clamps negative/zero ticks to tick 1 equivalent', () => {
  const { month, year } = tickToDate(0);
  assert.equal(month, 1);
  assert.equal(year, 1850);
});

// ── dateToTick ────────────────────────────────────────────────────────────────

test('dateToTick: January 1850 = tick 1', () => {
  assert.equal(dateToTick(1, 1850), 1);
});

test('dateToTick: December 1850 = tick 12', () => {
  assert.equal(dateToTick(12, 1850), 12);
});

test('dateToTick: January 1851 = tick 13', () => {
  assert.equal(dateToTick(1, 1851), 13);
});

test('dateToTick: January 1900 = tick 601', () => {
  assert.equal(dateToTick(1, 1900), 601);
});

test('tickToDate and dateToTick are inverses for arbitrary ticks', () => {
  for (const tick of [1, 6, 12, 13, 24, 100, 601, 1200]) {
    const { month, year } = tickToDate(tick);
    assert.equal(dateToTick(month, year), tick, `round-trip failed for tick ${tick}`);
  }
});

// ── tickLabel ─────────────────────────────────────────────────────────────────

test('tickLabel: tick 0 returns "—"', () => {
  assert.equal(tickLabel(0), '—');
});

test('tickLabel: negative tick returns "—"', () => {
  assert.equal(tickLabel(-5), '—');
});

test('tickLabel: tick 1 returns "1/1850"', () => {
  assert.equal(tickLabel(1), '1/1850');
});

test('tickLabel: tick 12 returns "12/1850"', () => {
  assert.equal(tickLabel(12), '12/1850');
});

test('tickLabel: tick 13 returns "1/1851"', () => {
  assert.equal(tickLabel(13), '1/1851');
});

test('tickLabel: tick 601 returns "1/1900"', () => {
  assert.equal(tickLabel(601), '1/1900');
});

// ── parseTickInput (logic extracted for testing) ──────────────────────────────
// This mirrors the parseTickInput() function in web/app.js — we test the pure
// logic here so we don't depend on a browser environment.

function parseTickInput(val) {
  const s = String(val).trim();
  const match = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (match) {
    const m = parseInt(match[1], 10);
    const y = parseInt(match[2], 10);
    if (m >= 1 && m <= 12 && y >= TICK_EPOCH_YEAR) return dateToTick(m, y);
    return 0;
  }
  const n = parseInt(s, 10);
  return n > 0 ? n : 0;
}

test('parseTickInput: "1/1850" parses to tick 1', () => {
  assert.equal(parseTickInput('1/1850'), 1);
});

test('parseTickInput: "12/1850" parses to tick 12', () => {
  assert.equal(parseTickInput('12/1850'), 12);
});

test('parseTickInput: "1/1900" parses to tick 601', () => {
  assert.equal(parseTickInput('1/1900'), 601);
});

test('parseTickInput: "6/2000" parses correctly', () => {
  const expected = dateToTick(6, 2000);
  assert.equal(parseTickInput('6/2000'), expected);
});

test('parseTickInput: raw tick integer string returns the integer', () => {
  assert.equal(parseTickInput('42'), 42);
});

test('parseTickInput: raw integer 601', () => {
  assert.equal(parseTickInput('601'), 601);
});

test('parseTickInput: empty string returns 0 (invalid)', () => {
  assert.equal(parseTickInput(''), 0);
});

test('parseTickInput: "0" returns 0 (invalid — ticks start at 1)', () => {
  assert.equal(parseTickInput('0'), 0);
});

test('parseTickInput: negative number string returns 0', () => {
  assert.equal(parseTickInput('-5'), 0);
});

test('parseTickInput: month 0 is invalid, returns 0', () => {
  assert.equal(parseTickInput('0/1850'), 0);
});

test('parseTickInput: month 13 is invalid, returns 0', () => {
  assert.equal(parseTickInput('13/1850'), 0);
});

test('parseTickInput: year before epoch is invalid, returns 0', () => {
  assert.equal(parseTickInput('1/1849'), 0);
});

test('parseTickInput: random text returns 0', () => {
  assert.equal(parseTickInput('invalid'), 0);
});

test('parseTickInput: accepts leading/trailing whitespace', () => {
  assert.equal(parseTickInput('  1/1850  '), 1);
});

// ── tick_registro editing integration ────────────────────────────────────────
// Simulate the FIELD_SETTERS['tick_registro'] logic: parse input → set entity field.

function applyTickRegistro(entity, val) {
  const parsed = parseTickInput(val);
  if (parsed > 0) entity.tick_registro = parsed;
}

test('tick_registro: "1/1850" sets tick_registro to 1', () => {
  const entity = { tick_registro: 0 };
  applyTickRegistro(entity, '1/1850');
  assert.equal(entity.tick_registro, 1);
});

test('tick_registro: "6/2000" updates tick_registro correctly', () => {
  const entity = { tick_registro: 1 };
  applyTickRegistro(entity, '6/2000');
  assert.equal(entity.tick_registro, dateToTick(6, 2000));
});

test('tick_registro: raw tick string "100" sets tick_registro to 100', () => {
  const entity = { tick_registro: 1 };
  applyTickRegistro(entity, '100');
  assert.equal(entity.tick_registro, 100);
});

test('tick_registro: invalid input does NOT change the existing value', () => {
  const entity = { tick_registro: 42 };
  applyTickRegistro(entity, 'garbage');
  assert.equal(entity.tick_registro, 42, 'invalid input must leave tick_registro unchanged');
});

test('tick_registro: "0" does NOT change the existing value', () => {
  const entity = { tick_registro: 5 };
  applyTickRegistro(entity, '0');
  assert.equal(entity.tick_registro, 5);
});

test('tick_registro: month 13 is invalid and does not change value', () => {
  const entity = { tick_registro: 7 };
  applyTickRegistro(entity, '13/1900');
  assert.equal(entity.tick_registro, 7);
});

test('tick_registro: year before epoch is invalid and does not change value', () => {
  const entity = { tick_registro: 7 };
  applyTickRegistro(entity, '1/1800');
  assert.equal(entity.tick_registro, 7);
});
