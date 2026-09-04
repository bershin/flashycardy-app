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
 *  - `incremental` — the next day, every time. Named for the widening ladder it
 *    used to be, a day out to a year; the stored value is on every card, so it
 *    stays as it is.
 *  - `weekly` — a day, a day, then a week widening out to a year, so something
 *    learned cleanly is seen less and less. Named for the seven days it used to
 *    wait; the stored value is on every card, so it stays as it is.
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
 * schedules existed were being scheduled on that ladder, so reading them as
 * anything else would put them on a cadence they were never given. What the
 * ladder itself says has changed since — it comes back daily now rather than
 * widening — but that is a change to the schedule, not to which one they are on.
 */
export const LEGACY_REVIEW_SCHEDULE: ReviewSchedule = "incremental";

/**
 * What a newly created card starts on: the daily ladder.
 *
 * Same value as {@link LEGACY_REVIEW_SCHEDULE} at the moment, and deliberately
 * a separate constant — they answer different questions. That one says how to
 * read a card written before schedules existed and must never move; this one is
 * a preference about new cards and is expected to. Collapsing them would tie a
 * change of default to a rewrite of every old card's behaviour.
 */
export const NEW_CARD_SCHEDULE: ReviewSchedule = "incremental";

/**
 * Something written against a day rather than against a card.
 *
 * "Mock exam", "no study — away", "revise fractions before Friday". The
 * calendar already knows what is due; this is for what the due list cannot
 * know. A day holds as many as you write, each one able to be ticked off and
 * carried to another day when it doesn't happen.
 *
 * The date is a plain `YYYY-MM-DD` string, not a timestamp. An item belongs to a
 * day as written, and storing an instant would let something typed at eleven at
 * night in London appear on the day before to anyone east of it.
 */
export type DayTodo = {
  id: number;
  userId: string;
  /** `YYYY-MM-DD`, in the writer's own calendar. Changed by moving it. */
  date: string;
  text: string;
  /**
   * Where it sits in its day's list, low first.
   *
   * Only meaningful against the other items of the same day, and only compared,
   * never counted — a day's positions may have gaps after items are moved away.
   */
  position: number;
  /**
   * A time of day to be reminded, `HH:MM`, or null for an item with no time.
   *
   * Local wall-clock like the date, not an instant: "half nine" means half nine
   * wherever you are, and storing a moment would move it when you travel.
   */
  remindAt: string | null;
  /** Marked as mattering more than the rest of its day. */
  important: boolean;
  /**
   * The longer version: what it actually involves, a link, a room number.
   *
   * Empty rather than null for "none" — a textarea produces an empty string
   * when cleared, and a third state between empty and absent would only ever
   * have to be collapsed back to two.
   */
  note: string;
  done: boolean;
  /**
   * When it was ticked off, so a day can show what actually happened on it.
   * Null while it is still open.
   */
  doneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

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
  /** Absent in documents written before day items existed; starts from 1. */
  nextTodoId: number;
  /** Absent in documents written before notes existed; starts from 1. */
  nextMemoId: number;
  decks: DeckRow[];
  cards: CardRow[];
  todos: DayTodo[];
  memos: Memo[];
  /** Null until this collection has been named from a Profiles section. */
  profile: DocProfile | null;
};

/**
 * A written note, as opposed to a thing to do on a day.
 *
 * Stored under `memos` rather than `notes` because `notes` is already taken:
 * day items were called that for an hour early on, and `deserializeDoc` still
 * reads that field so anything typed then survives. Two meanings for one key in
 * the same document is how a migration silently eats someone's writing, so the
 * stored name and the word on screen differ here — the same trade the review
 * schedules make.
 */
export type Memo = {
  id: number;
  userId: string;
  /** May be empty: a note is worth keeping before it has been named. */
  title: string;
  body: string;
  /** Kept at the top of the list, above the by-date ordering. */
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * What this collection calls itself, carried inside the document.
 *
 * Profiles are otherwise device-local — the list, and each one's sync repo and
 * token, live in localStorage and must stay there, because a token has no
 * business in a synced file and because each profile syncs to a *different*
 * repo, so there is no shared place a list of them could live.
 *
 * The name and face are the part that can travel, because they belong to the
 * collection rather than to the browser looking at it. A second device still
 * has to add the profile and paste its token; once it syncs, it learns what to
 * call it instead of the owner retyping the name and picking the emoji again.
 *
 * `updatedAt` is what the merge compares — there is only ever one of these per
 * document, so later simply wins.
 */
export type DocProfile = {
  name: string;
  /** Null rather than absent for "no emoji", so clearing one is a real value. */
  emoji: string | null;
  updatedAt: Date;
};

/** The JSON-safe form of {@link DbDoc}, with ISO strings instead of Dates. */
export type SerializedDbDoc = {
  /** Reads accept 1 and migrate it; writes are always the current version. */
  version: number;
  mutatedAt: string;
  deviceId: string;
  nextDeckId: number;
  nextCardId: number;
  nextTodoId?: number;
  /** Absent in documents written before notes existed; reads as none. */
  nextMemoId?: number;
  /** Absent until the collection has been named; reads as unnamed. */
  profile?: { name: string; emoji?: string | null; updatedAt: string };
  /** Absent in documents written before notes existed; reads as an empty list. */
  memos?: Array<
    Omit<Memo, "pinned" | "createdAt" | "updatedAt"> & {
      /** Absent before notes could be pinned; reads as unpinned. */
      pinned?: boolean;
      createdAt: string;
      updatedAt: string;
    }
  >;
  /**
   * What day items were called for the hour they were one note per day.
   *
   * Read as todos and written back under the new name, so anything typed in
   * that window survives rather than disappearing on the next load. Nothing
   * writes this field.
   */
  notes?: Array<{
    id: number;
    userId: string;
    date: string;
    text: string;
    /** Never present — declared so the two shapes read as one. */
    position?: number;
    remindAt?: string | null;
    important?: boolean;
    note?: string;
    done?: boolean;
    doneAt?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  /** Absent in documents written before day items existed; reads as none. */
  nextNoteId?: number;
  /**
   * `done` and `doneAt` are optional because the first version of this was a
   * single note per day with no way to tick it off. Those read as open items,
   * which is what they were.
   */
  todos?: Array<
    Omit<
      DayTodo,
      | "position"
      | "remindAt"
      | "important"
      | "note"
      | "done"
      | "doneAt"
      | "createdAt"
      | "updatedAt"
    > & {
      /** Absent before the list could be reordered; falls back to the id. */
      position?: number;
      /** Absent before items could carry a time; reads as none. */
      remindAt?: string | null;
      /** Absent before items could be starred; reads as ordinary. */
      important?: boolean;
      /** Absent before items could carry a note; reads as none. */
      note?: string;
      done?: boolean;
      doneAt?: string | null;
      createdAt: string;
      updatedAt: string;
    }
  >;
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
    nextTodoId: 1,
    nextMemoId: 1,
    decks: [],
    cards: [],
    todos: [],
    memos: [],
    profile: null,
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
    nextMemoId: raw.nextMemoId ?? (raw.memos?.length ?? 0) + 1,
    profile: raw.profile
      ? {
          name: raw.profile.name,
          emoji: raw.profile.emoji ?? null,
          updatedAt: new Date(raw.profile.updatedAt),
        }
      : null,
    memos: (raw.memos ?? []).map((m) => ({
      id: m.id,
      userId: m.userId,
      title: m.title,
      body: m.body,
      pinned: m.pinned ?? false,
      createdAt: new Date(m.createdAt),
      updatedAt: new Date(m.updatedAt),
    })),
    nextTodoId:
      raw.nextTodoId ??
      raw.nextNoteId ??
      (raw.todos?.length ?? raw.notes?.length ?? 0) + 1,
    // A document from the note-per-day hour has `notes` and no `todos`; its
    // entries are exactly todos that were never able to be ticked off.
    todos: (raw.todos ?? raw.notes ?? []).map((t) => ({
      ...t,
      // Ids rise with creation, so falling back to one keeps a list written
      // before ordering existed in exactly the order it was written.
      position: t.position ?? t.id,
      remindAt: t.remindAt ?? null,
      important: t.important ?? false,
      note: t.note ?? "",
      done: t.done ?? false,
      doneAt: t.doneAt ? toDate(t.doneAt) : null,
      createdAt: toDate(t.createdAt),
      updatedAt: toDate(t.updatedAt),
    })),
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
    nextTodoId: doc.nextTodoId,
    nextMemoId: doc.nextMemoId,
    profile: doc.profile
      ? { ...doc.profile, updatedAt: toIso(doc.profile.updatedAt) }
      : undefined,
    memos: doc.memos.map((m) => ({
      ...m,
      createdAt: toIso(m.createdAt),
      updatedAt: toIso(m.updatedAt),
    })),
    todos: doc.todos.map((t) => ({
      ...t,
      doneAt: toIso(t.doneAt),
      createdAt: toIso(t.createdAt),
      updatedAt: toIso(t.updatedAt),
    })),
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
