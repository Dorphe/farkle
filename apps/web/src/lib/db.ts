import type { GameRecord } from "@farkle/engine";

const DB_NAME = "farkle";
const DB_VERSION = 1;
const GAMES = "games";
const SETTINGS = "settings";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GAMES)) {
        const store = db.createObjectStore(GAMES, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(SETTINGS)) {
        db.createObjectStore(SETTINGS, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Storage error"));
      }),
  );
}

export async function saveRecord(record: GameRecord): Promise<void> {
  await tx(GAMES, "readwrite", (store) => store.put(record));
}

export async function loadRecord(id: string): Promise<GameRecord | null> {
  const record = await tx<GameRecord | undefined>(GAMES, "readonly", (store) => store.get(id));
  return record ?? null;
}

export async function loadActiveRecord(): Promise<GameRecord | null> {
  const records = await tx<GameRecord[]>(GAMES, "readonly", (store) => store.getAll());
  const active = records
    .filter((record) => record.status === "active")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return active[0] ?? null;
}

export async function listRecords(limit = 100): Promise<GameRecord[]> {
  const records = await tx<GameRecord[]>(GAMES, "readonly", (store) => store.getAll());
  return records.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await tx<{ key: string; value: T } | undefined>(SETTINGS, "readonly", (store) => store.get(key));
    return row ? row.value : fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  try {
    await tx(SETTINGS, "readwrite", (store) => store.put({ key, value }));
  } catch {
    /* storage may be unavailable — keep playing in memory */
  }
}
