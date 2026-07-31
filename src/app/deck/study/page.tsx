"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { getSnapshot } from "@/lib/store/local-store";
import { useStore, useStoreReady } from "@/lib/store/use-store";
import {
  selectCardsByDeckForUser,
  selectDeckByIdForUser,
  selectDueCardsByDeckForUser,
} from "@/lib/store/selectors";
import type { CardRow, DbDoc } from "@/lib/store/types";
import { StudySession } from "./study-session";

/** Study a deck, reached as `/deck/study?id=123`. */
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
   * The due list is captured once per session rather than read live.
   *
   * Rating a card pushes its `nextReviewAt` into the future, which immediately
   * removes it from the due set. Subscribing to that would make cards vanish
   * from underneath the session as they were answered.
   */
  const [dueCards, setDueCards] = useState<CardRow[] | null>(null);

  useEffect(() => {
    if (!ready || !validId) return;
    // Read the store directly rather than through `useStore`, so this does not
    // resubscribe. Keyed on the deck and readiness alone, so the snapshot is
    // taken once when the session opens.
    setDueCards(selectDueCardsByDeckForUser(getSnapshot(), deckId, LOCAL_USER_ID));
  }, [ready, validId, deckId]);

  const backHref = `/deck?id=${deckId}`;

  if (!ready || (deck && dueCards === null)) {
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
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-hidden px-4 py-4">
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
      <StudySession cards={dueCards} deckId={deckId} />
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
