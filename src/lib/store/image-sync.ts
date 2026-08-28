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

  const entries: TreeEntry[] = [];
  const BATCH = 6;

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const written = await Promise.all(
      batch.map(async (hash) => {
        const blob = await getImage(hash);
        if (!blob) return null;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        const BLOCK = 0x8000;
        for (let j = 0; j < bytes.length; j += BLOCK) {
          binary += String.fromCharCode(...bytes.subarray(j, j + BLOCK));
        }
        const response = await fetch(
          `${API}/repos/${config.owner}/${config.repo}/git/blobs`,
          {
            method: "POST",
            headers: { ...headers(config), "Content-Type": "application/json" },
            body: JSON.stringify({ content: btoa(binary), encoding: "base64" }),
          },
        );
        if (!response.ok) throw new Error(await response.text());
        const { sha } = (await response.json()) as { sha: string };
        return {
          path: imagePath(hash, blob.type),
          mode: "100644" as const,
          type: "blob" as const,
          sha,
        };
      }),
    );
    for (const entry of written) if (entry) entries.push(entry);
    onProgress?.(Math.min(i + BATCH, missing.length), missing.length);
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
