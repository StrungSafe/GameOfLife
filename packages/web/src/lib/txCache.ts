import type { TxCache } from '@gol/core';

/** Raw transactions never change, so they are kept in IndexedDB to make replays fast. */
const DB_NAME = 'gol-tx-cache';
const STORE = 'transactions';

let dbPromise: Promise<IDBDatabase | null> | undefined;

const open = (): Promise<IDBDatabase | null> => {
  dbPromise ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
};

const memory = new Map<string, string>();

export const txCache: TxCache = {
  async get(txid) {
    const cached = memory.get(txid);
    if (cached) return cached;
    const db = await open();
    if (!db) return undefined;
    return new Promise((resolve) => {
      const request = db.transaction(STORE).objectStore(STORE).get(txid);
      request.onsuccess = () => {
        if (request.result) memory.set(txid, request.result);
        resolve(request.result ?? undefined);
      };
      request.onerror = () => resolve(undefined);
    });
  },
  async set(txid, hex) {
    memory.set(txid, hex);
    const db = await open();
    if (!db) return;
    try {
      db.transaction(STORE, 'readwrite').objectStore(STORE).put(hex, txid);
    } catch {
      // Best effort only.
    }
  },
};
