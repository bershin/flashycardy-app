/**
 * The app's database: one JSON document held in memory, persisted to IndexedDB,
 * and pushed to a private GitHub repo by `github-sync.ts`.
 *
 * IndexedDB is the durable local copy rather than localStorage because cards can
 * embed base64 images and localStorage caps out around 5 MB.
 *
 * Everything here must be import-safe on the server: `next build` prerenders the
 * pages in Node, where `indexedDB` and `window` don't exist. Browser-only work is
 * therefore deferred until `init()` is called from a client effect.
 */

import {
  deserializeDoc,
  emptyDoc,
  serializeDoc,
  type DbDoc,
  type SerializedDbDoc,
} from "./types";

const DB_NAME = "flashycardy";
const DB_VERSION = 1;
const STORE_NAME = "doc";
const DOC_KEY = "current";
const DEVICE_ID_KEY = "flashycardy.deviceId";

export type StoreStatus = "idle" | "loading" | "ready" | "error";

let doc: DbDoc = emptyDoc("server");
let status: StoreStatus = "idle";
let lastError: string | null = null;
let initPromise: Promise<void> | null = null;

const listeners = new Set<() => void>();
const changeListeners = new Set<(doc: DbDoc) => void>();

/**
 * Snapshot identity is what drives `useSyncExternalStore`. Every mutation
 * replaces `doc` wholesale, so reference equality is a correct change signal.
 */
export function getSnapshot(): DbDoc {
  return doc;
}

/** Prerender sees an empty database; the real one arrives after hydration. */
const serverDoc = emptyDoc("server");
export function getServerSnapshot(): DbDoc {
  return serverDoc;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Notified after every local mutation — used to schedule a sync push. */
export function onChange(listener: (doc: DbDoc) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function getStatus(): StoreStatus {
  return status;
}

export function getLastError(): string | null {
  return lastError;
}

function emit() {
  for (const listener of listeners) listener();
}

export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(database: IDBDatabase): Promise<SerializedDbDoc | undefined> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(DOC_KEY);
    request.onsuccess = () => resolve(request.result as SerializedDbDoc | undefined);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(database: IDBDatabase, value: SerializedDbDoc): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, DOC_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function persist(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await openDb();
    await idbPut(database, serializeDoc(doc));
    database.close();
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
}

/** Load the document from IndexedDB. Safe to call repeatedly. */
export function init(): Promise<void> {
  if (initPromise) return initPromise;
  if (typeof indexedDB === "undefined") return Promise.resolve();

  status = "loading";
  emit();

  initPromise = (async () => {
    try {
      const database = await openDb();
      const stored = await idbGet(database);
      database.close();
      doc = stored ? deserializeDoc(stored) : emptyDoc(getDeviceId());
      status = "ready";
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      doc = emptyDoc(getDeviceId());
      status = "error";
    }
    emit();
  })();

  return initPromise;
}

/**
 * Apply a change to the document.
 *
 * The recipe receives a shallow-cloned draft whose `decks` and `cards` arrays
 * are fresh, so it may push/splice/reassign them freely. Anything it returns is
 * handed back to the caller, which is how the query helpers recover inserted
 * rows the way Drizzle's `.returning()` used to.
 */
export function mutate<T>(recipe: (draft: DbDoc) => T): T {
  const draft: DbDoc = {
    ...doc,
    decks: [...doc.decks],
    cards: [...doc.cards],
  };
  const result = recipe(draft);
  draft.mutatedAt = new Date();
  draft.deviceId = getDeviceId();
  doc = draft;
  emit();
  void persist();
  for (const listener of changeListeners) listener(doc);
  return result;
}

/**
 * Replace the whole document — used by sync when pulling from GitHub and by
 * "restore from backup". Does not notify change listeners, so accepting a
 * remote document doesn't immediately schedule a push back.
 */
export async function replaceDoc(next: DbDoc): Promise<void> {
  doc = next;
  status = "ready";
  emit();
  await persist();
}

export async function resetDoc(): Promise<void> {
  await replaceDoc(emptyDoc(getDeviceId()));
}

export function allocateDeckId(draft: DbDoc): number {
  const id = draft.nextDeckId;
  draft.nextDeckId += 1;
  return id;
}

export function allocateCardId(draft: DbDoc): number {
  const id = draft.nextCardId;
  draft.nextCardId += 1;
  return id;
}
