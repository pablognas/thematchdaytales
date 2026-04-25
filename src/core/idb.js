/**
 * idb.js — Minimal IndexedDB wrapper for persisting the SQLite DB bytes.
 *
 * The database is stored as a single Uint8Array under the key 'db' in
 * an object store named 'matchday-db', inside an IDB database also
 * named 'matchday-tales-db'.
 */

const IDB_NAME    = 'matchday-tales-db';
const IDB_STORE   = 'matchday-db';
const IDB_VERSION = 1;
const IDB_KEY     = 'db';

/** Open (or create) the IndexedDB database. Returns a Promise<IDBDatabase>. */
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Load the SQLite DB bytes from IndexedDB.
 * @returns {Promise<Uint8Array|null>} null if no data has been stored yet.
 */
export async function loadDbFromIndexedDb() {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx  = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => { idb.close(); resolve(req.result ?? null); };
    req.onerror   = () => { idb.close(); reject(req.error); };
  });
}

/**
 * Save the SQLite DB bytes to IndexedDB.
 * @param {Uint8Array} dbBytes
 */
export async function saveDbToIndexedDb(dbBytes) {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx  = idb.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(dbBytes, IDB_KEY);
    req.onsuccess = () => { idb.close(); resolve(); };
    req.onerror   = () => { idb.close(); reject(req.error); };
  });
}

/**
 * Remove the stored DB bytes from IndexedDB (used when resetting the database).
 */
export async function clearDbFromIndexedDb() {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx  = idb.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).delete(IDB_KEY);
    req.onsuccess = () => { idb.close(); resolve(); };
    req.onerror   = () => { idb.close(); reject(req.error); };
  });
}
