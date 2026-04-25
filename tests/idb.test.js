/**
 * idb.test.js — Unit tests for the IndexedDB wrapper (src/core/idb.js).
 *
 * Uses fake-indexeddb to mock the browser IndexedDB API in Node.js.
 */

// Set up fake IndexedDB globals BEFORE importing idb.js
// fake-indexeddb/auto sets globalThis.indexedDB and related IDB globals.
import 'fake-indexeddb/auto';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadDbFromIndexedDb,
  saveDbToIndexedDb,
  clearDbFromIndexedDb,
} from '../src/core/idb.js';

// Reset the shared IDB state between tests by deleting the named database.
function resetIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('matchday-tales-db');
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

beforeEach(async () => {
  await resetIdb();
});

test('loadDbFromIndexedDb returns null when nothing stored', async () => {
  const result = await loadDbFromIndexedDb();
  assert.strictEqual(result, null);
});

test('saveDbToIndexedDb persists bytes', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  await saveDbToIndexedDb(bytes);

  const loaded = await loadDbFromIndexedDb();
  assert.ok(loaded instanceof Uint8Array);
  assert.deepStrictEqual(Array.from(loaded), [1, 2, 3, 4, 5]);
});

test('saveDbToIndexedDb overwrites previous data', async () => {
  await saveDbToIndexedDb(new Uint8Array([10, 20]));
  await saveDbToIndexedDb(new Uint8Array([30, 40, 50]));

  const loaded = await loadDbFromIndexedDb();
  assert.deepStrictEqual(Array.from(loaded), [30, 40, 50]);
});

test('clearDbFromIndexedDb removes stored data', async () => {
  await saveDbToIndexedDb(new Uint8Array([1, 2, 3]));
  await clearDbFromIndexedDb();

  const result = await loadDbFromIndexedDb();
  assert.strictEqual(result, null);
});

test('clearDbFromIndexedDb is idempotent when nothing stored', async () => {
  await clearDbFromIndexedDb();  // should not throw
  const result = await loadDbFromIndexedDb();
  assert.strictEqual(result, null);
});

test('round-trip: save and load larger payload', async () => {
  const size  = 4096;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 256;

  await saveDbToIndexedDb(bytes);
  const loaded = await loadDbFromIndexedDb();

  assert.strictEqual(loaded.length, size);
  assert.deepStrictEqual(Array.from(loaded), Array.from(bytes));
});
