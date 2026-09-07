"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  BookOpen,
  ChevronRight,
  CheckCircle,
  CircleCheckBig,
  Flame,
  Sprout,
  Layers,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EditDeckDialog } from "@/components/edit-deck-dialog";
import { ProgressRing } from "@/components/progress-ring";
import { badgeClass } from "@/components/deck-badge";
import { accentStyle } from "@/lib/deck-accent";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import {
  HARD_MISS_THRESHOLD,
  selectHardCards,
  selectNewCards,
} from "@/db/queries/cards";
import { setStudyPicks } from "@/lib/study-picks";
import type { DbDoc } from "@/lib/store/types";
import { deleteDeckAction } from "./actions";

interface DeckCardProps {
  deck: {
    id: number;
    title: string;
    description: string | null;
    totalCards: number;
    dueCount: number;
    studiedToday: boolean;
    childCount: number;
    isArchive: boolean;
  };
}

export function DeckCard({ deck }: DeckCardProps) {
  const router = useRouter();
  /**
   * The cards under this deck that keep being missed, worst first.
   *
   * Read on the card rather than passed down, so the sub-deck list gets it from
   * the same place if it ever grows one. An archive deck is skipped: everything
   * in it is learned and out of rotation, and its misses are history.
   */
  const hardCards = useStore(
    useCallback(
      (db: DbDoc) =>
        deck.isArchive ? [] : selectHardCards(db, deck.id, LOCAL_USER_ID),
      [deck.id, deck.isArchive],
    ),
  );
  /** Cards nothing has been recorded against yet — see `selectNewCards`. */
  const newCards = useStore(
    useCallback(
      (db: DbDoc) =>
        deck.isArchive ? [] : selectNewCards(db, deck.id, LOCAL_USER_ID),
      [deck.id, deck.isArchive],
    ),
  );

  function study(cards: { id: number }[]) {
    if (cards.length === 0) return;
    setStudyPicks(
      deck.id,
      cards.map((c) => c.id),
    );
    router.push(`/deck/study/?id=${deck.id}`);
  }
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteDeckAction({ deckId: deck.id });
      } catch {
        // TODO: surface error via toast
      }
    });
  }

  return (
    <div className="group/deck relative h-full" style={accentStyle(deck.id)}>
      <Card
        size="sm"
        className="relative flex h-full flex-col overflow-hidden transition-all duration-200 group-hover/deck:-translate-y-0.5 group-hover/deck:shadow-lg group-hover/deck:shadow-[var(--deck-accent-soft)] group-hover/deck:border-[var(--deck-accent-line)]"
      >
        {/* The deck's identity colour: a bar along the top, plus a wash that
            deepens on hover. Never the sole carrier of identity — the title
            sits directly beneath it. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1.5 bg-[var(--deck-accent)]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[var(--deck-accent-soft)] to-transparent opacity-60 transition-opacity duration-200 group-hover/deck:opacity-100"
        />
        <Link href={`/deck/?id=${deck.id}`} className="relative flex-1">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle className="truncate">{deck.title}</CardTitle>
                {deck.description && (
                  <CardDescription className="line-clamp-2">
                    {deck.description}
                  </CardDescription>
                )}
              </div>
              {deck.totalCards > 0 && !deck.isArchive && (
                <ProgressRing
                  done={deck.totalCards - deck.dueCount}
                  total={deck.totalCards}
                />
              )}
            </div>
          </CardHeader>
        </Link>
        <CardFooter className="relative flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {deck.childCount > 0 && (
              <span className={badgeClass("muted")}>
                <Layers className="size-3.5" />
                <span>
                  <span className="font-semibold tabular-nums">
                    {deck.childCount}
                  </span>{" "}
                  sub-deck{deck.childCount === 1 ? "" : "s"}
                </span>
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {deck.studiedToday && (
              <span className={badgeClass("studied")}>
                <CircleCheckBig className="size-3.5" />
                Studied today
              </span>
            )}
            {deck.isArchive ? (
              deck.totalCards > 0 && (
                <span className={badgeClass("muted")}>
                  <Archive className="size-3.5" />
                  <span>
                    <span className="font-semibold tabular-nums">
                      {deck.totalCards}
                    </span>{" "}
                    learned
                  </span>
                </span>
              )
            ) : (
              deck.totalCards > 0 && (
              <>
              {/* Read left to right as the deck's own story: what you have not
                  met, what keeps beating you, what you owe today. Due changes
                  every morning and so comes last; the other two are standing
                  facts about the deck. */}
              {newCards.length > 0 && (
                <button
                  type="button"
                  onClick={() => study(newCards)}
                  className={badgeClass(
                    "new",
                    "group/new cursor-pointer shadow-sm transition-all duration-150 hover:-translate-y-px hover:bg-sky-500/25 hover:shadow-md hover:shadow-sky-500/20 active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:hover:bg-sky-400/25",
                  )}
                  aria-label={`Study the ${newCards.length} card${newCards.length === 1 ? "" : "s"} in ${deck.title} you have not started yet`}
                >
                  <Sprout className="size-3.5" />
                  <span>
                    <span className="font-semibold tabular-nums">
                      {newCards.length}
                    </span>{" "}
                    new
                  </span>
                  <ChevronRight className="-mr-0.5 size-3.5 opacity-60 transition-transform duration-150 group-hover/new:translate-x-0.5 group-hover/new:opacity-100" />
                </button>
              )}
              {hardCards.length > 0 && (
                <button
                  type="button"
                  onClick={() => study(hardCards)}
                  className={badgeClass(
                    "hard",
                    "group/hard cursor-pointer shadow-sm transition-all duration-150 hover:-translate-y-px hover:bg-rose-500/25 hover:shadow-md hover:shadow-rose-500/20 active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 dark:hover:bg-rose-400/25",
                  )}
                  aria-label={`Study the ${hardCards.length} card${hardCards.length === 1 ? "" : "s"} in ${deck.title} missed ${HARD_MISS_THRESHOLD} or more times, worst first`}
                >
                  <Flame className="size-3.5" />
                  <span>
                    <span className="font-semibold tabular-nums">
                      {hardCards.length}
                    </span>{" "}
                    hard
                  </span>
                  <ChevronRight className="-mr-0.5 size-3.5 opacity-60 transition-transform duration-150 group-hover/hard:translate-x-0.5 group-hover/hard:opacity-100" />
                </button>
              )}
              {deck.dueCount > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    deck.childCount > 0
                      ? router.push(`/deck/?id=${deck.id}`)
                      : router.push(`/deck/study/?id=${deck.id}`)
                  }
                  className={badgeClass(
                    "due",
                    // Reads as a control rather than a label: it lifts on hover,
                    // presses on click, and the chevron nudges toward where it
                    // goes. Keyboard users get an outline rather than a ring,
                    // since the pill's own ring is inset and would be hidden.
                    "group/due cursor-pointer shadow-sm transition-all duration-150 hover:-translate-y-px hover:bg-amber-500/25 hover:shadow-md hover:shadow-amber-500/20 active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:hover:bg-amber-400/25",
                  )}
                  aria-label={
                    deck.childCount > 0
                      ? `Open ${deck.title}: ${deck.dueCount} cards due`
                      : `Study ${deck.dueCount} cards due in ${deck.title}`
                  }
                >
                  <BookOpen className="size-3.5" />
                  <span>
                    <span className="font-semibold tabular-nums">
                      {deck.dueCount}
                    </span>{" "}
                    due
                  </span>
                  <ChevronRight className="-mr-0.5 size-3.5 opacity-60 transition-transform duration-150 group-hover/due:translate-x-0.5 group-hover/due:opacity-100" />
                </button>
              ) : (
                <span className={badgeClass("done")}>
                  <CheckCircle className="size-3.5" />
                  All caught up
                </span>
              )}
              </>
              )
            )}
          </div>
        </CardFooter>
      </Card>

      <div className="absolute top-3 right-3 z-10 flex gap-1 opacity-0 transition-opacity group-hover/deck:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.preventDefault();
            setEditOpen(true);
          }}
        >
          <Pencil className="size-3.5" />
          <span className="sr-only">Edit deck</span>
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.preventDefault();
            setDeleteOpen(true);
          }}
        >
          <Trash2 className="size-3.5" />
          <span className="sr-only">Delete deck</span>
        </Button>
      </div>

      <EditDeckDialog
        deckId={deck.id}
        title={deck.title}
        description={deck.description}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deck.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this deck
              {deck.childCount > 0
                ? ", all of its sub-decks, and their cards"
                : " and all of its cards"}
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? "Deleting\u2026" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
