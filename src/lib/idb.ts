/** Minimal promise wrapper around IndexedDB for caching decoded radar scans. */

const DB_NAME = 'rainrain';
const STORE = 'frames';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbp.catch(() => (dbp = null));
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export const idb = {
  get<T>(key: string): Promise<T | undefined> {
    return tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>).catch(() => undefined);
  },
  set(key: string, value: unknown): Promise<void> {
    return tx('readwrite', (s) => void s.put(value, key)).then(() => undefined).catch(() => undefined);
  },
  keys(): Promise<string[]> {
    return tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
      .then((k) => (k ?? []).map(String))
      .catch(() => []);
  },
  del(key: string): Promise<void> {
    return tx('readwrite', (s) => void s.delete(key)).then(() => undefined).catch(() => undefined);
  }
};
