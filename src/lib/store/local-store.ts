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
/** Tabs announce their writes here so the others can catch up. */
const CHANNEL_NAME = "flashycardy.doc";

export type StoreStatus = "idle" | "loading" | "ready" | "error";

let doc: DbDoc = emptyDoc("server");
let status: StoreStatus = "idle";
let lastError: string | null = null;
let notice: string | null = null;
let initPromise: Promise<void> | null = null;

/**
 * The `mutatedAt` of the document version this tab last read or wrote.
 *
 * Every write is conditional on it. Each tab holds its own copy of the document
 * in memory, so a tab left open on an old version used to overwrite whatever
 * newer version another tab had written — the whole database, silently, with no
 * way back. Writing only when the stored stamp still matches makes that
 * impossible.
 *
 * Null before the first load, and when the database holds no document yet.
 */
let baseStamp: string | null = null;
let channel: BroadcastChannel | null = null;

/**
 * All IndexedDB work runs through one chain.
 *
 * Without it, two writes started in the same tick would both compare against the
 * pre-write stamp, and the second would see the first's write as a foreign tab's
 * and needlessly throw away the newer document.
 */
let queueTail: Promise<unknown> = Promise.resolve();

function queue<T>(work: () => Promise<T>): Promise<T> {
  const next = queueTail.then(work, work);
  queueTail = next.catch(() => undefined);
  return next;
}

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

/**
 * A message for the user about something the store did on its own — currently
 * only stepping aside for a newer document from another tab. Kept apart from
 * `lastError`, which is for genuine IndexedDB failures.
 */
export function getNotice(): string | null {
  return notice;
}

export function dismissNotice(): void {
  if (notice === null) return;
  notice = null;
  emit();
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

type PutResult =
  | { ok: true }
  | { ok: false; stored: SerializedDbDoc | null };

/**
 * Write the document, but only if the stored one still carries `expected`.
 *
 * The read and the write share a transaction, so no other tab can slip a write
 * in between them. `force` skips the check, for the cases that mean to replace
 * whatever is there — restoring a backup, or accepting a pull from GitHub.
 */
function idbCompareAndPut(
  database: IDBDatabase,
  value: SerializedDbDoc,
  expected: string | null,
  force: boolean,
): Promise<PutResult> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(DOC_KEY);
    let conflict: SerializedDbDoc | null | undefined;

    request.onsuccess = () => {
      const stored = request.result as SerializedDbDoc | undefined;
      const storedStamp = stored ? stored.mutatedAt : null;
      if (!force && storedStamp !== expected) {
        // Leave the transaction alone — not writing is the whole point.
        conflict = stored ?? null;
        return;
      }
      store.put(value, DOC_KEY);
    };

    tx.oncomplete = () =>
      resolve(conflict === undefined ? { ok: true } : { ok: false, stored: conflict });
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Take on a document another tab wrote.
 *
 * Deliberately does not notify change listeners: this tab changed nothing, and
 * saying otherwise would have the sync engine push back a document GitHub
 * already has.
 */
function adopt(stored: SerializedDbDoc | null): void {
  doc = stored ? deserializeDoc(stored) : emptyDoc(getDeviceId());
  baseStamp = stored ? stored.mutatedAt : null;
  status = "ready";
  emit();
}

async function persistNow(force: boolean): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await openDb();
    const serialized = serializeDoc(doc);
    const result = await idbCompareAndPut(database, serialized, baseStamp, force);
    database.close();

    if (result.ok) {
      baseStamp = serialized.mutatedAt;
      channel?.postMessage(serialized.mutatedAt);
      return;
    }

    // Another tab wrote since this one last read. Its document wins: losing the
    // change just made here costs one edit, while overwriting costs everything
    // the other tab knows about.
    adopt(result.stored);
    notice =
      "Another tab had newer decks, so this one caught up. Your last change here wasn't saved — make it again.";
    console.warn(`[cue] ${notice}`);
    emit();
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
}

/** Re-read the document if another tab has written a newer one. */
async function refreshFromDisk(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await openDb();
    const stored = await idbGet(database);
    database.close();
    if ((stored ? stored.mutatedAt : null) !== baseStamp) adopt(stored ?? null);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
}

function watchOtherTabs(): void {
  if (typeof window === "undefined" || channel !== null) return;

  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<string>) => {
      if (event.data !== baseStamp) void queue(refreshFromDisk);
    };
  }

  // A tab that was frozen or restored from the back/forward cache can miss
  // messages entirely, so re-check whenever it comes back to the foreground.
  // This is also the whole safety net where BroadcastChannel is unavailable.
  window.addEventListener("visibilitychange", () => {
    if (window.document.visibilityState === "visible") void queue(refreshFromDisk);
  });
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
      baseStamp = stored ? stored.mutatedAt : null;
      status = "ready";
      lastError = null;
      watchOtherTabs();
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
  void queue(() => persistNow(false));
  for (const listener of changeListeners) listener(doc);
  return result;
}

/**
 * Replace the whole document — used by sync when pulling from GitHub and by
 * "restore from backup". Does not notify change listeners, so accepting a
 * remote document doesn't immediately schedule a push back.
 *
 * Writes unconditionally: both callers are deliberately replacing whatever is
 * stored, so a newer document from another tab is what they mean to supersede.
 * The write is still announced, so the other tabs follow rather than sit on the
 * version this one just replaced.
 */
export async function replaceDoc(next: DbDoc): Promise<void> {
  doc = next;
  status = "ready";
  emit();
  await queue(() => persistNow(true));
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

export function allocateNoteId(draft: DbDoc): number {
  // Documents written before notes existed have neither the counter nor the
  // list, and are read with both defaulted rather than migrated.
  const id = draft.nextNoteId ?? 1;
  draft.nextNoteId = id + 1;
  return id;
}
