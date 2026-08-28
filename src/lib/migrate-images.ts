"use client";

/**
 * Moving the pictures already inside the document out of it.
 *
 * Done in two passes, and in that order for a reason. The first stores every
 * picture's bytes and touches nothing else; the second rewrites the cards to
 * refer to them, in one write. Interrupted anywhere in the first pass, nothing
 * has changed and running it again simply re-stores what it already has — the
 * hash of the same bytes is the same key. Interrupted between the passes, the
 * cards still carry their pictures inline and nothing is lost.
 *
 * The reverse order would be the dangerous one: cards pointing at pictures that
 * were never saved.
 */

import { getSnapshot, mutate } from "./store/local-store";
import { hasInlineImages, storeInlineImages } from "./card-images";
import type { CardRow } from "./store/types";

export type MigrationProgress = {
  done: number;
  total: number;
  /** Distinct pictures written so far. */
  images: number;
};

export type MigrationResult = {
  cards: number;
  images: number;
  /** Characters removed from the document — very nearly bytes. */
  freed: number;
};

/** Cards still carrying pictures inline, and what they weigh. */
export function inlineImageLoad(cards: readonly CardRow[]): {
  cards: number;
  bytes: number;
} {
  let count = 0;
  let bytes = 0;
  for (const card of cards) {
    const inline =
      hasInlineImages(card.front) || hasInlineImages(card.back);
    if (!inline) continue;
    count += 1;
    // The base64 payload is what the document is carrying, so measure that
    // rather than the decoded size: it is the number that has to fit.
    for (const html of [card.front, card.back]) {
      for (const [, payload] of html.matchAll(
        /data:image\/[a-z+.-]+;base64,([^"]+)/g,
      )) {
        bytes += payload.length;
      }
    }
  }
  return { cards: count, bytes };
}

/**
 * Store every inline picture, then rewrite the cards that held them.
 *
 * Yields to the browser between batches. This is a megabyte-scale job on the
 * main thread — hashing and re-encoding a thousand pictures — and running it
 * without letting go would freeze the window for the whole of it, which is
 * exactly the failure that made the old push look hung.
 */
export async function migrateInlineImages(
  onProgress?: (progress: MigrationProgress) => void,
): Promise<MigrationResult> {
  const cards = getSnapshot().cards;
  const pending = cards.filter(
    (c) => hasInlineImages(c.front) || hasInlineImages(c.back),
  );

  const rewrites = new Map<number, { front: string; back: string }>();
  const images = new Set<string>();
  let before = 0;
  let after = 0;

  for (const [index, card] of pending.entries()) {
    const front = await storeInlineImages(card.front);
    const back = await storeInlineImages(card.back);
    for (const hash of [...front.stored, ...back.stored]) images.add(hash);

    before += card.front.length + card.back.length;
    after += front.html.length + back.html.length;
    rewrites.set(card.id, { front: front.html, back: back.html });

    if (index % 10 === 9) {
      onProgress?.({ done: index + 1, total: pending.length, images: images.size });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  if (rewrites.size > 0) {
    await mutate((draft) => {
      const now = new Date();
      draft.cards = draft.cards.map((card) => {
        const rewrite = rewrites.get(card.id);
        // Stamped as changed, because it is: the other machine has to be told
        // the card now names its picture rather than carrying it.
        return rewrite ? { ...card, ...rewrite, updatedAt: now } : card;
      });
      return rewrites.size;
    });
  }

  onProgress?.({ done: pending.length, total: pending.length, images: images.size });
  return { cards: rewrites.size, images: images.size, freed: before - after };
}
