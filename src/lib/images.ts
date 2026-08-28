"use client";

/**
 * Card pictures, stored beside the document instead of inside it.
 *
 * They used to be `data:` URLs in the card's HTML, which cost twice over: once
 * for the base64 in the document, and again when the whole document was base64'd
 * to be synced. Thirty megabytes of images arrived at GitHub as fifty-five, and
 * GitHub refused it — "Sorry, the file is too large to be processed" — so
 * syncing stopped entirely, for every card, because of the pictures.
 *
 * Here they are raw bytes in their own store, keyed by the hash of those bytes,
 * and the card holds a reference. The document shrinks from forty megabytes to
 * under one, an image is uploaded once instead of on every change, and two
 * copies of the same picture are one file.
 */

import { IMAGE_STORE, openDb } from "./store/local-store";

/** How a card refers to a picture: `cue:` and the hash of its bytes. */
export const IMAGE_PREFIX = "cue:";

const HASH = /^[0-9a-f]{64}$/;

export function isImageRef(src: string): boolean {
  return src.startsWith(IMAGE_PREFIX) && HASH.test(src.slice(IMAGE_PREFIX.length));
}

/**
 * The name of a picture is what is in it.
 *
 * Content addressing rather than an id: the same picture pasted into two cards
 * is stored and uploaded once, an image can never be quietly replaced by
 * different bytes under the same name, and a device can tell whether it already
 * has one without asking anybody.
 */
export async function hashImage(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function withImages<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, mode);
      const request = work(tx.objectStore(IMAGE_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function putImage(hash: string, bytes: Blob): Promise<void> {
  await withImages("readwrite", (store) => store.put(bytes, hash));
}

export async function getImage(hash: string): Promise<Blob | undefined> {
  return withImages("readonly", (store) => store.get(hash) as IDBRequest<Blob>);
}

export async function hasImage(hash: string): Promise<boolean> {
  const count = await withImages("readonly", (store) => store.count(hash));
  return count > 0;
}

/** Every picture this device holds, for working out what a sync must send. */
export async function storedHashes(): Promise<Set<string>> {
  const keys = await withImages(
    "readonly",
    (store) => store.getAllKeys() as IDBRequest<IDBValidKey[]>,
  );
  return new Set(keys.map(String));
}

export async function deleteImage(hash: string): Promise<void> {
  await withImages("readwrite", (store) => store.delete(hash));
}
