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
  isArchive: boolean;
};

/**
 * Cards that have been answered correctly five times in a row are moved here
 * rather than deleted.
 *
 * The archive is an ordinary top-level deck holding one sub-deck per source
 * deck, which is the only shape that fits the one-level-deep rule: the root
 * carries no cards of its own, and each child keeps the archived cards from the
 * deck of the same name. Being ordinary decks means they can be opened, edited
 * and studied deliberately, and they survive deletion of the deck the cards
 * came from.
 *
 * It is identified by title rather than a flag on the row, so that no migration
 * is needed for existing data.
 */
export const ARCHIVE_DECK_TITLE = "Archive";

export function selectArchiveRoot(
  db: DbDoc,
  userId: string,
): DeckRow | undefined {
  return db.decks.find(
    (d) =>
      d.userId === userId &&
      d.parentId === null &&
      d.title === ARCHIVE_DECK_TITLE,
  );
}

/** True for the archive root and for any of its sub-decks. */
export function isArchiveDeck(db: DbDoc, deck: DeckRow): boolean {
  const root = selectArchiveRoot(db, deck.userId);
  if (!root) return false;
  return deck.id === root.id || deck.parentId === root.id;
}

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

  const archiveRoot = selectArchiveRoot(db, userId);

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
      isArchive: archiveRoot !== undefined && deck.id === archiveRoot.id,
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

export type MoveTarget = {
  id: number;
  title: string;
  /** Parent title when the deck is a sub-deck, for disambiguation in lists. */
  parentTitle: string | null;
  isArchive: boolean;
  cardCount: number;
};

/**
 * Decks a card can be moved into.
 *
 * Excludes the deck the card is already in, and any deck that has sub-decks —
 * a parent's card list is the union of its children's, so it has nowhere of its
 * own to put a card. Archive decks are included: pulling something back out of
 * the archive to relearn it is a reasonable thing to want.
 */
export function selectMoveTargets(
  db: DbDoc,
  userId: string,
  excludeDeckId: number,
): MoveTarget[] {
  const parentIds = new Set(
    db.decks.map((d) => d.parentId).filter((id): id is number => id !== null),
  );
  const byId = new Map(db.decks.map((d) => [d.id, d]));
  const cardCounts = new Map<number, number>();
  for (const card of db.cards) {
    cardCounts.set(card.deckId, (cardCounts.get(card.deckId) ?? 0) + 1);
  }

  return db.decks
    .filter(
      (d) =>
        d.userId === userId && d.id !== excludeDeckId && !parentIds.has(d.id),
    )
    .map((d) => ({
      id: d.id,
      title: d.title,
      parentTitle: d.parentId ? (byId.get(d.parentId)?.title ?? null) : null,
      isArchive: isArchiveDeck(db, d),
      cardCount: cardCounts.get(d.id) ?? 0,
    }))
    .sort((a, b) => {
      // Archive last — it is rarely the intended destination.
      if (a.isArchive !== b.isArchive) return a.isArchive ? 1 : -1;
      const aPath = `${a.parentTitle ?? ""}${a.title}`;
      const bPath = `${b.parentTitle ?? ""}${b.title}`;
      return aPath.localeCompare(bPath);
    });
}

export type DeckMoveTarget = {
  id: number;
  title: string;
  isArchive: boolean;
  childCount: number;
};

export type DeckMoveOptions = {
  /** Set when the deck cannot be moved at all; explains why, for the UI. */
  blocked: string | null;
  /** Only meaningful for a deck that is currently a sub-deck. */
  canMoveToTopLevel: boolean;
  targets: DeckMoveTarget[];
};

/**
 * Where a deck can be moved to.
 *
 * The one-level-deep rule does most of the work here:
 *
 *  - a deck that has sub-decks can't move under anything, because its children
 *    would land two levels deep;
 *  - only top-level decks can receive it, for the same reason;
 *  - a deck holding cards of its own can't receive it, because a parent's card
 *    list is the union of its children's and it has nowhere to keep its own.
 */
export function selectDeckMoveOptions(
  db: DbDoc,
  userId: string,
  deckId: number,
): DeckMoveOptions {
  const deck = db.decks.find((d) => d.id === deckId && d.userId === userId);
  if (!deck) {
    return { blocked: "Deck not found.", canMoveToTopLevel: false, targets: [] };
  }

  const children = db.decks.filter((d) => d.parentId === deckId);
  if (children.length > 0) {
    return {
      blocked:
        "This deck has sub-decks, and decks can only be one level deep. Move its sub-decks out first.",
      canMoveToTopLevel: false,
      targets: [],
    };
  }

  const decksWithCards = new Set(db.cards.map((c) => c.deckId));
  const childCounts = new Map<number, number>();
  for (const d of db.decks) {
    if (d.parentId !== null) {
      childCounts.set(d.parentId, (childCounts.get(d.parentId) ?? 0) + 1);
    }
  }

  const targets = db.decks
    .filter(
      (d) =>
        d.userId === userId &&
        d.id !== deckId &&
        d.parentId === null &&
        d.id !== deck.parentId &&
        !decksWithCards.has(d.id),
    )
    .map((d) => ({
      id: d.id,
      title: d.title,
      isArchive: isArchiveDeck(db, d),
      childCount: childCounts.get(d.id) ?? 0,
    }))
    .sort((a, b) => {
      if (a.isArchive !== b.isArchive) return a.isArchive ? 1 : -1;
      return a.title.localeCompare(b.title);
    });

  return {
    blocked: null,
    canMoveToTopLevel: deck.parentId !== null,
    targets,
  };
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
 * Start of tomorrow — a card is due when its next review falls strictly before
 * this.
 *
 * The comparison has to be strict. `addDays(startOfDay(now), 1)` lands exactly
 * on this boundary, so a `<=` test would count every "review tomorrow" card as
 * due today and they would never leave the queue.
 */
export function dueCutoff(): Date {
  const cutoff = startOfDay(new Date());
  cutoff.setDate(cutoff.getDate() + 1);
  return cutoff;
}

/**
 * The far edge of "due tomorrow" — the start of the day after next.
 *
 * Everything before this is tomorrow's workload, today's cards included: a card
 * due today that isn't studied is still waiting tomorrow, on top of whatever
 * tomorrow brings. Counting only the cards dated tomorrow described a morning
 * that only happens if today is cleared first.
 */
export function tomorrowCutoff(): Date {
  const cutoff = startOfDay(new Date());
  cutoff.setDate(cutoff.getDate() + 2);
  return cutoff;
}

/** Cards whose next review falls today or earlier. */
export function selectDueCardsByDeckForUser(
  db: DbDoc,
  deckId: number,
  userId: string,
): CardRow[] {
  const cutoff = dueCutoff();

  return selectCardsByDeckForUser(db, deckId, userId).filter(
    (c) => c.nextReviewAt < cutoff,
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
