"use client";

/**
 * Turning a stored picture into something an `<img>` can show.
 *
 * Object URLs, cached and shared: the same picture appears in a card, in the
 * study session and in the editor, and minting a URL each time would leak one
 * per render. They are handed out by hash and revoked when the cache evicts
 * them, which is what keeps a deck of eight hundred pictures from holding every
 * one of them open at once.
 */

import { getImage } from "./images";

/** Roughly a screenful of cards' worth, well short of a whole deck. */
const LIMIT = 120;

/** Insertion-ordered, so the oldest entry is the first key. */
const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function remember(hash: string, url: string) {
  urls.set(hash, url);
  while (urls.size > LIMIT) {
    const oldest = urls.keys().next().value as string;
    const stale = urls.get(oldest)!;
    urls.delete(oldest);
    URL.revokeObjectURL(stale);
  }
}

/** The URL for a picture already resolved, or null — never blocks. */
export function cachedUrl(hash: string): string | null {
  return urls.get(hash) ?? null;
}

/**
 * Resolve a picture, fetching it from the store if this is the first ask.
 *
 * Returns null when the device does not have it. That is a real state, not an
 * error: a card synced from another machine arrives before its pictures do.
 */
export async function resolveImage(hash: string): Promise<string | null> {
  const ready = urls.get(hash);
  if (ready) return ready;

  const inFlight = pending.get(hash);
  if (inFlight) return inFlight;

  const work = (async () => {
    const blob = await getImage(hash);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    remember(hash, url);
    return url;
  })().finally(() => pending.delete(hash));

  pending.set(hash, work);
  return work;
}
