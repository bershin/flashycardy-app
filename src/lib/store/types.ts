/**
 * Shape of the local database.
 *
 * Field names mirror the old Postgres schema exactly so that the query helpers
 * in `src/db/queries/*` can keep returning the same objects the UI already
 * expects. Timestamps are real `Date` instances in memory — the UI calls
 * `.toLocaleDateString()` and compares them with `<=` directly — and are
 * serialized to ISO strings on the way into JSON.
 */

export type DeckRow = {
  id: number;
  userId: string;
  title: string;
  description: string | null;
  parentId: number | null;
  position: number;
  lastStudiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CardRow = {
  id: number;
  deckId: number;
  front: string;
  back: string;
  nextReviewAt: Date;
  consecutiveCorrect: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DbDoc = {
  version: 1;
  /** Document-level mutation stamp, used for sync conflict detection. */
  mutatedAt: Date;
  /** Which device wrote last. Helps make conflict prompts intelligible. */
  deviceId: string;
  /** Replaces Postgres `GENERATED ALWAYS AS IDENTITY`. */
  nextDeckId: number;
  nextCardId: number;
  decks: DeckRow[];
  cards: CardRow[];
};

/** The JSON-safe form of {@link DbDoc}, with ISO strings instead of Dates. */
export type SerializedDbDoc = {
  version: 1;
  mutatedAt: string;
  deviceId: string;
  nextDeckId: number;
  nextCardId: number;
  decks: Array<Omit<DeckRow, "lastStudiedAt" | "createdAt" | "updatedAt"> & {
    lastStudiedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  cards: Array<
    Omit<CardRow, "nextReviewAt" | "createdAt" | "updatedAt"> & {
      nextReviewAt: string;
      createdAt: string;
      updatedAt: string;
    }
  >;
};

export function emptyDoc(deviceId: string): DbDoc {
  return {
    version: 1,
    mutatedAt: new Date(),
    deviceId,
    nextDeckId: 1,
    nextCardId: 1,
    decks: [],
    cards: [],
  };
}

function toDate(value: string): Date;
function toDate(value: string | null): Date | null;
function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toIso(value: Date): string;
function toIso(value: Date | null): string | null;
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * Revive a parsed JSON document into a {@link DbDoc}.
 *
 * This is not optional politeness: the dashboard does
 * `deck.updatedAt.toLocaleDateString("en-US")` and `c.nextReviewAt <= endOfToday`,
 * both of which break on raw strings (the latter silently, by comparing
 * lexicographically).
 */
export function deserializeDoc(raw: SerializedDbDoc): DbDoc {
  return {
    version: 1,
    mutatedAt: toDate(raw.mutatedAt),
    deviceId: raw.deviceId,
    nextDeckId: raw.nextDeckId,
    nextCardId: raw.nextCardId,
    decks: raw.decks.map((d) => ({
      ...d,
      lastStudiedAt: toDate(d.lastStudiedAt),
      createdAt: toDate(d.createdAt),
      updatedAt: toDate(d.updatedAt),
    })),
    cards: raw.cards.map((c) => ({
      ...c,
      nextReviewAt: toDate(c.nextReviewAt),
      createdAt: toDate(c.createdAt),
      updatedAt: toDate(c.updatedAt),
    })),
  };
}

export function serializeDoc(doc: DbDoc): SerializedDbDoc {
  return {
    version: 1,
    mutatedAt: toIso(doc.mutatedAt),
    deviceId: doc.deviceId,
    nextDeckId: doc.nextDeckId,
    nextCardId: doc.nextCardId,
    decks: doc.decks.map((d) => ({
      ...d,
      lastStudiedAt: toIso(d.lastStudiedAt),
      createdAt: toIso(d.createdAt),
      updatedAt: toIso(d.updatedAt),
    })),
    cards: doc.cards.map((c) => ({
      ...c,
      nextReviewAt: toIso(c.nextReviewAt),
      createdAt: toIso(c.createdAt),
      updatedAt: toIso(c.updatedAt),
    })),
  };
}
