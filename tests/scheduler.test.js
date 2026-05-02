/**
 * scheduler.test.js — Unit tests for src/core/scheduler.js
 *
 * Covers:
 *   - getCurrentTick / setCurrentTick / advanceTick
 *   - goToTick (navigate to any tick, past or future)
 *   - Event-registration dates stay correct after tick navigation
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// scheduler.js uses localStorage; supply a minimal in-memory mock.
const store = {};
global.localStorage = {
  getItem:    key         => store[key] ?? null,
  setItem:    (key, val)  => { store[key] = String(val); },
  removeItem: key         => { delete store[key]; },
};

// Clear localStorage between each test so they are independent.
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

import {
  getCurrentTick,
  setCurrentTick,
  advanceTick,
  goToTick,
} from '../src/core/scheduler.js';

// ── Basic tick counter ────────────────────────────────────────────────────────

test('getCurrentTick returns 1 when nothing is stored', () => {
  assert.equal(getCurrentTick(), 1);
});

test('setCurrentTick persists the value', () => {
  setCurrentTick(42);
  assert.equal(getCurrentTick(), 42);
});

test('setCurrentTick clamps values below 1 to 1', () => {
  setCurrentTick(0);
  assert.equal(getCurrentTick(), 1);
  setCurrentTick(-5);
  assert.equal(getCurrentTick(), 1);
});

test('advanceTick increments by 1 and returns the new tick', () => {
  setCurrentTick(10);
  const next = advanceTick();
  assert.equal(next, 11);
  assert.equal(getCurrentTick(), 11);
});

// ── goToTick — navigate to any tick ─────────────────────────────────────────

test('goToTick moves forward to a future tick', () => {
  setCurrentTick(1);
  const result = goToTick(100);
  assert.equal(result, 100);
  assert.equal(getCurrentTick(), 100);
});

test('goToTick moves backward to a past tick', () => {
  setCurrentTick(50);
  const result = goToTick(5);
  assert.equal(result, 5);
  assert.equal(getCurrentTick(), 5);
});

test('goToTick to the same tick is a no-op', () => {
  setCurrentTick(25);
  const result = goToTick(25);
  assert.equal(result, 25);
  assert.equal(getCurrentTick(), 25);
});

test('goToTick clamps values below 1 to 1', () => {
  setCurrentTick(10);
  const result = goToTick(0);
  assert.equal(result, 1);
  assert.equal(getCurrentTick(), 1);
});

test('goToTick truncates non-integer ticks', () => {
  const result = goToTick(7.9);
  assert.equal(result, 7);
  assert.equal(getCurrentTick(), 7);
});

// ── Event registration dates correct after navigation ────────────────────────

test('event registration uses current tick after navigating backward', () => {
  // Simulate: world started at tick 50, user navigates back to tick 5
  setCurrentTick(50);
  goToTick(5);
  // When registering a new entity the app reads getCurrentTick()
  const registrationTick = getCurrentTick();
  assert.equal(registrationTick, 5, 'registration tick should match the navigated-to tick');
});

test('event registration uses current tick after navigating forward', () => {
  // Simulate: user navigates to a future tick (e.g. tick 200 = some future month/year)
  setCurrentTick(1);
  goToTick(200);
  const registrationTick = getCurrentTick();
  assert.equal(registrationTick, 200, 'registration tick should match the future navigated-to tick');
});

test('archiving an entity uses current tick after navigation', () => {
  // Simulate navigating to tick 15 and then archiving (setting tick_saida)
  goToTick(15);
  const entity = { id: 'e1', tick_saida: 0 };
  entity.tick_saida = getCurrentTick();
  assert.equal(entity.tick_saida, 15);
});

test('multiple navigations preserve the last-set tick', () => {
  goToTick(10);
  goToTick(200);
  goToTick(3);
  assert.equal(getCurrentTick(), 3);
});
