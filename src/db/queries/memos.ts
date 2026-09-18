/**
 * Written notes, as opposed to things to do on a day.
 *
 * Same shape as the todo and card queries: pure reads off a snapshot, writes
 * through a single `mutate` so a half-written note is never persisted or
 * synced. Stored under `memos` — see the type for why the key is not `notes`.
 */

import { allocateMemoId, getSnapshot, mutate } from "@/lib/store/local-store";
import type { DbDoc, Memo } from "@/lib/store/types";
import { noteBodyToText } from "@/lib/note-body";

/**
 * Pinned first, then wherever you put it.
 *
 * By position rather than by when it was last edited: the list is arranged by
 * hand now, and one that rearranges itself the moment you type into a note is
 * the opposite of that. The id breaks ties so two notes sharing a position do
 * not swap places between renders.
 */
function inReadingOrder(memos: Memo[]): Memo[] {
  return [...memos].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      a.position - b.position ||
      a.id - b.id,
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
    // The words as written: searching raw HTML would match a tag name or an
    // attribute nobody typed, so "p" or "strong" would hit every note.
    const haystack =
      `${memo.title}\n${noteBodyToText(memo.body)}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export async function getMemosByUser(userId: string) {
  return selectMemosByUser(getSnapshot(), userId);
}

/** A new, empty note, ready to be typed into. */
export async function addMemo(
  userId: string,
  title = "",
  body = "",
  parentId: number | null = null,
) {
  return mutate((draft) => {
    const now = new Date();
    // Only a top-level note can be a parent: nesting stops at one level, so a
    // note asked for under a child is put beside it instead.
    const parent = parentId
      ? (draft.memos ?? []).find((m) => m.id === parentId && m.userId === userId)
      : undefined;
    const resolvedParent = parent ? (parent.parentId ?? parent.id) : null;
    // One past the last of its siblings, so a new note joins the end of the
    // level it belongs to rather than the top of everything.
    const lastPosition = (draft.memos ?? [])
      .filter((m) => m.userId === userId && m.parentId === resolvedParent)
      .reduce((max, m) => Math.max(max, m.position), -1);
    const memo: Memo = {
      id: allocateMemoId(draft),
      userId,
      title,
      body,
      pinned: false,
      parentId: resolvedParent,
      position: lastPosition + 1,
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

/**
 * The notes as a two-level list: each top-level note with its children.
 *
 * A child whose parent has been deleted comes back as top-level rather than
 * vanishing — the parent is gone, the writing is not, and a note you cannot
 * find is indistinguishable from one that was lost.
 */
/**
 * Write a hand-made order onto a run of notes.
 *
 * Takes the ids as displayed and numbers them from zero. Only the notes named
 * are touched, so reordering one level leaves every other level alone.
 */
export async function reorderMemos(userId: string, orderedIds: number[]) {
  if (orderedIds.length === 0) return;
  return mutate((draft) => {
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    draft.memos = (draft.memos ?? []).map((m) =>
      m.userId === userId && rank.has(m.id)
        ? { ...m, position: rank.get(m.id)! }
        : m,
    );
  });
}

/** Put a note under another, or back out on its own with `parentId` null. */
export async function setMemoParent(
  id: number,
  userId: string,
  parentId: number | null,
) {
  return mutate((draft) => {
    const memos = draft.memos ?? [];
    const index = memos.findIndex((m) => m.id === id && m.userId === userId);
    if (index === -1) return null;
    // A note with children of its own cannot become a child: that would be the
    // second level of nesting this deliberately does not have.
    if (parentId !== null && memos.some((m) => m.parentId === id)) return null;
    const parent = parentId
      ? memos.find((m) => m.id === parentId && m.userId === userId)
      : undefined;
    const resolved = parent ? (parent.parentId ?? parent.id) : null;
    if (resolved === id) return null;
    const lastPosition = memos
      .filter((m) => m.userId === userId && m.parentId === resolved && m.id !== id)
      .reduce((max, m) => Math.max(max, m.position), -1);
    draft.memos[index] = {
      ...memos[index],
      parentId: resolved,
      // Joins the end of its new level; keeping the old number would have put
      // it in an arbitrary place among its new siblings.
      position: lastPosition + 1,
      updatedAt: new Date(),
    };
    return draft.memos[index];
  });
}

export function selectMemoTree(
  db: DbDoc,
  userId: string,
): Array<{ memo: Memo; children: Memo[] }> {
  const all = selectMemosByUser(db, userId);
  const ids = new Set(all.map((m) => m.id));
  const childrenOf = new Map<number, Memo[]>();
  const roots: Memo[] = [];
  for (const memo of all) {
    if (memo.parentId !== null && ids.has(memo.parentId)) {
      const list = childrenOf.get(memo.parentId) ?? [];
      list.push(memo);
      childrenOf.set(memo.parentId, list);
    } else {
      roots.push(memo);
    }
  }
  return roots.map((memo) => ({
    memo,
    children: childrenOf.get(memo.id) ?? [],
  }));
}

export async function deleteMemo(id: number, userId: string) {
  return mutate((draft) => {
    const before = (draft.memos ?? []).length;
    draft.memos = (draft.memos ?? [])
      .filter((m) => !(m.id === id && m.userId === userId))
      // Children are promoted, not deleted. Removing a heading should not take
      // the pages under it, and a delete that quietly took four other notes
      // with it is the kind of thing you only find out about later.
      .map((m) => (m.parentId === id ? { ...m, parentId: null } : m));
    return draft.memos.length < before;
  });
}
