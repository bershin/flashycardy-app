/**
 * Sync the local document to a `data.json` in a private GitHub repository.
 *
 * The repo is the durable source of truth and its git history doubles as
 * versioned backup; IndexedDB is the fast working copy. Writes go through the
 * Contents API with the last-known blob SHA, which gives optimistic concurrency
 * for free — GitHub rejects the write if the file moved underneath us.
 *
 * Reads deliberately use the Git Blobs API rather than the inline `content`
 * field of the Contents response: that field is only populated for files up to
 * 1 MB, and cards embed base64 images, so `data.json` passes that quickly.
 * The blobs route serves up to 100 MB.
 */

import { getSnapshot, onChange, replaceDoc } from "./local-store";
import {
  deserializeDoc,
  serializeDoc,
  type DbDoc,
  type SerializedDbDoc,
} from "./types";
import { baseOf, mergeDocs, type SyncBase } from "./merge";

const CONFIG_KEY = "flashycardy.sync";
/**
 * What this device and GitHub last agreed the document contained — ids and
 * their timestamps, not contents. See `merge.ts`: without it, a record missing
 * from one side cannot be told from a record newly added to the other.
 */
const BASE_KEY = "flashycardy.sync.base";
const SHA_KEY = "flashycardy.sync.sha";
const LAST_SYNCED_KEY = "flashycardy.sync.lastSyncedAt";
/** Web Locks name holding pushes to one tab at a time. */
const SYNC_LOCK = "flashycardy.sync.push";
const PUSH_DEBOUNCE_MS = 3000;

/**
 * How often a visible tab asks GitHub whether anything changed.
 *
 * Without this the app only ever pulled on startup, focus, becoming visible,
 * and coming back online — so a window left open and focused never learned
 * anything at all. Two machines open at once would sit indefinitely on
 * different documents, each showing a green tick, because neither had failed at
 * anything; neither had looked.
 *
 * Only while visible: a hidden tab polling costs requests against the rate
 * limit to learn something it will be told anyway the moment it is looked at.
 */
const POLL_INTERVAL_MS = 60_000;
const API = "https://api.github.com";

export type SyncConfig = {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  token: string;
};

export type SyncState =
  | "disabled"
  | "idle"
  | "pulling"
  | "pushing"
  | "conflict"
  | "offline"
  | "error";

let state: SyncState = "disabled";
let lastError: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
/** Set when a change lands mid-push, so we push again once the current one lands. */
let dirty = false;

const listeners = new Set<() => void>();

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: SyncState, error: string | null = null) {
  state = next;
  lastError = error;
  for (const listener of listeners) listener();
}

export function getSyncState(): SyncState {
  return state;
}

export function getSyncError(): string | null {
  return lastError;
}

/**
 * When GitHub was last asked, as opposed to when data last moved.
 *
 * `getLastSyncedAt` records the last time something actually transferred, which
 * is the wrong number for "is this window current?" — a document that has not
 * changed in a week is perfectly in sync, and its last *sync* was a week ago.
 * Kept in memory rather than localStorage because it describes this tab's
 * knowledge, and another tab's checking says nothing about this one's.
 */
let lastCheckedAt: Date | null = null;

export function getLastCheckedAt(): Date | null {
  return lastCheckedAt;
}

function markChecked() {
  lastCheckedAt = new Date();
  for (const listener of listeners) listener();
}

export function getLastSyncedAt(): Date | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LAST_SYNCED_KEY);
  return raw ? new Date(raw) : null;
}

export function getSyncConfig(): SyncConfig | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    if (!parsed.owner || !parsed.repo || !parsed.token) return null;
    return {
      owner: parsed.owner,
      repo: parsed.repo,
      path: parsed.path || "data.json",
      branch: parsed.branch || "main",
      token: parsed.token,
    };
  } catch {
    return null;
  }
}

export function setSyncConfig(config: SyncConfig | null) {
  if (typeof window === "undefined") return;
  if (config === null) {
    window.localStorage.removeItem(CONFIG_KEY);
    window.localStorage.removeItem(SHA_KEY);
    setState("disabled");
    return;
  }
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  // A different file means the cached SHA no longer refers to anything.
  window.localStorage.removeItem(SHA_KEY);
  setState("idle");
}

function getSha(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SHA_KEY);
}

function setSha(sha: string | null) {
  if (typeof window === "undefined") return;
  if (sha === null) window.localStorage.removeItem(SHA_KEY);
  else window.localStorage.setItem(SHA_KEY, sha);
}

function readBase(): SyncBase | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(BASE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SyncBase;
  } catch {
    // A base we cannot read is a base we do not have: the merge falls back to
    // keeping everything, which is the safe direction.
    return null;
  }
}

function writeBase(doc: DbDoc) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BASE_KEY, JSON.stringify(baseOf(doc)));
  } catch {
    // Out of quota: the next merge keeps more than it strictly should rather
    // than dropping the sync.
  }
}

function markSynced() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_SYNCED_KEY, new Date().toISOString());
}

function headers(config: SyncConfig, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${config.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** UTF-8 safe base64, since card HTML routinely contains non-ASCII. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type ContentsMeta = { sha: string; size: number };

/** Fetch the blob SHA for `path`, or null if the file does not exist yet. */
async function fetchMeta(config: SyncConfig): Promise<ContentsMeta | null> {
  const url = `${API}/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(
    config.path,
  )}?ref=${encodeURIComponent(config.branch)}`;
  // GitHub answers this endpoint with `cache-control: public, max-age=60`, so
  // without opting out a pull can be served from the browser's cache and hand
  // back a SHA up to a minute old — a check that never leaves the machine.
  const response = await fetch(url, {
    headers: headers(config),
    cache: "no-store",
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await describe(response));

  const body = (await response.json()) as { sha: string; size: number };
  return { sha: body.sha, size: body.size };
}

async function fetchBlob(config: SyncConfig, sha: string): Promise<string> {
  const url = `${API}/repos/${config.owner}/${config.repo}/git/blobs/${sha}`;
  const response = await fetch(url, {
    headers: headers(config, "application/vnd.github.raw"),
  });
  if (!response.ok) throw new Error(await describe(response));
  return response.text();
}

async function describe(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as { message?: string };
    detail = body.message ? `: ${body.message}` : "";
  } catch {
    /* non-JSON error body */
  }
  if (response.status === 401)
    return `GitHub rejected the token (401)${detail}`;
  if (response.status === 403) return `Access forbidden (403)${detail}`;
  if (response.status === 404) return `Repo or path not found (404)${detail}`;
  return `GitHub returned ${response.status}${detail}`;
}

/** Verify the configured repo and token work, without changing anything. */
export async function testConnection(
  config: SyncConfig,
): Promise<
  { ok: true; exists: boolean; size: number } | { ok: false; error: string }
> {
  try {
    const meta = await fetchMeta(config);
    return { ok: true, exists: meta !== null, size: meta?.size ?? 0 };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type PullResult =
  | { kind: "no-remote" }
  | { kind: "pulled"; doc: DbDoc }
  | { kind: "unchanged" };

/**
 * Fetch the remote document. Does not apply it — the caller decides, because a
 * pull that would discard newer local edits needs the user's consent.
 */
export async function pull(config: SyncConfig): Promise<PullResult> {
  const meta = await fetchMeta(config);
  if (!meta) return { kind: "no-remote" };
  if (meta.sha === getSha()) return { kind: "unchanged" };

  const text = await fetchBlob(config, meta.sha);
  const parsed = JSON.parse(text) as SerializedDbDoc;
  const remote = deserializeDoc(parsed);
  setSha(meta.sha);
  return { kind: "pulled", doc: remote };
}

/**
 * Whether two serialized documents hold the same decks and cards.
 *
 * `mutatedAt` and `deviceId` are bookkeeping — they move whenever any tab
 * touches the document — so comparing whole files would call two copies of
 * identical data different. The id counters are left out for the same reason:
 * they only ever drift upward, and the next push carries the higher one.
 */
function sameContent(a: SerializedDbDoc, b: SerializedDbDoc): boolean {
  return (
    JSON.stringify(a.decks) === JSON.stringify(b.decks) &&
    JSON.stringify(a.cards) === JSON.stringify(b.cards)
  );
}

/**
 * Run `work` with no other tab pushing at the same time.
 *
 * Two tabs reading the same SHA and then both writing is a genuine race: the
 * first wins and the second is rejected, even when they hold identical data.
 * Holding a lock across the whole read-modify-write closes that window, since
 * the second tab re-reads the SHA only after the first has finished.
 *
 * Best effort — where the Web Locks API is missing the work simply runs, and
 * the conflict handling below still catches the race after the fact.
 */
async function withSyncLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return work();
  return await locks.request(SYNC_LOCK, async () => await work());
}

/**
 * Write the current document. Returns `"conflict"` when the remote file changed
 * since our last read, rather than overwriting it.
 */
export function push(
  config: SyncConfig,
  options: { force?: boolean } = {},
): Promise<"ok" | "conflict"> {
  return withSyncLock(() => pushLocked(config, options));
}

async function pushLocked(
  config: SyncConfig,
  options: { force?: boolean },
): Promise<"ok" | "conflict"> {
  const doc = getSnapshot();
  const serialized = serializeDoc(doc);
  const json = JSON.stringify(serialized, null, 2);

  // Read inside the lock: another tab may have pushed while this one queued.
  let sha = getSha();
  if (options.force) {
    // Re-read so we overwrite whatever is actually there now.
    sha = (await fetchMeta(config))?.sha ?? null;
  }

  const url = `${API}/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(
    config.path,
  )}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...headers(config), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `flashycardy: ${doc.decks.length} decks, ${doc.cards.length} cards`,
      content: toBase64(json),
      branch: config.branch,
      ...(sha ? { sha } : {}),
    }),
  });

  // 409 is the documented conflict; 422 is what you get when the supplied SHA
  // is stale or when a SHA was required but omitted.
  if (response.status === 409 || response.status === 422) {
    // A rejection where the remote already holds exactly this data is
    // bookkeeping, not a disagreement — another writer got there first with the
    // same content. Take its SHA and carry on, rather than asking the user to
    // choose between two identical versions.
    const meta = await fetchMeta(config);
    if (meta) {
      try {
        const remote = JSON.parse(
          await fetchBlob(config, meta.sha),
        ) as SerializedDbDoc;
        if (sameContent(remote, serialized)) {
          setSha(meta.sha);
          writeBase(doc);
          markSynced();
          return "ok";
        }
      } catch {
        // Unreadable or unparseable remote: fall through and let the user decide.
      }
    }
    return "conflict";
  }
  if (!response.ok) throw new Error(await describe(response));

  const body = (await response.json()) as { content: { sha: string } };
  setSha(body.content.sha);
  // GitHub now holds exactly this, so this is what the two have agreed on.
  // Recorded here rather than only on pull, or a record deleted locally and
  // pushed would look, on the next pull, like a record the remote had newly
  // added — and come straight back.
  writeBase(doc);
  markSynced();
  return "ok";
}

/**
 * Fetch what GitHub holds and merge it into this device's document.
 *
 * Returns whether the merge left this device holding something GitHub does not
 * — the caller decides whether to push it. Module level rather than tucked
 * inside `startSync`, because a push that loses a race needs exactly this
 * before trying again.
 */
async function pullAndMerge(config: SyncConfig): Promise<{ owesRemote: boolean }> {
  const result = await pull(config);
  if (result.kind !== "pulled") return { owesRemote: false };

  const { doc, report } = mergeDocs(readBase(), getSnapshot(), result.doc);
  if (report.localChanged) await replaceDoc(doc);
  writeBase(doc);
  markSynced();
  return { owesRemote: report.remoteChanged };
}

/**
 * Push because the user asked, reporting through the same state the background
 * sync uses.
 *
 * Pushing directly would leave the state untouched, so a conflict raised from
 * the Settings button told the user to choose a version "below" while the
 * buttons that offer that choice — which render off the conflict state — never
 * appeared.
 */
export async function syncNow(config: SyncConfig): Promise<"ok" | "conflict"> {
  const result = await push(config);
  if (result === "conflict") {
    setState(
      "conflict",
      "This file changed on GitHub since this device last synced.",
    );
  } else {
    setState("idle");
  }
  return result;
}

/** Fetch the remote document during conflict resolution. */
export async function fetchRemote(config: SyncConfig): Promise<DbDoc | null> {
  const meta = await fetchMeta(config);
  if (!meta) return null;
  const text = await fetchBlob(config, meta.sha);
  const remote = deserializeDoc(JSON.parse(text) as SerializedDbDoc);
  setSha(meta.sha);
  return remote;
}

/** Discard local state in favour of the remote document. */
export async function resolveWithRemote(config: SyncConfig): Promise<void> {
  const remote = await fetchRemote(config);
  if (remote) await replaceDoc(remote);
  setState("idle");
}

/** Keep local state and overwrite the remote document. */
export async function resolveWithLocal(config: SyncConfig): Promise<void> {
  await push(config, { force: true });
  setState("idle");
}

async function runPush() {
  const config = getSyncConfig();
  if (!config) return;
  if (inFlight) {
    dirty = true;
    return;
  }
  // Read through the getter, here and below. `setState` is opaque to control
  // flow analysis, so comparing the module variable directly would let an early
  // `state === "conflict"` guard narrow it for the rest of the function.
  if (getSyncState() === "conflict") return;

  inFlight = true;
  setState("pushing");
  try {
    let result = await push(config);

    if (result === "conflict") {
      // The other machine pushed between this one's last read and this write.
      // That used to stop sync dead and ask the user to pick a version; now it
      // is just a race, and merging is exactly the answer to it. Take what is
      // there, merge, and write once more.
      await pullAndMerge(config);
      result = await push(config);
    }

    if (result === "conflict") {
      // Twice in a row is no longer a race — something about the remote cannot
      // be reconciled — so it goes back to the user, as before.
      setState(
        "conflict",
        "This file changed on GitHub since this device last synced.",
      );
    } else {
      setState("idle");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setState(navigator.onLine ? "error" : "offline", message);
  } finally {
    inFlight = false;
    if (dirty && getSyncState() !== "conflict") {
      dirty = false;
      schedulePush();
    }
  }
}

function schedulePush() {
  if (!getSyncConfig()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void runPush();
  }, PUSH_DEBOUNCE_MS);
}

/** Push immediately if a debounced push is pending. */
export function flushPush() {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
    void runPush();
  }
}

/**
 * Pull on boot, then keep the remote in step with local edits.
 *
 * On boot the remote wins when the local document has never been synced or is
 * older, which is the common case of opening the app on a second device. If
 * local is newer, we leave it alone and let the next push carry it up.
 */
export function startSync(): () => void {
  const config = getSyncConfig();
  if (!config) {
    setState("disabled");
    return () => {};
  }

  setState("idle");

  const doPull = async () => {
    if (getSyncState() === "conflict" || inFlight) return;
    setState("pulling");
    try {
      // Merged rather than compared. The old rule — take the remote only if it
      // was newer than everything here — dropped the older side's work whole
      // and silently, decided by whichever machine's clock ran ahead.
      //
      // Anything this device holds that GitHub does not goes back up: left
      // undone, the two would only ever agree in one direction.
      const { owesRemote } = await pullAndMerge(config);
      if (owesRemote) schedulePush();
      markChecked();
      setState("idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState(navigator.onLine ? "error" : "offline", message);
    }
  };

  void doPull();

  const unsubscribe = onChange(() => schedulePush());

  // Only while visible — see POLL_INTERVAL_MS. A tab that is hidden gets its
  // pull from the visibility handler the moment it is looked at again.
  const poll = setInterval(() => {
    if (document.visibilityState === "visible") void doPull();
  }, POLL_INTERVAL_MS);

  const onFocus = () => void doPull();
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flushPush();
    else void doPull();
  };
  const onOnline = () => void doPull();

  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);

  return () => {
    unsubscribe();
    clearInterval(poll);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
    if (pushTimer) clearTimeout(pushTimer);
  };
}
