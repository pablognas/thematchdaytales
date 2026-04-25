/**
 * idb.test.js — Unit tests for the IndexedDB persistence wrapper (src/core/idb.js).
 *
 * Uses fake-indexeddb to mock the browser IndexedDB API in Node.js.
 */

// Set up fake IndexedDB before importing the module under test.
// fake-indexeddb/auto sets globalThis.indexedDB (and other IDB globals).
import 'fake-indexeddb/auto';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadDbBytesFromIdb,
  saveDbBytesToIdb,
  clearDbFromIdb,
} from '../src/core/idb.js';

describe('IndexedDB persistence wrapper', () => {
  // Use a fresh IndexedDB database for each test by resetting the state.
  beforeEach(async () => {
    // Clear any previously stored data between tests.
    await clearDbFromIdb();
  });

  test('loadDbBytesFromIdb returns null when no data is stored', async () => {
    const result = await loadDbBytesFromIdb();
    assert.equal(result, null);
  });

  test('saveDbBytesToIdb persists data; loadDbBytesFromIdb restores it', async () => {
    const original = new Uint8Array([83, 81, 76, 105, 116, 101]); // "SQLite"
    await saveDbBytesToIdb(original);
    const loaded = await loadDbBytesFromIdb();
    assert.ok(loaded instanceof Uint8Array, 'loaded value should be a Uint8Array');
    assert.deepEqual(loaded, original);
  });

  test('saveDbBytesToIdb overwrites previously stored data', async () => {
    const first  = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5, 6, 7]);
    await saveDbBytesToIdb(first);
    await saveDbBytesToIdb(second);
    const loaded = await loadDbBytesFromIdb();
    assert.deepEqual(loaded, second);
  });

  test('clearDbFromIdb removes stored data', async () => {
    const data = new Uint8Array([9, 8, 7]);
    await saveDbBytesToIdb(data);
    await clearDbFromIdb();
    const loaded = await loadDbBytesFromIdb();
    assert.equal(loaded, null);
  });
});
