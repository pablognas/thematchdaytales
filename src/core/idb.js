/**
 * idb.js — IndexedDB persistence wrapper for the SQLite database bytes.
 *
 * The SQLite database is stored as a single Uint8Array blob under a fixed key
 * in an IndexedDB object store. All exported functions return Promises.
 *
 * Usage:
 *   import { loadDbBytesFromIdb, saveDbBytesToIdb, clearDbFromIdb } from './idb.js';
 *
 *   const bytes = await loadDbBytesFromIdb(); // null if not stored yet
 *   await saveDbBytesToIdb(uint8Array);
 *   await clearDbFromIdb();
 */

const IDB_NAME    = 'matchday-tales-db';
const IDB_VERSION = 1;
const IDB_STORE   = 'sqlite';
const IDB_KEY     = 'main';

/**
 * Open the IndexedDB database, creating the object store if needed.
 * @returns {Promise<IDBDatabase>}
 */
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

/**
 * Load the SQLite DB bytes from IndexedDB.
 * Returns null if no data has been persisted yet.
 * @returns {Promise<Uint8Array|null>}
 */
export async function loadDbBytesFromIdb() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const get = tx.objectStore(IDB_STORE).get(IDB_KEY);
    get.onsuccess = () => { db.close(); resolve(get.result ?? null); };
    get.onerror   = () => { db.close(); reject(get.error); };
  });
}

/**
 * Save the SQLite DB bytes to IndexedDB.
 * @param {Uint8Array} bytes
 * @returns {Promise<void>}
 */
export async function saveDbBytesToIdb(bytes) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readwrite');
    const put = tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    put.onsuccess = () => { db.close(); resolve(); };
    put.onerror   = () => { db.close(); reject(put.error); };
  });
}

/**
 * Remove the stored DB bytes from IndexedDB.
 * Useful for "Reset DB" scenarios.
 * @returns {Promise<void>}
 */
export async function clearDbFromIdb() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readwrite');
    const del = tx.objectStore(IDB_STORE).delete(IDB_KEY);
    del.onsuccess = () => { db.close(); resolve(); };
    del.onerror   = () => { db.close(); reject(del.error); };
  });
}
