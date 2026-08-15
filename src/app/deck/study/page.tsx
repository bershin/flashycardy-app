"use client";

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LOCAL_USER_ID } from "@/lib/auth";
import {
  clearSession,
  loadSession,
  type SavedSession,
} from "@/lib/study-session-store";
import { getSnapshot } from "@/lib/store/local-store";
import { useStore, useStoreReady } from "@/lib/store/use-store";
import {
  selectCardsByDeckForUser,
  selectDeckByIdForUser,
  selectDueCardsByDeckForUser,
} from "@/lib/store/selectors";
import type { CardRow, DbDoc } from "@/lib/store/types";
import { StudySession } from "./study-session";

type Rating = "got_it" | "missed";

type Decision =
  /** An unfinished session exists — ask before discarding it. */
  | { kind: "resume"; deckId: number; saved: SavedSession; order: CardRow[]; source: CardRow[] }
  | {
      kind: "study";
      deckId: number;
      cards: CardRow[];
      order?: CardRow[];
      index: number;
      ratings: Array<[number, Rating]>;
      durations: Array<[number, number]>;
      round: number;
    };

function freshSession(deckId: number): Decision {
  return {
    kind: "study",
    deckId,
    cards: selectDueCardsByDeckForUser(getSnapshot(), deckId, LOCAL_USER_ID),
    index: 0,
    ratings: [],
    durations: [],
    round: 1,
  };
}

/**
 * Turn saved card ids back into cards.
 *
 * Cards can disappear between sessions — archived on graduation, or deleted
 * outright — so anything that no longer exists is dropped rather than allowed
 * to blow up the session. If nothing usable survives, the caller falls back to
 * a fresh session.
 */
function restore(db: DbDoc, saved: SavedSession): Decision | null {
  const byId = new Map(db.cards.map((c) => [c.id, c]));
  const pick = (ids: number[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((c): c is CardRow => c !== undefined);

  const order = pick(saved.cardIds);
  const source = pick(saved.sourceCardIds);
  if (order.length === 0) return null;

  return { kind: "resume", deckId: saved.deckId, saved, order, source };
}

/** Study a deck, reached as `/deck/study/?id=123`. */
function StudyPageContent() {
  const searchParams = useSearchParams();
  const ready = useStoreReady();
  const deckId = Number(searchParams.get("id"));
  const validId = Number.isInteger(deckId) && deckId > 0;

  const deck = useStore(
    useCallback(
      (db: DbDoc) =>
        validId ? selectDeckByIdForUser(db, deckId, LOCAL_USER_ID) : undefined,
      [deckId, validId],
    ),
  );
  const totalCards = useStore(
    useCallback(
      (db: DbDoc) =>
        validId ? selectCardsByDeckForUser(db, deckId, LOCAL_USER_ID).length : 0,
      [deckId, validId],
    ),
  );

  /**
   * What this page has settled on for the current deck: either an unfinished
   * session to offer back, or the card set to study.
   *
   * The card list is captured once and then held, never re-read. Rating a card
   * pushes its `nextReviewAt` into the future and so removes it from the due
   * set; subscribing to that would make cards vanish from underneath the
   * session as they were answered.
   */
  const [decision, setDecision] = useState<Decision | null>(null);

  /**
   * Whether an answer is on screen beside the question.
   *
   * The column widens only then. One card wants the reading width the rest of
   * the app uses; two side by side want the room, and each gets half of it.
   */
  const [answerShowing, setAnswerShowing] = useState(false);

  // Adjusted during render rather than in an effect: the snapshot has to be
  // taken before the first paint, and doing it in an effect would both flash an
  // empty session and trigger a cascading render. The store is read directly so
  // this never resubscribes.
  if (ready && validId && decision?.deckId !== deckId) {
    const saved = loadSession(deckId);
    const resumable = saved ? restore(getSnapshot(), saved) : null;
    setDecision(resumable ?? freshSession(deckId));
  }

  const active = decision?.deckId === deckId ? decision : null;
  const dueCards = active?.kind === "study" ? active.cards : null;

  const backHref = `/deck/?id=${deckId}`;

  if (!ready || (deck && active === null)) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (!deck) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Deck not found</h1>
        <Link
          href="/dashboard"
          className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to decks
        </Link>
      </div>
    );
  }

  if (totalCards === 0) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <Link
          href={backHref}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to deck
        </Link>
        <div className="mt-16 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{deck.title}</h1>
          <p className="mt-2 text-muted-foreground">
            This deck has no cards yet. Add some cards before studying.
          </p>
          <Link
            href={backHref}
            className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            Go back and add cards
          </Link>
        </div>
      </div>
    );
  }

  if (active?.kind === "resume") {
    const { saved, order } = active;
    const answered = saved.ratings.length;
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <Link
          href={backHref}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to deck
        </Link>
        <div className="mt-16 flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
            <RotateCcw className="size-8 text-primary" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            {deck.title}
          </h1>
          <p className="mt-2 text-muted-foreground">
            You left a session unfinished — card {saved.currentIndex + 1} of{" "}
            {order.length}
            {saved.round > 1 ? `, round ${saved.round}` : ""}.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {answered} card{answered === 1 ? "" : "s"} already answered.
            {" "}Those answers are saved either way.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button
              onClick={() =>
                setDecision({
                  kind: "study",
                  deckId,
                  cards: active.source.length > 0 ? active.source : order,
                  order,
                  index: Math.min(saved.currentIndex, order.length - 1),
                  ratings: saved.ratings,
                  durations: saved.durations ?? [],
                  round: saved.round,
                })
              }
            >
              <RotateCcw className="size-4" />
              Resume
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                clearSession(deckId);
                setDecision(freshSession(deckId));
              }}
            >
              Start fresh
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!dueCards || dueCards.length === 0) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <Link
          href={backHref}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to deck
        </Link>
        <div className="mt-16 flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle className="size-8 text-emerald-500" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            {deck.title}
          </h1>
          <p className="mt-2 text-muted-foreground">
            No cards are due for review right now. Check back later!
          </p>
          <Link
            href={backHref}
            className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            Back to deck
          </Link>
        </div>
      </div>
    );
  }

  return (
    // `h-full` rather than `flex-1`: the studying screen takes the window it is
    // given and does its own scrolling inside the cards, so the rating buttons
    // are always where they were a card ago.
    <div
      className={`mx-auto flex h-full w-full flex-col overflow-hidden px-4 py-4 transition-[max-width] duration-200 ${
        answerShowing ? "max-w-6xl" : "max-w-4xl"
      }`}
    >
      <div className="flex items-center justify-between">
        <Link
          href={backHref}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to deck
        </Link>
        <p className="text-sm text-muted-foreground">
          {dueCards.length} card{dueCards.length === 1 ? "" : "s"} due
        </p>
      </div>
      <h1 className="mt-2 text-xl font-bold tracking-tight">{deck.title}</h1>
      <StudySession
        cards={dueCards}
        deckId={deckId}
        initialOrder={active?.kind === "study" ? active.order : undefined}
        initialIndex={active?.kind === "study" ? active.index : 0}
        initialRatings={active?.kind === "study" ? active.ratings : undefined}
        initialDurations={
          active?.kind === "study" ? active.durations : undefined
        }
        initialRound={active?.kind === "study" ? active.round : 1}
        onAnswerShowing={setAnswerShowing}
      />
    </div>
  );
}

export default function StudyPage() {
  return (
    <Suspense>
      <StudyPageContent />
    </Suspense>
  );
}
