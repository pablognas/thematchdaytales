/**
 * mapa-vp.test.js — Tests for the map viewport zoom helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_SIZE_MIN,
  CELL_SIZE_MAX,
  CELL_SIZE_DEFAULT,
  CELL_SIZE_STEP,
  MAPA_VP_STORAGE_KEY,
  clampCellSize,
  saveCellSize,
  loadCellSize,
} from '../src/core/mapa-vp.js';

// ── Constants ─────────────────────────────────────────────────────────────────

test('CELL_SIZE_MIN is a positive number', () => {
  assert.ok(typeof CELL_SIZE_MIN === 'number');
  assert.ok(CELL_SIZE_MIN > 0);
});

test('CELL_SIZE_MAX is greater than CELL_SIZE_MIN', () => {
  assert.ok(CELL_SIZE_MAX > CELL_SIZE_MIN);
});

test('CELL_SIZE_DEFAULT is within [MIN, MAX] range', () => {
  assert.ok(CELL_SIZE_DEFAULT >= CELL_SIZE_MIN);
  assert.ok(CELL_SIZE_DEFAULT <= CELL_SIZE_MAX);
});

test('CELL_SIZE_STEP is a positive number', () => {
  assert.ok(typeof CELL_SIZE_STEP === 'number');
  assert.ok(CELL_SIZE_STEP > 0);
});

// ── clampCellSize ─────────────────────────────────────────────────────────────

test('clampCellSize returns value unchanged when within range', () => {
  assert.equal(clampCellSize(CELL_SIZE_DEFAULT), CELL_SIZE_DEFAULT);
});

test('clampCellSize clamps to minimum when value is too small', () => {
  assert.equal(clampCellSize(0),                CELL_SIZE_MIN);
  assert.equal(clampCellSize(-100),             CELL_SIZE_MIN);
  assert.equal(clampCellSize(CELL_SIZE_MIN - 1), CELL_SIZE_MIN);
});

test('clampCellSize clamps to maximum when value is too large', () => {
  assert.equal(clampCellSize(CELL_SIZE_MAX + 1), CELL_SIZE_MAX);
  assert.equal(clampCellSize(9999),              CELL_SIZE_MAX);
});

test('clampCellSize rounds non-integer inputs', () => {
  assert.equal(clampCellSize(12.7), 13);
  assert.equal(clampCellSize(12.2), 12);
});

test('zoom in increments by CELL_SIZE_STEP and respects max', () => {
  // Simulate zoom-in logic: cellSize + CELL_SIZE_STEP, clamped
  const atMax   = clampCellSize(CELL_SIZE_MAX + CELL_SIZE_STEP);
  assert.equal(atMax, CELL_SIZE_MAX);

  const midZoom = clampCellSize(CELL_SIZE_DEFAULT + CELL_SIZE_STEP);
  assert.equal(midZoom, CELL_SIZE_DEFAULT + CELL_SIZE_STEP);
});

test('zoom out decrements by CELL_SIZE_STEP and respects min', () => {
  // Simulate zoom-out logic: cellSize - CELL_SIZE_STEP, clamped
  const atMin   = clampCellSize(CELL_SIZE_MIN - CELL_SIZE_STEP);
  assert.equal(atMin, CELL_SIZE_MIN);

  const midZoom = clampCellSize(CELL_SIZE_DEFAULT - CELL_SIZE_STEP);
  assert.equal(midZoom, CELL_SIZE_DEFAULT - CELL_SIZE_STEP);
});

// ── saveCellSize / loadCellSize (no localStorage in Node) ────────────────────

test('loadCellSize returns CELL_SIZE_DEFAULT when localStorage is unavailable', () => {
  // In Node.js, localStorage is undefined → graceful fallback to default
  assert.equal(loadCellSize(), CELL_SIZE_DEFAULT);
});

test('saveCellSize does not throw when localStorage is unavailable', () => {
  assert.doesNotThrow(() => saveCellSize(CELL_SIZE_DEFAULT));
});

test('MAPA_VP_STORAGE_KEY is a non-empty string', () => {
  assert.ok(typeof MAPA_VP_STORAGE_KEY === 'string');
  assert.ok(MAPA_VP_STORAGE_KEY.length > 0);
});
