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
  VIEWPORT_COLS_MIN,
  VIEWPORT_COLS_MAX,
  VIEWPORT_COLS_DEFAULT,
  VIEWPORT_COLS_STEP,
  VIEWPORT_ROWS_MIN,
  VIEWPORT_ROWS_MAX,
  VIEWPORT_ROWS_DEFAULT,
  VIEWPORT_ROWS_STEP,
  MAPA_VP_COLS_KEY,
  MAPA_VP_ROWS_KEY,
  clampViewportCols,
  clampViewportRows,
  saveViewportCols,
  saveViewportRows,
  loadViewportCols,
  loadViewportRows,
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

// ── Viewport dimension constants ──────────────────────────────────────────────

test('VIEWPORT_COLS_MIN is a positive number', () => {
  assert.ok(typeof VIEWPORT_COLS_MIN === 'number');
  assert.ok(VIEWPORT_COLS_MIN > 0);
});

test('VIEWPORT_COLS_MAX is greater than VIEWPORT_COLS_MIN', () => {
  assert.ok(VIEWPORT_COLS_MAX > VIEWPORT_COLS_MIN);
});

test('VIEWPORT_COLS_DEFAULT is within [COLS_MIN, COLS_MAX] range', () => {
  assert.ok(VIEWPORT_COLS_DEFAULT >= VIEWPORT_COLS_MIN);
  assert.ok(VIEWPORT_COLS_DEFAULT <= VIEWPORT_COLS_MAX);
});

test('VIEWPORT_COLS_STEP is a positive number', () => {
  assert.ok(typeof VIEWPORT_COLS_STEP === 'number');
  assert.ok(VIEWPORT_COLS_STEP > 0);
});

test('VIEWPORT_ROWS_MIN is a positive number', () => {
  assert.ok(typeof VIEWPORT_ROWS_MIN === 'number');
  assert.ok(VIEWPORT_ROWS_MIN > 0);
});

test('VIEWPORT_ROWS_MAX is greater than VIEWPORT_ROWS_MIN', () => {
  assert.ok(VIEWPORT_ROWS_MAX > VIEWPORT_ROWS_MIN);
});

test('VIEWPORT_ROWS_DEFAULT is within [ROWS_MIN, ROWS_MAX] range', () => {
  assert.ok(VIEWPORT_ROWS_DEFAULT >= VIEWPORT_ROWS_MIN);
  assert.ok(VIEWPORT_ROWS_DEFAULT <= VIEWPORT_ROWS_MAX);
});

test('VIEWPORT_ROWS_STEP is a positive number', () => {
  assert.ok(typeof VIEWPORT_ROWS_STEP === 'number');
  assert.ok(VIEWPORT_ROWS_STEP > 0);
});

// ── clampViewportCols ─────────────────────────────────────────────────────────

test('clampViewportCols returns value unchanged when within range', () => {
  assert.equal(clampViewportCols(VIEWPORT_COLS_DEFAULT), VIEWPORT_COLS_DEFAULT);
});

test('clampViewportCols clamps to minimum when value is too small', () => {
  assert.equal(clampViewportCols(0),                        VIEWPORT_COLS_MIN);
  assert.equal(clampViewportCols(-100),                     VIEWPORT_COLS_MIN);
  assert.equal(clampViewportCols(VIEWPORT_COLS_MIN - 1),    VIEWPORT_COLS_MIN);
});

test('clampViewportCols clamps to maximum when value is too large', () => {
  assert.equal(clampViewportCols(VIEWPORT_COLS_MAX + 1),    VIEWPORT_COLS_MAX);
  assert.equal(clampViewportCols(9999),                     VIEWPORT_COLS_MAX);
});

test('clampViewportCols rounds non-integer inputs', () => {
  assert.equal(clampViewportCols(60.7), 61);
  assert.equal(clampViewportCols(60.2), 60);
});

test('cells-more increments cols by VIEWPORT_COLS_STEP and respects max', () => {
  const atMax   = clampViewportCols(VIEWPORT_COLS_MAX + VIEWPORT_COLS_STEP);
  assert.equal(atMax, VIEWPORT_COLS_MAX);

  const midZoom = clampViewportCols(VIEWPORT_COLS_DEFAULT + VIEWPORT_COLS_STEP);
  assert.equal(midZoom, VIEWPORT_COLS_DEFAULT + VIEWPORT_COLS_STEP);
});

test('cells-less decrements cols by VIEWPORT_COLS_STEP and respects min', () => {
  const atMin   = clampViewportCols(VIEWPORT_COLS_MIN - VIEWPORT_COLS_STEP);
  assert.equal(atMin, VIEWPORT_COLS_MIN);

  const midZoom = clampViewportCols(VIEWPORT_COLS_DEFAULT - VIEWPORT_COLS_STEP);
  assert.equal(midZoom, VIEWPORT_COLS_DEFAULT - VIEWPORT_COLS_STEP);
});

// ── clampViewportRows ─────────────────────────────────────────────────────────

test('clampViewportRows returns value unchanged when within range', () => {
  assert.equal(clampViewportRows(VIEWPORT_ROWS_DEFAULT), VIEWPORT_ROWS_DEFAULT);
});

test('clampViewportRows clamps to minimum when value is too small', () => {
  assert.equal(clampViewportRows(0),                        VIEWPORT_ROWS_MIN);
  assert.equal(clampViewportRows(-100),                     VIEWPORT_ROWS_MIN);
  assert.equal(clampViewportRows(VIEWPORT_ROWS_MIN - 1),    VIEWPORT_ROWS_MIN);
});

test('clampViewportRows clamps to maximum when value is too large', () => {
  assert.equal(clampViewportRows(VIEWPORT_ROWS_MAX + 1),    VIEWPORT_ROWS_MAX);
  assert.equal(clampViewportRows(9999),                     VIEWPORT_ROWS_MAX);
});

test('clampViewportRows rounds non-integer inputs', () => {
  assert.equal(clampViewportRows(30.7), 31);
  assert.equal(clampViewportRows(30.2), 30);
});

test('cells-more increments rows by VIEWPORT_ROWS_STEP and respects max', () => {
  const atMax   = clampViewportRows(VIEWPORT_ROWS_MAX + VIEWPORT_ROWS_STEP);
  assert.equal(atMax, VIEWPORT_ROWS_MAX);

  const midZoom = clampViewportRows(VIEWPORT_ROWS_DEFAULT + VIEWPORT_ROWS_STEP);
  assert.equal(midZoom, VIEWPORT_ROWS_DEFAULT + VIEWPORT_ROWS_STEP);
});

test('cells-less decrements rows by VIEWPORT_ROWS_STEP and respects min', () => {
  const atMin   = clampViewportRows(VIEWPORT_ROWS_MIN - VIEWPORT_ROWS_STEP);
  assert.equal(atMin, VIEWPORT_ROWS_MIN);

  const midZoom = clampViewportRows(VIEWPORT_ROWS_DEFAULT - VIEWPORT_ROWS_STEP);
  assert.equal(midZoom, VIEWPORT_ROWS_DEFAULT - VIEWPORT_ROWS_STEP);
});

// ── saveViewportCols / loadViewportCols (no localStorage in Node) ─────────────

test('loadViewportCols returns VIEWPORT_COLS_DEFAULT when localStorage is unavailable', () => {
  assert.equal(loadViewportCols(), VIEWPORT_COLS_DEFAULT);
});

test('saveViewportCols does not throw when localStorage is unavailable', () => {
  assert.doesNotThrow(() => saveViewportCols(VIEWPORT_COLS_DEFAULT));
});

// ── saveViewportRows / loadViewportRows (no localStorage in Node) ─────────────

test('loadViewportRows returns VIEWPORT_ROWS_DEFAULT when localStorage is unavailable', () => {
  assert.equal(loadViewportRows(), VIEWPORT_ROWS_DEFAULT);
});

test('saveViewportRows does not throw when localStorage is unavailable', () => {
  assert.doesNotThrow(() => saveViewportRows(VIEWPORT_ROWS_DEFAULT));
});

// ── localStorage keys ─────────────────────────────────────────────────────────

test('MAPA_VP_COLS_KEY is a non-empty string', () => {
  assert.ok(typeof MAPA_VP_COLS_KEY === 'string');
  assert.ok(MAPA_VP_COLS_KEY.length > 0);
});

test('MAPA_VP_ROWS_KEY is a non-empty string', () => {
  assert.ok(typeof MAPA_VP_ROWS_KEY === 'string');
  assert.ok(MAPA_VP_ROWS_KEY.length > 0);
});
