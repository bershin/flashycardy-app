/**
 * Pure read logic over a {@link DbDoc}.
 *
 * These are the former Drizzle queries with the SQL removed. They live apart
 * from `src/db/queries/*` because pages read them synchronously off a store
 * snapshot while actions call them through the async helpers — keeping the
 * logic here means the deck/card rollups exist exactly once.
 *
 * The `userId` argument is retained throughout even though the app is now
 * single-user: it keeps the ownership filters that the old schema enforced,
 * so a corrupt or hand-edited data.json can't leak rows between users.
 */

import type { CardRow, DbDoc, DeckRow } from "./types";

export type DeckWithCards = DeckRow & {
  cards: CardRow[];
  childCount: number;
};

/** `WHERE deckId IN (SELECT id FROM decks WHERE userId = ?)` */
function ownedDeckIds(db: DbDoc, userId: string): Set<number> {
  const ids = new Set<number>();
  for (const deck of db.decks) {
    if (deck.userId === userId) ids.add(deck.id);
  }
  return ids;
}

export function selectDecksByUser(db: DbDoc, userId: string): DeckRow[] {
  return db.decks.filter((d) => d.userId === userId);
}

/** Counts top-level decks only — mirrors the old `isNull(decks.parentId)`. */
export function selectDeckCountByUser(db: DbDoc, userId: string): number {
  return db.decks.filter((d) => d.userId === userId && d.parentId === null)
    .length;
}

export function selectDeckByIdForUser(
  db: DbDoc,
  deckId: number,
  userId: string,
): DeckRow | undefined {
  return db.decks.find((d) => d.id === deckId && d.userId === userId);
}

export function selectChildDecks(
  db: DbDoc,
  parentId: number,
  userId: string,
): DeckRow[] {
  return db.decks
    .filter((d) => d.parentId === parentId && d.userId === userId)
    .sort((a, b) => a.position - b.position);
}

/**
 * Top-level decks with their cards rolled up.
 *
 * A parent deck reports the union of its children's cards and the most recent
 * `lastStudiedAt` across them; child decks are folded in rather than returned
 * on their own. This mirrors the previous behaviour exactly, including the fact
 * that a parent's card list is in child order rather than sorted.
 */
export function selectDecksWithCardsByUser(
  db: DbDoc,
  userId: string,
): DeckWithCards[] {
  const userDecks = selectDecksByUser(db, userId);
  if (userDecks.length === 0) return [];

  const deckIds = new Set(userDecks.map((d) => d.id));
  const cardsByDeck = new Map<number, CardRow[]>();
  for (const card of db.cards) {
    if (!deckIds.has(card.deckId)) continue;
    const list = cardsByDeck.get(card.deckId) ?? [];
    list.push(card);
    cardsByDeck.set(card.deckId, list);
  }

  const topLevel = userDecks
    .filter((d) => d.parentId === null)
    .sort((a, b) => a.position - b.position);

  const childrenByParent = new Map<number, DeckRow[]>();
  for (const child of userDecks) {
    if (child.parentId === null) continue;
    const list = childrenByParent.get(child.parentId) ?? [];
    list.push(child);
    childrenByParent.set(child.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.position - b.position);
  }

  return topLevel.map((deck) => {
    const deckChildren = childrenByParent.get(deck.id) ?? [];
    const isParent = deckChildren.length > 0;

    let deckCards: CardRow[] = [];
    let lastStudiedAt = deck.lastStudiedAt;

    if (isParent) {
      for (const child of deckChildren) {
        deckCards = deckCards.concat(cardsByDeck.get(child.id) ?? []);
        if (
          child.lastStudiedAt &&
          (!lastStudiedAt || child.lastStudiedAt > lastStudiedAt)
        ) {
          lastStudiedAt = child.lastStudiedAt;
        }
      }
    } else {
      deckCards = cardsByDeck.get(deck.id) ?? [];
    }

    return {
      ...deck,
      lastStudiedAt,
      cards: deckCards,
      childCount: deckChildren.length,
    };
  });
}

export function selectChildDecksWithCards(
  db: DbDoc,
  parentId: number,
  userId: string,
): Array<DeckRow & { cards: CardRow[] }> {
  const childDecks = selectChildDecks(db, parentId, userId);
  if (childDecks.length === 0) return [];

  const childIds = new Set(childDecks.map((d) => d.id));
  const cardsByDeck = new Map<number, CardRow[]>();
  for (const card of db.cards) {
    if (!childIds.has(card.deckId)) continue;
    const list = cardsByDeck.get(card.deckId) ?? [];
    list.push(card);
    cardsByDeck.set(card.deckId, list);
  }

  return childDecks.map((deck) => ({
    ...deck,
    cards: cardsByDeck.get(deck.id) ?? [],
  }));
}

/** Newest-updated first, matching the old `orderBy(desc(cards.updatedAt))`. */
export function selectCardsByDeckForUser(
  db: DbDoc,
  deckId: number,
  userId: string,
): CardRow[] {
  const deck = selectDeckByIdForUser(db, deckId, userId);
  if (!deck) return [];
  return db.cards
    .filter((c) => c.deckId === deckId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function selectCardByIdForUser(
  db: DbDoc,
  cardId: number,
  userId: string,
): CardRow | undefined {
  const owned = ownedDeckIds(db, userId);
  return db.cards.find((c) => c.id === cardId && owned.has(c.deckId));
}

/**
 * Cards due for review, i.e. `nextReviewAt` on or before the end of today.
 * The cutoff is the start of tomorrow, matching the original query.
 */
export function selectDueCardsByDeckForUser(
  db: DbDoc,
  deckId: number,
  userId: string,
): CardRow[] {
  const cutoff = startOfDay(new Date());
  cutoff.setDate(cutoff.getDate() + 1);

  return selectCardsByDeckForUser(db, deckId, userId).filter(
    (c) => c.nextReviewAt <= cutoff,
  );
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Every deck id removed when `deckId` is deleted: the deck itself plus its
 * children.
 *
 * Postgres used to do this via `ON DELETE CASCADE` on `decks.parentId` — a
 * constraint that only ever existed in the hand-written migration
 * `drizzle/0001_previous_firestar.sql` and was never reflected in
 * `src/db/schema.ts`. Without this the sub-decks and their cards would be
 * orphaned, contradicting the delete confirmation copy in `deck-header.tsx`.
 */
export function collectDeckIdsToDelete(
  db: DbDoc,
  deckId: number,
  userId: string,
): number[] {
  const ids = [deckId];
  for (const deck of db.decks) {
    if (deck.parentId === deckId && deck.userId === userId) ids.push(deck.id);
  }
  return ids;
}
