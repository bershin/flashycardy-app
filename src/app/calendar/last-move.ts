"use client";

/**
 * The last card move, kept so its Undo survives a reload.
 *
 * localStorage rather than the synced document: this is one device's "I just
 * did that and might take it back", not part of the collection. Putting it in
 * `data.json` would push an undo buffer through GitHub to every other device,
 * where the offer to reverse a move nobody there made is only confusing.
 *
 * Subscribable so the calendar can read it with `useSyncExternalStore`, which
 * keeps the prerendered HTML (no move) and the hydrated page (whatever is
 * stored) from disagreeing.
 */

import type { CompletedMove } from "./move-due-cards-dialog";

const KEY = "flashycardy.lastMove";

/**
 * How long an undo stays on offer.
 *
 * Long enough to survive a reload, closing the tab, or coming back after
 * thinking about it; short enough that cards are unlikely to have been studied
 * since — an undo that old would fight the review history rather than correct a
 * misjudged move. Stale entries are also rejected at undo time by checking the
 * cards are still where the move put them, so this is the outer bound rather
 * than the only guard.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type StoredMove = CompletedMove & {
  /** When the move happened, ISO. */
  movedAt: string;
};

const listeners = new Set<() => void>();

/**
 * `useSyncExternalStore` compares snapshots by identity, so parsing on every
 * read would report a change on every render and loop. The parse is cached
 * against the raw string it came from.
 */
let cachedRaw: string | null = null;
let cachedValue: StoredMove | null = null;

function read(): StoredMove | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(KEY);
  if (raw === cachedRaw) return cachedValue;

  cachedRaw = raw;
  cachedValue = null;

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as StoredMove;
      const age = Date.now() - new Date(parsed.movedAt).getTime();
      // A hand-edited or half-written entry is discarded rather than trusted:
      // undo writes dates straight onto cards.
      if (
        Array.isArray(parsed.entries) &&
        parsed.entries.length > 0 &&
        Number.isFinite(age) &&
        age >= 0 &&
        age < MAX_AGE_MS
      ) {
        cachedValue = parsed;
      }
    } catch {
      cachedValue = null;
    }
  }

  return cachedValue;
}

export function getLastMove(): StoredMove | null {
  return read();
}

/** Nothing is on offer until the browser has been consulted. */
export function lastMoveServerSnapshot(): StoredMove | null {
  return null;
}

export function setLastMove(move: CompletedMove | null) {
  if (typeof window === "undefined") return;
  if (move) {
    const stored: StoredMove = { ...move, movedAt: new Date().toISOString() };
    window.localStorage.setItem(KEY, JSON.stringify(stored));
  } else {
    window.localStorage.removeItem(KEY);
  }
  for (const listener of listeners) listener();
}

export function subscribeLastMove(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab undoing the move must not leave this one still offering it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
