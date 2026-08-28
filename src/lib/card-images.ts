"use client";

/**
 * Moving pictures between a card's HTML and the image store.
 *
 * The editor produces `data:` URLs — that is what pasting an image gives you —
 * so they are caught on the way in and replaced by a reference. Nothing else in
 * the app has to know: the HTML keeps an `<img>` tag, it simply names the
 * picture instead of carrying it.
 */

import { hashImage, IMAGE_PREFIX, isImageRef, putImage } from "./images";

/** `data:image/webp;base64,...` inside a src attribute. */
const DATA_URL = /src="(data:(image\/[a-z+.-]+);base64,([^"]+))"/g;
const REF_URL = new RegExp(`src="(${IMAGE_PREFIX}[0-9a-f]{64})"`, "g");

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Store any inline pictures and return the HTML that refers to them instead.
 *
 * The bytes are written before the HTML is rewritten, so a failure part way
 * through leaves a card still carrying its picture rather than a reference to
 * one that was never saved.
 */
export async function storeInlineImages(
  html: string,
): Promise<{ html: string; stored: string[] }> {
  const matches = [...html.matchAll(DATA_URL)];
  if (matches.length === 0) return { html, stored: [] };

  const stored: string[] = [];
  let result = html;

  for (const [, whole, type, base64] of matches) {
    const bytes = bytesOf(base64);
    const hash = await hashImage(bytes);
    await putImage(hash, new Blob([bytes as BlobPart], { type }));
    stored.push(hash);
    result = result.replace(whole, `${IMAGE_PREFIX}${hash}`);
  }

  return { html: result, stored };
}

/** The pictures a piece of HTML depends on. */
export function imageRefs(html: string): string[] {
  return [...html.matchAll(REF_URL)].map(([, src]) =>
    src.slice(IMAGE_PREFIX.length),
  );
}

/** Every picture referenced anywhere in a set of cards. */
export function referencedImages(
  cards: readonly { front: string; back: string }[],
): Set<string> {
  const refs = new Set<string>();
  for (const card of cards) {
    for (const hash of imageRefs(card.front)) refs.add(hash);
    for (const hash of imageRefs(card.back)) refs.add(hash);
  }
  return refs;
}

/** Whether this HTML still carries pictures inline, for the migration to find. */
export function hasInlineImages(html: string): boolean {
  DATA_URL.lastIndex = 0;
  return DATA_URL.test(html);
}

export { isImageRef };
