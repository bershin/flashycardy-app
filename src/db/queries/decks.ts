/**
 * Deck data access.
 *
 * Signatures are unchanged from the Drizzle/Postgres version so that pages and
 * actions did not have to be rewritten around them. Reads delegate to the pure
 * selectors in `src/lib/store/selectors.ts`; writes go through `mutate()`, which
 * persists to IndexedDB and schedules a sync push.
 *
 * These stay `async` even though nothing awaits I/O — every call site already
 * awaits them, so keeping the shape means this layer could become remote again
 * without touching callers.
 */

import { allocateDeckId, getSnapshot, mutate } from "@/lib/store/local-store";
import {
  collectDeckIdsToDelete,
  selectChildDecks,
  selectChildDecksWithCards,
  selectDeckByIdForUser,
  selectDeckCountByUser,
  selectDecksByUser,
  selectDecksWithCardsByUser,
} from "@/lib/store/selectors";
import type { DeckRow } from "@/lib/store/types";

export async function getDecksByUser(userId: string) {
  return selectDecksByUser(getSnapshot(), userId);
}

export async function getDeckCountByUser(userId: string) {
  return selectDeckCountByUser(getSnapshot(), userId);
}

export async function getDeckByIdForUser(deckId: number, userId: string) {
  return selectDeckByIdForUser(getSnapshot(), deckId, userId);
}

export async function getChildDecks(parentId: number, userId: string) {
  return selectChildDecks(getSnapshot(), parentId, userId);
}

export async function getDecksWithCardsByUser(userId: string) {
  return selectDecksWithCardsByUser(getSnapshot(), userId);
}

export async function getChildDecksWithCards(parentId: number, userId: string) {
  return selectChildDecksWithCards(getSnapshot(), parentId, userId);
}

export async function insertDeck(data: {
  title: string;
  description?: string;
  userId: string;
  parentId?: number;
}) {
  return mutate((draft) => {
    // Append after the last sibling, scoped to the same parent (or to the root
    // set). Replaces `coalesce(max(position), -1) + 1`.
    const siblings = draft.decks.filter(
      (d) =>
        d.userId === data.userId &&
        (data.parentId ? d.parentId === data.parentId : d.parentId === null),
    );
    const maxPosition = siblings.reduce(
      (max, d) => Math.max(max, d.position),
      -1,
    );

    const now = new Date();
    const deck: DeckRow = {
      id: allocateDeckId(draft),
      userId: data.userId,
      title: data.title,
      description: data.description ?? null,
      parentId: data.parentId ?? null,
      position: maxPosition + 1,
      lastStudiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    draft.decks.push(deck);
    return deck;
  });
}

export async function reorderDecks(userId: string, orderedIds: number[]) {
  mutate((draft) => {
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    draft.decks = draft.decks.map((deck) =>
      deck.userId === userId && rank.has(deck.id)
        ? { ...deck, position: rank.get(deck.id)! }
        : deck,
    );
  });
}

export async function updateDeck(
  deckId: number,
  userId: string,
  data: { title: string; description?: string | null },
) {
  return mutate((draft) => {
    const index = draft.decks.findIndex(
      (d) => d.id === deckId && d.userId === userId,
    );
    if (index === -1) return undefined;

    const updated: DeckRow = {
      ...draft.decks[index],
      title: data.title,
      description: data.description ?? null,
      updatedAt: new Date(),
    };
    draft.decks[index] = updated;
    return updated;
  });
}

export async function markDeckStudied(deckId: number, userId: string) {
  return mutate((draft) => {
    const index = draft.decks.findIndex(
      (d) => d.id === deckId && d.userId === userId,
    );
    if (index === -1) return undefined;

    // Deliberately does not touch `updatedAt`, matching the original query.
    const updated: DeckRow = {
      ...draft.decks[index],
      lastStudiedAt: new Date(),
    };
    draft.decks[index] = updated;
    return updated;
  });
}

/**
 * Re-parent a deck: into `targetParentId`, or to the top level when that is
 * `null`.
 *
 * The one-level-deep rules are re-checked here rather than trusted from the
 * caller, so a stale picker can't produce a deck nested two levels down or a
 * parent that holds cards of its own. Returns `undefined` if the move isn't
 * allowed.
 */
export async function moveDeck(
  deckId: number,
  userId: string,
  targetParentId: number | null,
) {
  return mutate((draft) => {
    const index = draft.decks.findIndex(
      (d) => d.id === deckId && d.userId === userId,
    );
    if (index === -1) return undefined;

    // Its children would end up two levels deep.
    if (draft.decks.some((d) => d.parentId === deckId)) return undefined;

    if (targetParentId !== null) {
      if (targetParentId === deckId) return undefined;
      const target = draft.decks.find(
        (d) => d.id === targetParentId && d.userId === userId,
      );
      if (!target) return undefined;
      if (target.parentId !== null) return undefined;
      if (draft.cards.some((c) => c.deckId === targetParentId)) return undefined;
    }

    // Append after whatever is already in the destination.
    const maxPosition = draft.decks.reduce(
      (max, d) =>
        d.userId === userId && d.parentId === targetParentId && d.id !== deckId
          ? Math.max(max, d.position)
          : max,
      -1,
    );

    const moved: DeckRow = {
      ...draft.decks[index],
      parentId: targetParentId,
      position: maxPosition + 1,
      updatedAt: new Date(),
    };
    draft.decks[index] = moved;
    return moved;
  });
}

/**
 * Delete a deck along with its sub-decks and every card belonging to any of
 * them.
 *
 * Postgres used to cascade this automatically via a constraint that only ever
 * existed in a hand-written migration. It has to be explicit here — see
 * `collectDeckIdsToDelete`.
 */
export async function deleteDeck(deckId: number, userId: string) {
  return mutate((draft) => {
    const deck = draft.decks.find((d) => d.id === deckId && d.userId === userId);
    if (!deck) return undefined;

    const doomed = new Set(collectDeckIdsToDelete(draft, deckId, userId));
    draft.decks = draft.decks.filter((d) => !doomed.has(d.id));
    draft.cards = draft.cards.filter((c) => !doomed.has(c.deckId));
    return deck;
  });
}
