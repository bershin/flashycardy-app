"use client";

import { useCallback, useState } from "react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore, useStoreReady } from "@/lib/store/use-store";
import {
  dueCutoff,
  tomorrowCutoff,
  selectDecksWithCardsByUser,
} from "@/lib/store/selectors";
import type { DbDoc } from "@/lib/store/types";
import { CreateDeckButton } from "./create-deck-button";
import { DeckSearchControl } from "./deck-search-control";
import { DashboardSearch } from "./dashboard-search";
import { DayNotes } from "./day-notes";

export default function DashboardPage() {
  const ready = useStoreReady();
  // Owned here so the search control can sit in the header row beside the
  // New Deck button, while the results list below consumes the same query.
  const [query, setQuery] = useState("");
  const userDecks = useStore(
    useCallback(
      (db: DbDoc) => selectDecksWithCardsByUser(db, LOCAL_USER_ID),
      [],
    ),
  );

  // Hoisted out of the JSX so the header can summarise across every deck.
  const deckViews = userDecks.map((deck) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const cutoff = dueCutoff();
    const nextCutoff = tomorrowCutoff();
    const totalCards = deck.cards.length;
    // Archived cards are retired: they stay browsable and can be studied
    // deliberately, but they must never nag from the dashboard.
    const dueCount = deck.isArchive
      ? 0
      : deck.cards.filter((c) => c.nextReviewAt < cutoff).length;
    // What tomorrow actually looks like: today's cards carry over unless they
    // are studied, so this counts everything due by the end of tomorrow rather
    // than only the cards dated tomorrow. Clearing today lowers it.
    const tomorrowCount = deck.isArchive
      ? 0
      : deck.cards.filter((c) => c.nextReviewAt < nextCutoff).length;
    const studiedToday =
      !deck.isArchive &&
      deck.lastStudiedAt !== null &&
      deck.lastStudiedAt >= startOfToday;

    return {
      ...deck,
      totalCards,
      dueCount,
      tomorrowCount,
      studiedToday,
      childCount: deck.childCount,
    };
  });
  const totalDue = deckViews.reduce((sum, d) => sum + d.dueCount, 0);

  // The database lives in IndexedDB, so there is a brief moment after mount
  // where it genuinely isn't loaded yet. Showing the empty state during it
  // would read as data loss.
  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="h-9 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {/* The heading states where you stand rather than naming the page —
              "Your decks" was decoration above a line that already said it. */}
          <h1 className="bg-gradient-to-br from-[oklch(0.55_0.22_300)] via-[oklch(0.6_0.2_330)] to-[oklch(0.55_0.2_265)] bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl dark:from-[oklch(0.85_0.14_300)] dark:via-[oklch(0.82_0.13_330)] dark:to-[oklch(0.8_0.14_265)]">
            {userDecks.length === 0
              ? "No decks yet"
              : totalDue > 0
                ? "Ready to review"
                : "All caught up"}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {userDecks.length === 0
              ? "Create your first deck to get started."
              : totalDue > 0
                ? `${totalDue} card${totalDue === 1 ? "" : "s"} across ${userDecks.length} deck${userDecks.length === 1 ? "" : "s"}`
                : `${userDecks.length} deck${userDecks.length === 1 ? "" : "s"} · nothing due today`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DeckSearchControl query={query} onChange={setQuery} />
          <CreateDeckButton />
        </div>
      </div>

      <DayNotes />

      <DashboardSearch decks={deckViews} query={query} />
    </div>
  );
}
