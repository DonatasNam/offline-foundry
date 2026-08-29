/**
 * IndexedDB wrapper. One store, "characters", keyed by the Foundry uuid so
 * a re-scan updates in place. Records: { uuid, payload, state, sourceUrl, savedAt }.
 * payload is the read-only JSON Grab snapshot; state holds local tracking
 * (current hp, slot values, item uses) edited during play.
 */
const DB_NAME = "offline-foundry";
const STORE = "characters";
let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "uuid" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const request = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(request?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const getAll = () => tx("readonly", s => s.getAll());
export const get = uuid => tx("readonly", s => s.get(uuid));
export const put = record => tx("readwrite", s => s.put(record));
export const remove = uuid => tx("readwrite", s => s.delete(uuid));
