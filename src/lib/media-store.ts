/**
 * AgriSurvey AI — Local media store (IndexedDB)
 *
 * Keeps original evidence files (field / drone photographs, orthomosaic renders) in the
 * browser so they survive reloads and work offline. localStorage is far too small for
 * photographs; IndexedDB stores Blobs directly. When cloud storage is configured the
 * services also upload the file and keep its download URL on the record.
 */

const DB_NAME = 'agrisurvey-media';
const STORE = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open the local media store.'));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Local media store operation failed.'));
      })
  );
}

export function putMedia(id: string, blob: Blob): Promise<void> {
  return run('readwrite', (s) => s.put(blob, id)).then(() => undefined);
}

export function getMedia(id: string): Promise<Blob | null> {
  return run<Blob | undefined>('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>).then((b) => b ?? null);
}

export function deleteMedia(id: string): Promise<void> {
  objectUrls.get(id)?.then((u) => u && URL.revokeObjectURL(u));
  objectUrls.delete(id);
  return run('readwrite', (s) => s.delete(id)).then(() => undefined);
}

const objectUrls = new Map<string, Promise<string | null>>();

/** Object URL for a stored file (cached for the page lifetime); null when it is not stored here. */
export function getMediaUrl(id: string): Promise<string | null> {
  let p = objectUrls.get(id);
  if (!p) {
    p = getMedia(id)
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null);
    objectUrls.set(id, p);
    // Do not remember a miss: the file may be stored later
    p.then((u) => u === null && objectUrls.delete(id));
  }
  return p;
}
