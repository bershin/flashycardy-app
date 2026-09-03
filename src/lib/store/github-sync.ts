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
import { scopedKey, scopedKeyFor } from "./profiles";
import { referencedImages } from "../card-images";
import {
  clearPendingBlobs,
  fetchRemoteImage,
  remoteImageIndex,
  uploadMissingImages,
  type RemoteImages,
  type TreeEntry,
} from "./image-sync";
import { setRemoteImageLoader } from "../image-urls";
import { storedHashes } from "../images";

function configKey(): string {
  return scopedKey("flashycardy.sync");
}
/**
 * What this device and GitHub last agreed the document contained — ids and
 * their timestamps, not contents. See `merge.ts`: without it, a record missing
 * from one side cannot be told from a record newly added to the other.
 */
function baseKey(): string {
  return scopedKey("flashycardy.sync.base");
}
/**
 * The `mutatedAt` of the last document GitHub actually accepted.
 *
 * Pushing was driven only by changes: something edits the document, a push is
 * scheduled. If that push never lands — the tab was hidden and frozen part way
 * through a long upload — nothing schedules another, because nothing has
 * changed since. The document then sits unsent indefinitely while the app shows
 * no error, because none occurred. This is how the app can tell, at any moment,
 * whether what it holds has ever been sent.
 */
function pushedKey(): string {
  return scopedKey("flashycardy.sync.pushedAt");
}
function shaKey(): string {
  return scopedKey("flashycardy.sync.sha");
}
function lastSyncedKey(): string {
  return scopedKey("flashycardy.sync.lastSyncedAt");
}
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
  const raw = window.localStorage.getItem(lastSyncedKey());
  return raw ? new Date(raw) : null;
}

export function getSyncConfig(): SyncConfig | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(configKey());
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

/**
 * What another profile syncs to, as `owner/repo/path@branch`, or null.
 *
 * Two profiles pointed at the same file would pull each other's decks in and
 * merge them — the one way separate profiles can still run together, and
 * silent if nothing looks for it. Settings uses this to say so. Reads that
 * profile's own key rather than the active one's, which is why it takes an id.
 */
export function getSyncTargetFor(profileId: string): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(
    scopedKeyFor("flashycardy.sync", profileId),
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    if (!parsed.owner || !parsed.repo) return null;
    const path = parsed.path || "data.json";
    const branch = parsed.branch || "main";
    return `${parsed.owner}/${parsed.repo}/${path}@${branch}`;
  } catch {
    return null;
  }
}

export function setSyncConfig(config: SyncConfig | null) {
  if (typeof window === "undefined") return;
  if (config === null) {
    window.localStorage.removeItem(configKey());
    window.localStorage.removeItem(shaKey());
    setState("disabled");
    return;
  }
  window.localStorage.setItem(configKey(), JSON.stringify(config));
  // A different file means the cached SHA no longer refers to anything.
  window.localStorage.removeItem(shaKey());
  setState("idle");
}

function getSha(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(shaKey());
}

function setSha(sha: string | null) {
  if (typeof window === "undefined") return;
  if (sha === null) window.localStorage.removeItem(shaKey());
  else window.localStorage.setItem(shaKey(), sha);
}

function readBase(): SyncBase | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(baseKey());
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
    window.localStorage.setItem(baseKey(), JSON.stringify(baseOf(doc)));
  } catch {
    // Out of quota: the next merge keeps more than it strictly should rather
    // than dropping the sync.
  }
}

function markPushed(at: Date) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(pushedKey(), at.toISOString());
}

/** Whether this device holds anything GitHub has not accepted. */
export function hasUnpushedChanges(): boolean {
  if (typeof window === "undefined") return false;
  const pushed = window.localStorage.getItem(pushedKey());
  if (!pushed) return true;
  return getSnapshot().mutatedAt.getTime() > new Date(pushed).getTime();
}

function markSynced() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(lastSyncedKey(), new Date().toISOString());
}

function headers(config: SyncConfig, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${config.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** UTF-8 safe base64, since card HTML routinely contains non-ASCII. */
/**
 * Base64 for a document that is now tens of megabytes.
 *
 * A byte at a time built the string with forty million appends and locked the
 * tab for most of a minute — long enough that the push looked hung and the
 * window stopped answering. In blocks it is the same answer in a fraction of
 * the time; the block stays well under the argument limit for `apply`.
 */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const BLOCK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += BLOCK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + BLOCK)));
  }
  return btoa(parts.join(""));
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
export async function pull(
  config: SyncConfig,
  options: { force?: boolean } = {},
): Promise<PullResult> {
  const meta = await fetchMeta(config);
  if (!meta) return { kind: "no-remote" };
  // Normally an unchanged SHA means there is nothing to fetch. `force` is for
  // the case where the document is not what we are after: a device that has
  // never recorded what it and GitHub agree on needs the contents to write that
  // down, and would otherwise skip the download forever and keep merging as if
  // it had no history — which never applies a deletion.
  if (meta.sha === getSha() && !options.force) return { kind: "unchanged" };

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

/**
 * Write the document, by whichever route the size allows.
 *
 * The simple one — PUT to the contents endpoint — refuses anything much over
 * forty megabytes, and says so: "Sorry, the file is too large to be processed."
 * The document passed that line and sync stopped dead, reported as a conflict
 * because 422 was the status either way.
 *
 * So above a threshold it goes the way git itself would: write a blob, hang it
 * in a tree beside whatever else the repo holds, commit that tree onto the
 * branch tip, and move the branch. More round trips, but the blob endpoint
 * takes what the contents endpoint will not.
 *
 * The small path is kept because it is one request rather than six, and most
 * people's decks will never need the other.
 */
const CONTENTS_API_LIMIT = 30 * 1024 * 1024;

/** The commit the branch points at, or null when the repo is empty. */
async function headCommit(config: SyncConfig): Promise<string | null> {
  const response = await fetch(
    `${API}/repos/${config.owner}/${config.repo}/git/ref/heads/${encodeURIComponent(config.branch)}`,
    { headers: headers(config), cache: "no-store" },
  );
  if (!response.ok) return null;
  const ref = (await response.json()) as { object: { sha: string } };
  return ref.object.sha;
}

/**
 * Where the pictures are, for whoever needs one that is not on this device.
 *
 * Held for the session rather than fetched per picture: the listing is one
 * request that answers every miss, and a card whose scan has not arrived is
 * common right after a sync.
 */
let knownRemoteImages: RemoteImages = new Map();

/**
 * Only ever what the repository actually holds.
 *
 * Recording a picture here when it was uploaded — rather than when a commit
 * referred to it — is how the document came to be committed alone. An uploaded
 * blob that nothing points at is invisible: not in any tree, not in the repo.
 * The next push read this and concluded every picture was already there, so it
 * sent the document by itself and left every card pointing at nothing.
 */
function rememberRemoteImages(index: RemoteImages) {
  for (const [hash, path] of index) knownRemoteImages.set(hash, path);
}

/**
 * Whether the repository is missing any picture the document names.
 *
 * One listing, on the checks that already talk to GitHub. The document and its
 * pictures are separate files, so "sent" is two questions and answering only
 * the first is how a machine came to sit on a green tick holding thirteen
 * hundred pictures nobody else could see.
 */
async function picturesOutstanding(config: SyncConfig): Promise<boolean> {
  const wanted = referencedImages(getSnapshot().cards);
  if (wanted.size === 0) return false;
  if ([...wanted].every((hash) => knownRemoteImages.has(hash))) return false;

  const head = await headCommit(config);
  if (!head) return false;
  rememberRemoteImages(await remoteImageIndex(config, head));

  const held = await storedHashes();
  // Only pictures this device actually has: one it lacks is for another device
  // to send, and pushing on its account would loop forever.
  return [...wanted].some((hash) => !knownRemoteImages.has(hash) && held.has(hash));
}

async function loadRemote(hash: string): Promise<Blob | null> {
  const config = getSyncConfig();
  if (!config) return null;

  if (!knownRemoteImages.has(hash)) {
    const head = await headCommit(config);
    if (!head) return null;
    knownRemoteImages = await remoteImageIndex(config, head);
  }

  const path = knownRemoteImages.get(hash);
  return path ? fetchRemoteImage(config, hash, path) : null;
}

async function writeFile(
  config: SyncConfig,
  json: string,
  sha: string | null,
  force: boolean,
  extra: TreeEntry[] = [],
): Promise<Response> {
  const content = toBase64(json);
  const message = `flashycardy: ${json.length} bytes`;

  // Anything carrying pictures has to go the long way: the contents endpoint
  // writes one file per request and cannot commit a picture beside a document.
  if (json.length < CONTENTS_API_LIMIT && extra.length === 0) {
    return fetch(
      `${API}/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(config.path)}`,
      {
        method: "PUT",
        headers: { ...headers(config), "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          content,
          branch: config.branch,
          ...(sha ? { sha } : {}),
        }),
      },
    );
  }

  return writeViaGitData(config, content, message, force, extra);
}

/**
 * blob → tree → commit → move the branch.
 *
 * The last step is the one that can conflict: moving the branch is refused
 * unless the commit being replaced is the parent of the new one, which is the
 * same protection the contents endpoint gives by demanding the file's SHA. A
 * forced write moves it anyway, which is what "keep this device" means.
 */
async function writeViaGitData(
  config: SyncConfig,
  content: string,
  message: string,
  force: boolean,
  extra: TreeEntry[] = [],
): Promise<Response> {
  const base = `${API}/repos/${config.owner}/${config.repo}/git`;
  const post = (path: string, body: unknown, method = "POST") =>
    fetch(`${base}${path}`, {
      method,
      headers: { ...headers(config), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const refUrl = `${base}/ref/heads/${encodeURIComponent(config.branch)}`;
  const refResponse = await fetch(refUrl, { headers: headers(config), cache: "no-store" });
  if (!refResponse.ok) return refResponse;
  const ref = (await refResponse.json()) as { object: { sha: string } };
  const parent = ref.object.sha;

  const blobResponse = await post("/blobs", { content, encoding: "base64" });
  if (!blobResponse.ok) return blobResponse;
  const blob = (await blobResponse.json()) as { sha: string };

  const treeResponse = await post("/trees", {
    // Based on the current commit's tree, so nothing else in the repo is lost.
    base_tree: parent,
    tree: [
      { path: config.path, mode: "100644", type: "blob", sha: blob.sha },
      // Pictures ride in the same commit as the document that refers to them,
      // so the repository is never in a state where a card names a file that
      // is not there yet.
      ...extra,
    ],
  });
  if (!treeResponse.ok) return treeResponse;
  const tree = (await treeResponse.json()) as { sha: string };

  const commitResponse = await post("/commits", {
    message,
    tree: tree.sha,
    parents: [parent],
  });
  if (!commitResponse.ok) return commitResponse;
  const commit = (await commitResponse.json()) as { sha: string };

  const moved = await post(
    `/refs/heads/${encodeURIComponent(config.branch)}`,
    { sha: commit.sha, force },
    "PATCH",
  );
  if (!moved.ok) return moved;

  // The caller wants the file's blob SHA, which is what the contents endpoint
  // would have returned, so the two paths are interchangeable above here.
  return new Response(JSON.stringify({ content: { sha: blob.sha } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function pushLocked(
  config: SyncConfig,
  options: { force?: boolean },
): Promise<"ok" | "conflict"> {
  const doc = getSnapshot();
  const serialized = serializeDoc(doc);
  // No longer pretty-printed. Indenting a forty-megabyte document adds several
  // megabytes of spaces to something no one reads, and the size is the reason
  // the old write path stopped working at all.
  const json = JSON.stringify(serialized);

  // Read inside the lock: another tab may have pushed while this one queued.
  let sha = getSha();
  if (options.force) {
    // Re-read so we overwrite whatever is actually there now.
    sha = (await fetchMeta(config))?.sha ?? null;
  }

  // Pictures the document refers to but the repository does not hold yet are
  // uploaded first and committed alongside it.
  const wanted = referencedImages(doc.cards);
  let extra: TreeEntry[] = [];
  // Only when something is referenced that this session has not already seen in
  // the repository. Otherwise every push — one per card answered — would fetch
  // a listing of a thousand pictures to learn nothing.
  if ([...wanted].some((hash) => !knownRemoteImages.has(hash))) {
    const head = await headCommit(config);
    if (head) rememberRemoteImages(await remoteImageIndex(config, head));
    extra = await uploadMissingImages(config, wanted, knownRemoteImages);
  }

  // The invariant, checked rather than assumed: a document is never sent
  // unless every picture it names is either already in the repository or going
  // up in this same commit. It was assumed once, and the result was a thousand
  // cards committed pointing at pictures that were nowhere.
  const carried = new Set(
    extra.map((e) => e.path.slice("images/".length).split(".")[0]),
  );
  const orphans = [...wanted].filter(
    (hash) => !knownRemoteImages.has(hash) && !carried.has(hash),
  );
  if (orphans.length > 0) {
    throw new Error(
      `Not sending: ${orphans.length} picture${orphans.length === 1 ? "" : "s"} would be left behind. They upload on the next attempt.`,
    );
  }

  const response = await writeFile(
    config,
    json,
    sha,
    options.force === true,
    extra,
  );

  // 422 is also what GitHub returns for a file it will not take at all, and
  // reading that as a conflict sent everyone to the wrong screen: sync had
  // stopped because the document had outgrown the endpoint, while the app said
  // the file had changed elsewhere and offered to pick a version. The message
  // is the only thing that tells them apart, so it is read rather than assumed.
  if (response.status === 422) {
    const detail = await response.clone().text();
    if (/too large/i.test(detail)) {
      throw new Error(
        "GitHub refused the file as too large. Your decks have outgrown what it will accept in one piece — see Settings for the size.",
      );
    }
  }

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
          markPushed(doc.mutatedAt);
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
  // The commit now refers to every blob that was uploaded for it, so they are
  // no longer at risk of being written twice.
  // Now — and only now — are these pictures in the repository, because this
  // commit is what puts them there.
  for (const entry of extra) {
    knownRemoteImages.set(entry.path.slice("images/".length).split(".")[0], entry.path);
  }
  clearPendingBlobs();
  markPushed(doc.mutatedAt);
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
  const result = await pull(config, { force: readBase() === null });
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
      // Also when this device simply never managed to send what it has: a push
      // that died leaves no trace in the document, so a change-driven sync
      // would never try again.
      //
      // And when the document is up to date but its pictures are not. Being
      // "unsent" was measured by the document alone, so a device that had
      // committed the document and then failed to upload the pictures believed
      // it was finished and never tried again — while the other device, which
      // did have something to send, sat showing work it could not complete.
      if (owesRemote || hasUnpushedChanges() || (await picturesOutstanding(config)))
        schedulePush();
      markChecked();
      setState("idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState(navigator.onLine ? "error" : "offline", message);
    }
  };

  // Cards can render a picture the repository holds and this device does not.
  setRemoteImageLoader(loadRemote);

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
