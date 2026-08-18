import type { GeneratedPayload } from "@/lib/generated-card";

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
 * What kind of card this is, and therefore how it is answered.
 *
 *  - `basic` — front, back, you rate yourself. The original card.
 *  - `quiz`  — a question with options you wrote; picking one grades it
 *              immediately, with no AI and no network.
 *  - `generated` — the shape of a question rather than one instance of it. The
 *              numbers are rolled fresh every time it appears, so the answer
 *              has to be worked out rather than remembered. Graded like a quiz,
 *              and equally offline: the template is stored, not fetched.
 */
export const CARD_TYPES = ["basic", "quiz", "generated"] as const;

export type CardType = (typeof CARD_TYPES)[number];

export type QuizPayload = {
  /** Plain text — rich formatting belongs in the question, not the options. */
  options: string[];
  correctIndex: number;
};

/**
 * How far apart a card's reviews spread as its streak grows.
 *
 *  - `incremental` — a day, then weeks, then months, then a year. Intervals
 *    widen, so something learned cleanly is seen less and less.
 *  - `weekly` — a day, then every five days. Holds a steady cadence instead of
 *    backing off, for material worth keeping warm. Named for the seven days it
 *    used to wait; the stored value is on every card, so it stays as it is.
 *
 * The actual day counts live in `REVIEW_SCHEDULES` in `src/db/queries/cards.ts`,
 * next to the code that applies them.
 */
export const REVIEW_SCHEDULES = ["incremental", "weekly"] as const;

export type ReviewSchedule = (typeof REVIEW_SCHEDULES)[number];

/**
 * What a stored card gets when its document doesn't name a schedule.
 *
 * Stays `incremental` no matter what new cards default to: cards written before
 * schedules existed were being scheduled on the widening ladder, so reading them
 * as anything else would quietly rewrite how they behave.
 */
export const LEGACY_REVIEW_SCHEDULE: ReviewSchedule = "incremental";

/** What a newly created card starts on. */
export const NEW_CARD_SCHEDULE: ReviewSchedule = "weekly";

export type CardRow = {
  id: number;
  deckId: number;
  type: CardType;
  front: string;
  /** The answer for `basic`; an optional explanation for `quiz`. */
  back: string;
  quiz?: QuizPayload;
  /** Present on `generated` cards — the template the numbers are rolled from. */
  generated?: GeneratedPayload;
  schedule: ReviewSchedule;
  nextReviewAt: Date;
  consecutiveCorrect: number;
  /**
   * When the streak last went up. Null for a card that has never been answered
   * correctly, and for cards from documents written before this existed.
   *
   * Kept so the streak can be capped at one step a day: see
   * `recordStudyResult`.
   */
  lastCorrectAt: Date | null;
  /**
   * How many times this card has ever been answered wrong.
   *
   * Cumulative and never reset — the streak already says how it is going now,
   * so this is the counterweight: the card you keep getting wrong reads as
   * difficult even on the day you finally get it right. Cards written before
   * this existed read as 0, which understates them, but inventing a history for
   * them would be worse than starting the count from here.
   */
  timesMissed: number;
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
    Omit<
      CardRow,
      | "type"
      | "schedule"
      | "nextReviewAt"
      | "lastCorrectAt"
      | "timesMissed"
      | "createdAt"
      | "updatedAt"
    > & {
      /**
       * Absent in version-1 documents, and may name a type this build no
       * longer has (vocabulary was removed). Normalised on read.
       */
      type?: string;
      /** Absent before schedules were selectable; normalised on read. */
      schedule?: string;
      nextReviewAt: string;
      /** Absent in documents written before the streak was capped per day. */
      lastCorrectAt?: string | null;
      /** Absent in documents written before misses were counted; reads as 0. */
      timesMissed?: number;
      createdAt: string;
      updatedAt: string;
    }
  >;
};

/**
 * Coerce a stored card type to one this build understands.
 *
 * Covers both directions of drift: version-1 documents have no type at all,
 * and a document written by a build that had vocabulary cards still names it.
 * Either way the card survives as a basic card rather than disappearing or
 * rendering as nothing.
 */
function normaliseType(type: string | undefined): CardType {
  return CARD_TYPES.includes(type as CardType) ? (type as CardType) : "basic";
}

/**
 * Coerce a stored schedule to one this build knows.
 *
 * Cards written before schedules existed have none, and fall back to the
 * incremental ladder — which is exactly how they were already being scheduled,
 * so nothing about their timing changes.
 */
function normaliseSchedule(schedule: string | undefined): ReviewSchedule {
  return REVIEW_SCHEDULES.includes(schedule as ReviewSchedule)
    ? (schedule as ReviewSchedule)
    : LEGACY_REVIEW_SCHEDULE;
}

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
      // Per-card rather than keyed on the document version, so a hand-edited or
      // partially-written file can't produce a card with no usable type.
      type: normaliseType(c.type),
      schedule: normaliseSchedule(c.schedule),
      nextReviewAt: toDate(c.nextReviewAt),
      // A card that predates the stamp reads as never credited, so its next
      // correct answer counts — the cap only ever costs a card one step, and
      // only on a day it has already had one.
      lastCorrectAt: c.lastCorrectAt ? toDate(c.lastCorrectAt) : null,
      // A missing or nonsense count reads as none rather than NaN, which would
      // render as "NaN missed" on the card and poison any arithmetic on it.
      timesMissed: Number.isFinite(c.timesMissed) ? Number(c.timesMissed) : 0,
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
      lastCorrectAt: toIso(c.lastCorrectAt),
      createdAt: toIso(c.createdAt),
      updatedAt: toIso(c.updatedAt),
    })),
  };
}
