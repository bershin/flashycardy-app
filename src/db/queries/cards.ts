/**
 * Card data access.
 *
 * Same contract as the previous Drizzle version, including the quiet ones:
 * ownership violations return `undefined` rather than throwing, and
 * `recordStudyResult` is tri-state (see below).
 */

import { allocateCardId, getSnapshot, mutate } from "@/lib/store/local-store";
import {
  addDays,
  selectCardByIdForUser,
  selectCardsByDeckForUser,
  selectDueCardsByDeckForUser,
  startOfDay,
} from "@/lib/store/selectors";
import type { CardRow, DbDoc } from "@/lib/store/types";

/** `WHERE deckId IN (SELECT id FROM decks WHERE userId = ?)` */
function ownsCard(draft: DbDoc, card: CardRow, userId: string): boolean {
  return draft.decks.some((d) => d.id === card.deckId && d.userId === userId);
}

export async function getCardsByDeckForUser(deckId: number, userId: string) {
  return selectCardsByDeckForUser(getSnapshot(), deckId, userId);
}

export async function getCardByIdForUser(cardId: number, userId: string) {
  return selectCardByIdForUser(getSnapshot(), cardId, userId);
}

/**
 * Insert a card. As before, this performs no ownership check of its own — both
 * call sites verify the deck belongs to the user first.
 */
export async function insertCard(data: {
  deckId: number;
  front: string;
  back: string;
}) {
  return mutate((draft) => {
    const now = new Date();
    const card: CardRow = {
      id: allocateCardId(draft),
      deckId: data.deckId,
      front: data.front,
      back: data.back,
      nextReviewAt: now,
      consecutiveCorrect: 0,
      createdAt: now,
      updatedAt: now,
    };
    draft.cards.push(card);
    return card;
  });
}

export async function bulkInsertCards(
  rows: { deckId: number; front: string; back: string }[],
) {
  if (rows.length === 0) return [];

  return mutate((draft) => {
    const now = new Date();
    const inserted = rows.map((row) => {
      const card: CardRow = {
        id: allocateCardId(draft),
        deckId: row.deckId,
        front: row.front,
        back: row.back,
        nextReviewAt: now,
        consecutiveCorrect: 0,
        createdAt: now,
        updatedAt: now,
      };
      draft.cards.push(card);
      return card;
    });
    return inserted;
  });
}

export async function updateCard(
  cardId: number,
  userId: string,
  data: { front?: string; back?: string },
) {
  return mutate((draft) => {
    const index = draft.cards.findIndex((c) => c.id === cardId);
    if (index === -1) return undefined;
    if (!ownsCard(draft, draft.cards[index], userId)) return undefined;

    const updated: CardRow = {
      ...draft.cards[index],
      ...(data.front !== undefined ? { front: data.front } : {}),
      ...(data.back !== undefined ? { back: data.back } : {}),
      updatedAt: new Date(),
    };
    draft.cards[index] = updated;
    return updated;
  });
}

export async function getDueCardsByDeckForUser(deckId: number, userId: string) {
  return selectDueCardsByDeckForUser(getSnapshot(), deckId, userId);
}

/**
 * Record a study rating and reschedule the card.
 *
 *  - `missed`  → streak resets, review again tomorrow
 *  - `got_it`  → streak + 1; from the second correct answer the interval jumps
 *                to a week
 *  - five correct in a row → the card has been learned and is **deleted**
 *
 * Returns `null` when the card graduated and was removed, `undefined` when the
 * card isn't the user's, and the updated card otherwise. `study-session.tsx`
 * relies on all three.
 */
export async function recordStudyResult(
  cardId: number,
  userId: string,
  rating: "got_it" | "missed",
) {
  const existing = await getCardByIdForUser(cardId, userId);
  if (!existing) throw new Error("Card not found");

  const now = new Date();
  const today = startOfDay(now);
  let consecutiveCorrect: number;
  let nextReviewAt: Date;

  if (rating === "missed") {
    consecutiveCorrect = 0;
    nextReviewAt = addDays(today, 1);
  } else {
    consecutiveCorrect = existing.consecutiveCorrect + 1;

    if (consecutiveCorrect >= 5) {
      await deleteCard(cardId, userId);
      return null;
    }

    nextReviewAt = consecutiveCorrect >= 2 ? addDays(today, 7) : addDays(today, 1);
  }

  return mutate((draft) => {
    const index = draft.cards.findIndex((c) => c.id === cardId);
    if (index === -1) return undefined;
    if (!ownsCard(draft, draft.cards[index], userId)) return undefined;

    const updated: CardRow = {
      ...draft.cards[index],
      consecutiveCorrect,
      nextReviewAt,
      updatedAt: now,
    };
    draft.cards[index] = updated;
    return updated;
  });
}

export async function deleteCard(cardId: number, userId: string) {
  return mutate((draft) => {
    const card = draft.cards.find((c) => c.id === cardId);
    if (!card) return undefined;
    if (!ownsCard(draft, card, userId)) return undefined;

    draft.cards = draft.cards.filter((c) => c.id !== cardId);
    return card;
  });
}
