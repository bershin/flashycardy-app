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

/**
 * What kind of card this is, and therefore how it is answered and graded.
 *
 *  - `basic` — front, back, you rate yourself. The original card.
 *  - `quiz`  — a question with options you wrote; picking one grades it
 *              immediately, with no AI and no network.
 *  - `vocab` — a word; you supply synonyms and a sentence and the AI judges
 *              them. The only type that needs a key and a connection.
 */
export type CardType = "basic" | "quiz" | "vocab";

export type QuizPayload = {
  /** Plain text — rich formatting belongs in the question, not the options. */
  options: string[];
  correctIndex: number;
};

export type VocabPayload = {
  /** Optional steer for the grader, e.g. "the musical sense, not the verb". */
  senseHint?: string;
};

export type CardRow = {
  id: number;
  deckId: number;
  type: CardType;
  /** The question for every type; the word itself for `vocab`. */
  front: string;
  /** The answer for `basic`; an optional explanation for `quiz` and `vocab`. */
  back: string;
  quiz?: QuizPayload;
  vocab?: VocabPayload;
  nextReviewAt: Date;
  consecutiveCorrect: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Bumped to 2 when cards gained a `type`. A version-1 document is migrated on
 * read by `deserializeDoc`; nothing ever writes version 1 again.
 *
 * Because the document is synced, a device still running a build that predates
 * this would not understand a version-2 file — deploy everywhere before syncing
 * after an upgrade.
 */
export const DOC_VERSION = 2;

export type DbDoc = {
  version: typeof DOC_VERSION;
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
  /** Reads accept 1 and migrate it; writes are always the current version. */
  version: number;
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
    Omit<CardRow, "type" | "nextReviewAt" | "createdAt" | "updatedAt"> & {
      /** Absent in version-1 documents; migrated to "basic" on read. */
      type?: CardType;
      nextReviewAt: string;
      createdAt: string;
      updatedAt: string;
    }
  >;
};

export function emptyDoc(deviceId: string): DbDoc {
  return {
    version: DOC_VERSION,
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
    version: DOC_VERSION,
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
      // Version 1 predates card types: everything in it is a basic card. The
      // fallback is per-card rather than keyed on the document version so a
      // hand-edited or partially-written file can't produce a typeless card.
      type: c.type ?? "basic",
      nextReviewAt: toDate(c.nextReviewAt),
      createdAt: toDate(c.createdAt),
      updatedAt: toDate(c.updatedAt),
    })),
  };
}

export function serializeDoc(doc: DbDoc): SerializedDbDoc {
  return {
    version: DOC_VERSION,
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
