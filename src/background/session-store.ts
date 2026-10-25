import type { Session } from "../shared/haomai/protocol";

// Extension-origin IndexedDB survives updates/restarts without exposing tokens
// through chrome.storage.local, which existing content scripts can read.
const database = "haomai-private-auth";
const store = "session";
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error("登录存储失败"));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export function loadStoredSession(): Promise<Session | null | undefined> {
  return transaction("readonly", (store) => store.get("current"));
}
export async function storeSession(session?: Session): Promise<void> {
  // A logout tombstone prevents a stale session-storage cache from being
  // re-imported if the worker exits between the durable and cache writes.
  await transaction("readwrite", (store) =>
    store.put(session || null, "current"),
  );
}
