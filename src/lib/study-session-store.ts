"use client";

import { scopedKey } from "./store/profiles";

/**
 * Crash recovery for study sessions.
 *
 * Individual ratings are already durable — each one writes straight to the
 * database. What is lost when a tab closes mid-session is the *envelope*: where
 * you were in the deck, the running tally, and which round you are on. That is
 * what this keeps.
 *
 * It lives in localStorage rather than in `DbDoc` on purpose. A half-finished
 * session is per-device UI state; syncing it to GitHub would push a partial
 * session onto your other devices and bloat the synced document for no benefit.
 *
 * Sessions are keyed by deck so that glancing at another deck doesn't discard
 * the one you were part-way through, and expire at the end of the day they were
 * saved — by the next morning the schedule has moved on and a stale position
 * would be misleading.
 */

function storageKey(): string {
  return scopedKey("flashycardy.sessions");
}

export type SavedRating = "got_it" | "missed";

export type SavedSession = {
  deckId: number;
  /** The full set the session started from — drives "review missed cards". */
  sourceCardIds: number[];
  /** The working order, which shuffling and missed-rounds rewrite. */
  cardIds: number[];
  currentIndex: number;
  ratings: Array<[number, SavedRating]>;
  /**
   * Milliseconds spent per card so far. Absent in sessions saved before the
   * timer existed, which resume with an unknown — not a zero — time budget.
   */
  durations?: Array<[number, number]>;
  round: number;
  savedAt: string;
};

type SessionMap = Record<string, SavedSession>;

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function readAll(): SessionMap {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(storageKey());
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as SessionMap;
    if (!parsed || typeof parsed !== "object") return {};

    // Drop anything saved before today on the way through, so expired sessions
    // never accumulate.
    const today = startOfToday();
    const fresh: SessionMap = {};
    for (const [id, session] of Object.entries(parsed)) {
      if (new Date(session.savedAt).getTime() >= today) fresh[id] = session;
    }
    return fresh;
  } catch {
    return {};
  }
}

function writeAll(sessions: SessionMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(sessions));
  } catch {
    // A full or unavailable localStorage must never break studying — the
    // ratings themselves are safe regardless.
  }
}

export function saveSession(session: SavedSession) {
  const all = readAll();
  all[String(session.deckId)] = session;
  writeAll(all);
}

export function loadSession(deckId: number): SavedSession | null {
  return readAll()[String(deckId)] ?? null;
}

export function clearSession(deckId: number) {
  const all = readAll();
  delete all[String(deckId)];
  writeAll(all);
}
