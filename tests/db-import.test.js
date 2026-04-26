/**
 * db-import.test.js — Unit tests for the importDbFromBuffer / isSqliteBytes
 * functions added to src/core/db.js.
 */

// Set up fake IndexedDB globals BEFORE importing db.js
import 'fake-indexeddb/auto';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJsNode from 'sql.js';

import {
  setInitSqlJs,
  resetDbSingleton,
  getDb,
  isSqliteBytes,
} from '../src/core/db.js';

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

// ── isSqliteBytes ─────────────────────────────────────────────────────────────

test('isSqliteBytes returns true for a real SQLite database', async () => {
  const db    = await getDb();
  const bytes = db.export();
  assert.ok(isSqliteBytes(bytes), 'valid SQLite bytes should return true');
});

test('isSqliteBytes returns false for random bytes', () => {
  const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
                                0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F]);
  assert.strictEqual(isSqliteBytes(bytes), false);
});

test('isSqliteBytes returns false for empty buffer', () => {
  assert.strictEqual(isSqliteBytes(new Uint8Array(0)), false);
});

test('isSqliteBytes returns false for short buffer (< 16 bytes)', () => {
  assert.strictEqual(isSqliteBytes(new Uint8Array([0x53, 0x51, 0x4C, 0x69])), false);
});

test('isSqliteBytes returns false for non-Uint8Array input', () => {
  assert.strictEqual(isSqliteBytes(null),        false);
  assert.strictEqual(isSqliteBytes(undefined),   false);
  assert.strictEqual(isSqliteBytes('not bytes'), false);
  assert.strictEqual(isSqliteBytes([1, 2, 3]),   false);
});

test('isSqliteBytes returns true for exact magic header bytes', () => {
  // "SQLite format 3\000" — the SQLite file header magic
  const magic = new Uint8Array([
    0x53,0x51,0x4C,0x69,0x74,0x65,0x20,0x66,
    0x6F,0x72,0x6D,0x61,0x74,0x20,0x33,0x00,
    // pad to simulate a minimal buffer beyond the header
    0xFF, 0xFF,
  ]);
  assert.strictEqual(isSqliteBytes(magic), true);
});

// ── importDbFromBuffer — validation ──────────────────────────────────────────

test('importDbFromBuffer exported from db.js exists', async () => {
  const mod = await import('../src/core/db.js');
  assert.ok(typeof mod.importDbFromBuffer === 'function',
    'importDbFromBuffer should be exported');
});
