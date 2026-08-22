"use client";

import { Suspense, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore, useStoreReady } from "@/lib/store/use-store";
import {
  dueCutoff,
  tomorrowCutoff,
  isArchiveDeck,
  selectCardsByDeckForUser,
  selectChildDecksWithCards,
  selectDeckByIdForUser,
} from "@/lib/store/selectors";
import type { DbDoc } from "@/lib/store/types";
import { DeckHeader } from "./deck-header";
import { CardGrid } from "./card-grid";
import { AddTodo } from "@/components/add-todo";
import { SortableChildDecks } from "./sortable-child-decks";

/**
 * Deck detail, reached as `/deck/?id=123`.
 *
 * This was `/deck/[deck_id]`. A static export has to know every route at build
 * time, and deck ids live in the user's browser, so there is nothing for
 * `generateStaticParams` to enumerate. A query parameter sidesteps that: one
 * HTML file serves every deck.
 */
function DeckPageContent() {
  const searchParams = useSearchParams();
  const ready = useStoreReady();
  const deckId = Number(searchParams.get("id"));
  const validId = Number.isInteger(deckId) && deckId > 0;

  const data = useStore(
    useCallback(
      (db: DbDoc) => {
        if (!validId) return null;
        const deck = selectDeckByIdForUser(db, deckId, LOCAL_USER_ID);
        if (!deck) return null;
        const childDecks = selectChildDecksWithCards(db, deckId, LOCAL_USER_ID);
        const cards =
          childDecks.length > 0
            ? []
            : selectCardsByDeckForUser(db, deckId, LOCAL_USER_ID);
        return { deck, childDecks, cards, isArchive: isArchiveDeck(db, deck) };
      },
      [deckId, validId],
    ),
  );

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="h-9 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-48 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Deck not found</h1>
        <p className="mt-2 text-muted-foreground">
          This deck may have been deleted, or the link is no longer valid.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to decks
        </Link>
      </div>
    );
  }

  const { deck, childDecks, cards, isArchive } = data;
  const hasChildren = childDecks.length > 0;
  const isTopLevel = deck.parentId === null;

  const backHref = deck.parentId ? `/deck/?id=${deck.parentId}` : "/dashboard";
  const backLabel = deck.parentId ? "Back to parent deck" : "Back to decks";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <Link
        href={backHref}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; {backLabel}
      </Link>

      <DeckHeader
        deck={deck}
        cardCount={cards.length}
        hasChildren={hasChildren}
        canAddSubDeck={isTopLevel && cards.length === 0}
      />

      {/* Sitting under the deck's own heading, because the thought this
          catches — "finish these tomorrow", "ask about question 7" — arrives
          while looking at the deck, and the calendar is two pages away. */}
      <AddTodo
        className="mt-3"
        date={todayKey()}
        label="Add something to do today"
        placeholder={`Something to do about ${deck.title} today…`}
      />

      {hasChildren ? (
        <SortableChildDecks
          parentId={deck.id}
          decks={childDecks.map((child) => {
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const cutoff = dueCutoff();
            const nextCutoff = tomorrowCutoff();
            const totalCards = child.cards.length;
            // Archived cards are retired — no due prompts here either.
            const dueCount = isArchive
              ? 0
              : child.cards.filter((c) => c.nextReviewAt < cutoff).length;
            // Cumulative, like the dashboard: today's cards are still there
            // tomorrow unless they are studied.
            const tomorrowCount = isArchive
              ? 0
              : child.cards.filter((c) => c.nextReviewAt < nextCutoff).length;
            const studiedToday =
              !isArchive &&
              child.lastStudiedAt !== null &&
              child.lastStudiedAt >= startOfToday;

            return {
              id: child.id,
              title: child.title,
              description: child.description,
              totalCards,
              dueCount,
              tomorrowCount,
              studiedToday,
              isArchive,
            };
          })}
        />
      ) : (
        <CardGrid cards={cards} />
      )}
    </div>
  );
}

/** Today as `YYYY-MM-DD`, in the reader's own calendar. */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function DeckPage() {
  // `useSearchParams` suspends during prerender, so the boundary is required.
  return (
    <Suspense>
      <DeckPageContent />
    </Suspense>
  );
}
