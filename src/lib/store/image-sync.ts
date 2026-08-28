"use client";

/**
 * Pictures on the wire.
 *
 * They travel as their own files — `images/<hash>.<ext>` — rather than inside
 * the document, which is what stopped the document being too big to send. Each
 * is written once: a picture's name is its content, so a name already in the
 * repository is a picture already there, whatever any device believes.
 *
 * Reading is deliberately lazy. A card arrives in the document long before its
 * picture is needed on screen, and a machine that has just synced eight hundred
 * cards should not download thirty megabytes before it can show the first one.
 */

import type { SyncConfig } from "./github-sync";
import { getImage, hashImage, putImage, storedHashes } from "../images";

const API = "https://api.github.com";

const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

const TYPES: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]),
);

export function imagePath(hash: string, type: string): string {
  return `images/${hash}.${EXTENSIONS[type] ?? "bin"}`;
}

function headers(config: SyncConfig, accept = "application/vnd.github+json") {
  return { Accept: accept, Authorization: `Bearer ${config.token}` };
}

export type RemoteImages = Map<string, string>;

/**
 * Which pictures the repository holds, by hash.
 *
 * One listing rather than a request per picture: a device with none of them
 * needs to know what exists before it can ask for any, and asking one at a time
 * would be a thousand round trips to find out.
 */
export async function remoteImageIndex(
  config: SyncConfig,
  commit: string,
): Promise<RemoteImages> {
  const url = `${API}/repos/${config.owner}/${config.repo}/git/trees/${commit}?recursive=1`;
  const response = await fetch(url, { headers: headers(config) });
  if (!response.ok) return new Map();

  const body = (await response.json()) as {
    tree: { path: string; type: string }[];
  };
  const index: RemoteImages = new Map();
  for (const entry of body.tree) {
    if (entry.type !== "blob" || !entry.path.startsWith("images/")) continue;
    const hash = entry.path.slice("images/".length).split(".")[0];
    if (hash.length === 64) index.set(hash, entry.path);
  }
  return index;
}

/**
 * Blobs written but not yet committed.
 *
 * A blob nothing points at is invisible: it is not in any tree, so the next
 * attempt would upload it again. On a first migration that is a thousand
 * uploads repeated because the last few hit a rate limit. Their names are kept
 * here until a commit refers to them.
 */
const PENDING_KEY = "flashycardy.pendingBlobs";

function loadPending(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "{}") as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

function savePending(pending: Record<string, string>) {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Losing this costs a repeated upload, not correctness.
  }
}

export function clearPendingBlobs() {
  window.localStorage.removeItem(PENDING_KEY);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create one blob, waiting out GitHub's throttle rather than failing.
 *
 * Uploading a thousand pictures trips the secondary rate limit — it is aimed
 * exactly at bursts of content creation — and the first migration is the one
 * time this app ever does that. A refusal is a "come back shortly", so it does.
 */
async function createBlob(
  config: SyncConfig,
  content: string,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(
      `${API}/repos/${config.owner}/${config.repo}/git/blobs`,
      {
        method: "POST",
        headers: { ...headers(config), "Content-Type": "application/json" },
        body: JSON.stringify({ content, encoding: "base64" }),
      },
    );

    if (response.ok) return ((await response.json()) as { sha: string }).sha;

    const throttled = response.status === 403 || response.status === 429;
    if (!throttled || attempt >= 5) throw new Error(await response.text());

    // GitHub says when to come back; when it does not, back off and grow.
    const after = Number(response.headers.get("retry-after"));
    await wait(Number.isFinite(after) && after > 0 ? after * 1000 : 20_000 * (attempt + 1));
  }
}

export type TreeEntry = {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string;
};

/**
 * Upload the pictures the repository does not have, and describe them for the
 * commit that will carry them.
 *
 * A few at a time. All at once is a thousand parallel requests, which the
 * browser queues and GitHub rate-limits; one at a time takes minutes on a first
 * migration. This is the middle.
 */
export async function uploadMissingImages(
  config: SyncConfig,
  needed: Set<string>,
  present: RemoteImages,
  onProgress?: (done: number, total: number) => void,
): Promise<TreeEntry[]> {
  const held = await storedHashes();
  const missing = [...needed].filter((h) => !present.has(h) && held.has(h));
  if (missing.length === 0) return [];

  const pending = loadPending();
  const entries: TreeEntry[] = [];

  // One at a time, with a gap. GitHub asks for serial writes and a pause
  // between them; a thousand at once is what tripped the limit. At this pace a
  // first migration takes a few minutes and every later push takes none,
  // because by then there is nothing left to upload.
  for (const [index, hash] of missing.entries()) {
    const blob = await getImage(hash);
    if (!blob) continue;

    const path = imagePath(hash, blob.type);
    let sha = pending[hash];

    if (!sha) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      const BLOCK = 0x8000;
      for (let j = 0; j < bytes.length; j += BLOCK) {
        binary += String.fromCharCode(...bytes.subarray(j, j + BLOCK));
      }
      sha = await createBlob(config, btoa(binary));
      pending[hash] = sha;
      savePending(pending);
      await wait(120);
    }

    entries.push({ path, mode: "100644", type: "blob", sha });
    onProgress?.(index + 1, missing.length);
  }

  return entries;
}

/**
 * Fetch one picture and keep it.
 *
 * The contents endpoint returns the bytes inline below a megabyte, and every
 * picture here is far under that, so this is one request rather than the
 * metadata-then-blob pair the document needs.
 */
export async function fetchRemoteImage(
  config: SyncConfig,
  hash: string,
  path: string,
): Promise<Blob | null> {
  const url = `${API}/repos/${config.owner}/${config.repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`;
  const response = await fetch(url, { headers: headers(config) });
  if (!response.ok) return null;

  const body = (await response.json()) as { content?: string };
  if (!body.content) return null;

  const binary = atob(body.content.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const ext = path.split(".").pop() ?? "";
  const blob = new Blob([bytes as BlobPart], {
    type: TYPES[ext] ?? "application/octet-stream",
  });

  // Verified before it is kept: a picture is named by its bytes, so bytes that
  // hash to something else are not the picture that was asked for.
  if ((await hashImage(bytes)) !== hash) return null;

  await putImage(hash, blob);
  return blob;
}
