"use client";

import { useCallback } from "react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore, useStoreReady } from "@/lib/store/use-store";
import { dueCutoff, selectDecksWithCardsByUser } from "@/lib/store/selectors";
import type { DbDoc } from "@/lib/store/types";
import { CreateDeckButton } from "./create-deck-button";
import { DashboardSearch } from "./dashboard-search";

export default function DashboardPage() {
  const ready = useStoreReady();
  const userDecks = useStore(
    useCallback(
      (db: DbDoc) => selectDecksWithCardsByUser(db, LOCAL_USER_ID),
      [],
    ),
  );

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your Decks</h1>
          <p className="mt-1 text-muted-foreground">
            {userDecks.length === 0
              ? "You don't have any decks yet. Create one to get started!"
              : `${userDecks.length} deck${userDecks.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <CreateDeckButton />
      </div>

      <DashboardSearch
        decks={userDecks.map((deck) => {
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          const cutoff = dueCutoff();
          const totalCards = deck.cards.length;
          // Archived cards are retired: they stay browsable and can be studied
          // deliberately, but they must never nag from the dashboard.
          const dueCount = deck.isArchive
            ? 0
            : deck.cards.filter((c) => c.nextReviewAt < cutoff).length;
          const studiedToday =
            !deck.isArchive &&
            deck.lastStudiedAt !== null &&
            deck.lastStudiedAt >= startOfToday;

          return {
            ...deck,
            updatedAtFormatted: deck.updatedAt.toLocaleDateString("en-US"),
            totalCards,
            dueCount,
            studiedToday,
            childCount: deck.childCount,
          };
        })}
      />
    </div>
  );
}
