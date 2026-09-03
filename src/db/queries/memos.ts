/**
 * Written notes, as opposed to things to do on a day.
 *
 * Same shape as the todo and card queries: pure reads off a snapshot, writes
 * through a single `mutate` so a half-written note is never persisted or
 * synced. Stored under `memos` — see the type for why the key is not `notes`.
 */

import { allocateMemoId, getSnapshot, mutate } from "@/lib/store/local-store";
import type { DbDoc, Memo } from "@/lib/store/types";

/**
 * Pinned first, then most recently changed.
 *
 * By `updatedAt` rather than `createdAt`: a note you were writing a minute ago
 * is the one you want next, whenever it was started. The id breaks ties so two
 * notes saved in the same millisecond do not swap places between renders.
 */
function inReadingOrder(memos: Memo[]): Memo[] {
  return [...memos].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      b.updatedAt.getTime() - a.updatedAt.getTime() ||
      b.id - a.id,
  );
}

export function selectMemosByUser(db: DbDoc, userId: string): Memo[] {
  return inReadingOrder((db.memos ?? []).filter((m) => m.userId === userId));
}

export function selectMemoById(
  db: DbDoc,
  id: number,
  userId: string,
): Memo | null {
  return (db.memos ?? []).find((m) => m.id === id && m.userId === userId) ?? null;
}

/**
 * Notes whose title or body contains every word typed, in any order.
 *
 * Words rather than the whole phrase, because searching a note you half
 * remember means recalling two words from it and not the sentence they were in.
 */
export function selectMemosMatching(
  db: DbDoc,
  userId: string,
  query: string,
): Memo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return selectMemosByUser(db, userId);
  return selectMemosByUser(db, userId).filter((memo) => {
    const haystack = `${memo.title}\n${memo.body}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export async function getMemosByUser(userId: string) {
  return selectMemosByUser(getSnapshot(), userId);
}

/** A new, empty note, ready to be typed into. */
export async function addMemo(userId: string, title = "", body = "") {
  return mutate((draft) => {
    const now = new Date();
    const memo: Memo = {
      id: allocateMemoId(draft),
      userId,
      title,
      body,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    draft.memos = [...(draft.memos ?? []), memo];
    return memo;
  });
}

export async function updateMemo(
  id: number,
  userId: string,
  patch: Partial<Pick<Memo, "title" | "body" | "pinned">>,
) {
  return mutate((draft) => {
    const index = (draft.memos ?? []).findIndex(
      (m) => m.id === id && m.userId === userId,
    );
    if (index === -1) return null;

    const existing = draft.memos[index];
    const updated: Memo = { ...existing, ...patch, updatedAt: new Date() };
    // Nothing actually changed — an autosave firing on a note nobody touched,
    // or a blur after an edit was already saved. Left alone so the document is
    // not restamped, which would push an identical file to GitHub and make
    // every other device believe there was something new to pull.
    if (
      updated.title === existing.title &&
      updated.body === existing.body &&
      updated.pinned === existing.pinned
    ) {
      return existing;
    }

    draft.memos[index] = updated;
    return updated;
  });
}

export async function deleteMemo(id: number, userId: string) {
  return mutate((draft) => {
    const before = (draft.memos ?? []).length;
    draft.memos = (draft.memos ?? []).filter(
      (m) => !(m.id === id && m.userId === userId),
    );
    return draft.memos.length < before;
  });
}
