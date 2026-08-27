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
import type { GeneratedPayload } from "@/lib/generated-card";
import {
  NEW_CARD_SCHEDULE,
  type CardRow,
  type CardType,
  type DbDoc,
  type QuizPayload,
  type ReviewSchedule,
} from "@/lib/store/types";

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
  type?: CardType;
  quiz?: QuizPayload;
  generated?: GeneratedPayload;
  schedule?: ReviewSchedule;
}) {
  return mutate((draft) => {
    const now = new Date();
    const card: CardRow = {
      id: allocateCardId(draft),
      deckId: data.deckId,
      type: data.type ?? "basic",
      front: data.front,
      back: data.back,
      schedule: data.schedule ?? NEW_CARD_SCHEDULE,
      ...(data.quiz ? { quiz: data.quiz } : {}),
      ...(data.generated ? { generated: data.generated } : {}),
      nextReviewAt: now,
      consecutiveCorrect: 0,
      lastCorrectAt: null,
      timesMissed: 0,
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
        type: "basic",
        front: row.front,
        back: row.back,
        schedule: NEW_CARD_SCHEDULE,
        nextReviewAt: now,
        consecutiveCorrect: 0,
        lastCorrectAt: null,
        timesMissed: 0,
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
  data: {
    front?: string;
    back?: string;
    type?: CardType;
    quiz?: QuizPayload;
    generated?: GeneratedPayload;
    schedule?: ReviewSchedule;
  },
) {
  return mutate((draft) => {
    const index = draft.cards.findIndex((c) => c.id === cardId);
    if (index === -1) return undefined;
    if (!ownsCard(draft, draft.cards[index], userId)) return undefined;

    const current = draft.cards[index];
    const type = data.type ?? current.type;

    const updated: CardRow = {
      ...current,
      type,
      ...(data.front !== undefined ? { front: data.front } : {}),
      ...(data.back !== undefined ? { back: data.back } : {}),
      // Changing the schedule re-aims future reviews without disturbing the
      // streak already earned or the date the card is currently waiting on.
      schedule: data.schedule ?? current.schedule,
      updatedAt: new Date(),
      // The payload follows the type, so switching a card away from quiz
      // doesn't leave orphaned options behind to reappear if it switches back.
      quiz: type === "quiz" ? (data.quiz ?? current.quiz) : undefined,
      generated:
        type === "generated"
          ? (data.generated ?? current.generated)
          : undefined,
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
 * Both ladders open with a single day, because one night's sleep is the point
 * of the first repetition. They are deliberately different lengths after that:
 *
 *  - `incremental` widens all the way out to a year, so something learned
 *    cleanly drops out of the way while still being checked occasionally. Eight
 *    rungs, so it graduates on the ninth correct answer, roughly two years after
 *    the card was first seen.
 *  - `weekly` holds at five days and stops after four, since a card meant to
 *    come back at a fixed cadence has nothing to prove by running longer. The
 *    name is kept for the stored value — every card already carries it, and a
 *    rename would be a migration for a word.
 *
 * Running off the end of a ladder means the card has been learned and is
 * archived, so adding a rung extends that schedule rather than needing a second
 * edit somewhere else. Nothing assumes the two are the same length —
 * `graduationStreak` derives each from its own ladder.
 */
const REVIEW_SCHEDULES: Record<ReviewSchedule, readonly number[]> = {
  incremental: [1, 7, 14, 21, 30, 90, 180, 365],
  // Three rungs, so the fourth correct answer archives the card: a day to see
  // it again, then two five-day gaps to prove it stuck.
  weekly: [1, 5, 5],
};

/** How soon a missed card comes back round. */
const MISSED_REVIEW_MINUTES = 10;

function intervalsFor(schedule: ReviewSchedule): readonly number[] {
  return REVIEW_SCHEDULES[schedule] ?? REVIEW_SCHEDULES.incremental;
}

/**
 * Correct answers in a row before a card on this schedule is learned.
 *
 * Exported so the card form can state the number rather than hard-coding it —
 * the ladders are different lengths, and prose that says "five" goes stale the
 * moment one of them gains a rung.
 */
export function graduationStreak(schedule: ReviewSchedule): number {
  return intervalsFor(schedule).length + 1;
}

/**
 * Cards that have already earned their place in the archive but are still out.
 *
 * Normally impossible: a card is archived the moment its streak reaches the
 * ladder's end. It becomes possible when a ladder is *shortened* — every card
 * that had climbed past the new top is suddenly learned by the new rule, but
 * nothing has asked it a question since, so nothing has noticed.
 */
export function selectLearnedButUnarchived(
  db: DbDoc,
  userId: string,
): CardRow[] {
  const owned = new Map(
    db.decks.filter((d) => d.userId === userId).map((d) => [d.id, d]),
  );
  return db.cards.filter((card) => {
    const deck = owned.get(card.deckId);
    if (!deck || isArchiveDeck(db, deck)) return false;
    return card.consecutiveCorrect >= graduationStreak(card.schedule);
  });
}

export async function countLearnedButUnarchived(userId: string) {
  return selectLearnedButUnarchived(getSnapshot(), userId).length;
}

/**
 * Retire everything that already meets its schedule.
 *
 * One card at a time through the same `archiveCard` the study session uses, so
 * these land exactly where a card that graduated normally would — under the
 * archive's sub-deck for the deck it came from, streak reset — rather than in
 * some parallel arrangement that only this function knows how to make.
 */
export async function archiveLearnedCards(userId: string): Promise<number> {
  const due = selectLearnedButUnarchived(getSnapshot(), userId);
  let archived = 0;
  for (const card of due) {
    if (archiveCard(card.id, userId)) archived += 1;
  }
  return archived;
}

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
        (max, d) =>
          d.userId === userId && d.parentId === null
            ? Math.max(max, d.position)
            : max,
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
 *  - `missed`  → streak resets, review again in a few minutes
 *  - `got_it`  → streak + 1, next review taken from the card's own ladder in
 *                `REVIEW_SCHEDULES` — widening, or a steady week
 *  - clearing that ladder → the card is **archived** (see `archiveCard`), which
 *    takes nine correct answers on the widening schedule and four on steady
 *
 * The streak moves at most one step a day. A card answered correctly a second
 * time today is rescheduled but not promoted: the ladder is built on the idea
 * that a day passed between answers, and recalling something ten seconds after
 * last seeing it is not the same evidence. Otherwise running the same deck four
 * times in an evening would archive it as learned. Answering **Missed** still
 * resets the streak whenever it happens — only the promotion is capped.
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
  const intervals = intervalsFor(existing.schedule);
  const creditedToday =
    existing.lastCorrectAt !== null &&
    startOfDay(existing.lastCorrectAt).getTime() === today.getTime();

  let consecutiveCorrect: number;
  let nextReviewAt: Date;

  if (rating === "missed") {
    consecutiveCorrect = 0;
    // Comes back shortly, not tomorrow: something you just got wrong is worth
    // seeing again in the same sitting. Late at night this naturally rolls over
    // into tomorrow, which is the right answer then anyway.
    nextReviewAt = new Date(now.getTime() + MISSED_REVIEW_MINUTES * 60_000);
  } else if (creditedToday) {
    consecutiveCorrect = existing.consecutiveCorrect;
    // Rescheduled from the streak it already has, which lands on the same date
    // the earlier answer chose. The floor of one covers a card that was missed
    // after being credited today: the streak stays where the miss left it, but
    // it has just been answered correctly, so it shouldn't nag again today.
    //
    // The ceiling covers a card whose streak is already past the end of its
    // ladder, which happens when a ladder is shortened under cards that had
    // climbed the old one. It would otherwise read past the end and schedule an
    // Invalid Date. Such a card archives on its next answer on another day; the
    // last rung is the right gap until then.
    nextReviewAt = addDays(
      today,
      intervals[
        Math.min(Math.max(consecutiveCorrect, 1), intervals.length) - 1
      ],
    );
  } else {
    consecutiveCorrect = existing.consecutiveCorrect + 1;

    if (consecutiveCorrect >= graduationStreak(existing.schedule)) {
      archiveCard(cardId, userId);
      return null;
    }

    nextReviewAt = addDays(today, intervals[consecutiveCorrect - 1]);
  }

  return mutate((draft) => {
    const index = draft.cards.findIndex((c) => c.id === cardId);
    if (index === -1) return undefined;
    if (!ownsCard(draft, draft.cards[index], userId)) return undefined;

    const updated: CardRow = {
      ...draft.cards[index],
      consecutiveCorrect,
      nextReviewAt,
      // Stamped on every correct answer, not just promoting ones, so a third
      // and fourth answer today are held back by the same rule as the second.
      lastCorrectAt:
        rating === "got_it" ? now : draft.cards[index].lastCorrectAt,
      // Counted on every miss, including repeat misses in the same sitting: a
      // card that took four attempts tonight really was missed four times, and
      // that is exactly the card worth spotting later.
      timesMissed:
        draft.cards[index].timesMissed + (rating === "missed" ? 1 : 0),
      updatedAt: now,
    };
    draft.cards[index] = updated;
    return updated;
  });
}

/**
 * File a card under a different deck.
 *
 * Scheduling is deliberately untouched — it is the same card, so its streak and
 * next review date carry across. A card pulled back out of the archive keeps
 * the streak reset it got on the way in, and its review date is already in the
 * past, so it lands back in rotation immediately.
 *
 * Returns `undefined` if the card or target isn't the user's, or if the target
 * has sub-decks and therefore cannot hold cards of its own.
 */
/**
 * Put a batch of cards on a different review schedule.
 *
 * Only the ladder changes. The streak is left where it is, because it is a
 * record of what happened rather than a position on a particular ladder — and
 * a card whose streak already exceeds its new ladder is simply learned by the
 * new rule, which the next correct answer will act on.
 */
export async function setCardsSchedule(
  cardIds: number[],
  userId: string,
  schedule: ReviewSchedule,
): Promise<number> {
  if (cardIds.length === 0) return 0;

  const changed = await mutate((draft) => {
    const wanted = new Set(cardIds);
    const now = new Date();
    let count = 0;

    draft.cards = draft.cards.map((card) => {
      if (!wanted.has(card.id) || !ownsCard(draft, card, userId)) return card;
      if (card.schedule === schedule) return card;
      count += 1;
      return { ...card, schedule, updatedAt: now };
    });

    return count;
  });
  return changed ?? 0;
}

/**
 * Delete a batch of cards.
 *
 * One pass rather than a loop over `deleteCard`: each of those is its own write
 * to the document and its own sync push, so deleting fifty cards would be fifty
 * commits and fifty chances to be interrupted half-done.
 */
export async function deleteCards(
  cardIds: number[],
  userId: string,
): Promise<number> {
  if (cardIds.length === 0) return 0;

  const removed = await mutate((draft) => {
    const wanted = new Set(cardIds);
    const before = draft.cards.length;
    draft.cards = draft.cards.filter(
      (card) => !(wanted.has(card.id) && ownsCard(draft, card, userId)),
    );
    return before - draft.cards.length;
  });
  return removed ?? 0;
}

export async function moveCards(
  cardIds: number[],
  userId: string,
  targetDeckId: number,
) {
  if (cardIds.length === 0) return [];

  // One mutate for the whole batch: a bulk move is a single user action, and
  // splitting it would persist and sync a half-moved state.
  return mutate((draft) => {
    const target = draft.decks.find(
      (d) => d.id === targetDeckId && d.userId === userId,
    );
    if (!target) return [];
    if (draft.decks.some((d) => d.parentId === targetDeckId)) return [];

    const now = new Date();
    const wanted = new Set(cardIds);
    const moved: CardRow[] = [];

    draft.cards = draft.cards.map((card) => {
      if (!wanted.has(card.id)) return card;
      if (!ownsCard(draft, card, userId)) return card;
      const next: CardRow = { ...card, deckId: targetDeckId, updatedAt: now };
      moved.push(next);
      return next;
    });

    return moved;
  });
}

/**
 * Move a batch of cards to a different review day.
 *
 * Only `nextReviewAt` moves. The streak, the schedule and the deck are all left
 * alone, so a rescheduled card resumes its ladder from wherever it was — this
 * is load-levelling, not a correction to how well the card is known.
 *
 * The date is normalised to the start of the day because every count in the app
 * buckets by day; keeping the original time of day would put a card in the
 * right cell but sort it oddly within a study session.
 *
 * Each card's previous date comes back with it, which is what makes the move
 * undoable: restoring the day the cards came from is not enough, because a card
 * folded into today's cell for being overdue was really sitting further back.
 */
export type RescheduledCard = {
  cardId: number;
  previousReviewAt: Date;
};

export async function rescheduleCards(
  cardIds: number[],
  userId: string,
  nextReviewAt: Date,
): Promise<RescheduledCard[]> {
  if (cardIds.length === 0) return [];

  return mutate((draft) => {
    const day = startOfDay(nextReviewAt);
    const now = new Date();
    const wanted = new Set(cardIds);
    const moved: RescheduledCard[] = [];

    draft.cards = draft.cards.map((card) => {
      if (!wanted.has(card.id)) return card;
      if (!ownsCard(draft, card, userId)) return card;
      moved.push({ cardId: card.id, previousReviewAt: card.nextReviewAt });
      return { ...card, nextReviewAt: day, updatedAt: now };
    });

    return moved;
  });
}

/**
 * Put a batch of cards back on the exact dates they came off.
 *
 * The undo half of {@link rescheduleCards}, and deliberately not the same
 * function called with yesterday's date: the dates are restored verbatim,
 * without the start-of-day normalisation, so undoing a move is a true reversal
 * rather than another approximate one.
 *
 * `stillOn` guards a stale undo. The offer outlives a reload, so by the time it
 * is taken a card may have been studied — which gives it a new date of its own,
 * further out than anything this move chose. Restoring that card would throw
 * away a real review result to correct a scheduling decision it has already
 * moved past, so cards that are no longer where the move left them are skipped
 * and reported by their absence from the result.
 */
export async function restoreCardDates(
  entries: RescheduledCard[],
  userId: string,
  stillOn?: Date,
) {
  if (entries.length === 0) return [];

  return mutate((draft) => {
    const dates = new Map(entries.map((e) => [e.cardId, e.previousReviewAt]));
    const expected = stillOn ? startOfDay(stillOn).getTime() : null;
    const now = new Date();
    const restored: CardRow[] = [];

    draft.cards = draft.cards.map((card) => {
      const date = dates.get(card.id);
      if (!date) return card;
      if (!ownsCard(draft, card, userId)) return card;
      if (
        expected !== null &&
        startOfDay(card.nextReviewAt).getTime() !== expected
      ) {
        return card;
      }
      const next: CardRow = { ...card, nextReviewAt: date, updatedAt: now };
      restored.push(next);
      return next;
    });

    return restored;
  });
}

export async function moveCard(
  cardId: number,
  userId: string,
  targetDeckId: number,
) {
  const [moved] = await moveCards([cardId], userId, targetDeckId);
  return moved;
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
