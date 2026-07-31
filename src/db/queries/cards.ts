/**
 * Card data access.
 *
 * Same contract as the previous Drizzle version, including the quiet ones:
 * ownership violations return `undefined` rather than throwing, and
 * `recordStudyResult` is tri-state (see below).
 */

import {
  allocateCardId,
  allocateDeckId,
  getSnapshot,
  mutate,
} from "@/lib/store/local-store";
import {
  ARCHIVE_DECK_TITLE,
  addDays,
  isArchiveDeck,
  selectArchiveRoot,
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
 * Days until the next review, indexed by streak — element 0 is the wait after
 * the first correct answer, element 1 after the second, and so on.
 *
 * The ladder widens so each success buys progressively more time: a day, a
 * week, two weeks, three weeks. Running off the end of the table means the card
 * has been learned and is archived, so adding another interval here
 * automatically extends the schedule rather than requiring two edits.
 */
const REVIEW_INTERVAL_DAYS = [1, 7, 14, 21];

/** Correct answers in a row before a card is considered learned. */
const GRADUATION_STREAK = REVIEW_INTERVAL_DAYS.length + 1;

/**
 * Move a learned card into the archive.
 *
 * Creates the archive root and the per-source sub-deck on demand, then moves the
 * card across and resets its streak. Everything happens inside a single
 * `mutate` so a half-built archive can never be persisted or synced.
 *
 * A card already in the archive stays where it is — re-studying archived
 * material should not shuffle it around.
 */
function archiveCard(cardId: number, userId: string): CardRow | undefined {
  return mutate((draft) => {
    const index = draft.cards.findIndex((c) => c.id === cardId);
    if (index === -1) return undefined;

    const card = draft.cards[index];
    const sourceDeck = draft.decks.find((d) => d.id === card.deckId);
    if (!sourceDeck || sourceDeck.userId !== userId) return undefined;

    const now = new Date();
    const reset: CardRow = {
      ...card,
      consecutiveCorrect: 0,
      updatedAt: now,
    };

    if (isArchiveDeck(draft, sourceDeck)) {
      draft.cards[index] = reset;
      return reset;
    }

    let root = selectArchiveRoot(draft, userId);
    if (!root) {
      const maxPosition = draft.decks.reduce(
        (max, d) => (d.userId === userId && d.parentId === null ? Math.max(max, d.position) : max),
        -1,
      );
      root = {
        id: allocateDeckId(draft),
        userId,
        title: ARCHIVE_DECK_TITLE,
        description: "Cards you have learned. Kept for reference.",
        parentId: null,
        position: maxPosition + 1,
        lastStudiedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      draft.decks.push(root);
    }

    // Matched by title, so cards from the same deck keep landing together even
    // after the source deck is renamed or deleted and recreated.
    let target = draft.decks.find(
      (d) => d.parentId === root.id && d.title === sourceDeck.title,
    );
    if (!target) {
      const maxPosition = draft.decks.reduce(
        (max, d) => (d.parentId === root!.id ? Math.max(max, d.position) : max),
        -1,
      );
      target = {
        id: allocateDeckId(draft),
        userId,
        title: sourceDeck.title,
        description: null,
        parentId: root.id,
        position: maxPosition + 1,
        lastStudiedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      draft.decks.push(target);
    }

    const archived: CardRow = { ...reset, deckId: target.id };
    draft.cards[index] = archived;
    return archived;
  });
}

/**
 * Record a study rating and reschedule the card.
 *
 *  - `missed`  → streak resets, review again tomorrow
 *  - `got_it`  → streak + 1, next review taken from `REVIEW_INTERVAL_DAYS`
 *                (1 day → 1 week → 2 weeks → 3 weeks)
 *  - five correct in a row → the card is **archived** (see `archiveCard`)
 *
 * Returns `null` when the card graduated into the archive, `undefined` when the
 * card isn't the user's, and the updated card otherwise. `study-session.tsx`
 * relies on all three — `null` is what removes the card from the running
 * session.
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

    if (consecutiveCorrect >= GRADUATION_STREAK) {
      archiveCard(cardId, userId);
      return null;
    }

    nextReviewAt = addDays(today, REVIEW_INTERVAL_DAYS[consecutiveCorrect - 1]);
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
