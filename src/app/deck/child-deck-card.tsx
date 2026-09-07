"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, BookOpen, ChevronRight, CheckCircle, CircleCheckBig, Pencil, Sprout, Trash2 } from "lucide-react";
import { badgeClass } from "@/components/deck-badge";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import {
  allAnsweredToday,
  selectNewCards,
  selectUnstudiedToday,
} from "@/db/queries/cards";
import { selectDueCardsByDeckForUser } from "@/lib/store/selectors";
import { setStudyPicks } from "@/lib/study-picks";
import type { DbDoc } from "@/lib/store/types";
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
import { accentStyle } from "@/lib/deck-accent";
import { deleteDeckAction } from "@/app/dashboard/actions";

interface ChildDeckCardProps {
  deck: {
    id: number;
    title: string;
    description: string | null;
    totalCards: number;
    dueCount: number;
    studiedToday: boolean;
    isArchive?: boolean;
  };
}

export function ChildDeckCard({ deck }: ChildDeckCardProps) {
  const router = useRouter();
  /** Cards not started yet, the same reading the dashboard's pill uses. */
  const newCards = useStore(
    useCallback(
      (db: DbDoc) =>
        deck.isArchive ? [] : selectNewCards(db, deck.id, LOCAL_USER_ID),
      [deck.id, deck.isArchive],
    ),
  );
  /**
   * Whether every card this deck is still asking for has been answered today.
   *
   * Not "is the deck empty": a card answered wrong comes back in ten minutes
   * and keeps its place in the due count, so emptying the counts would demand a
   * flawless session. Having been through them is the claim.
   */
  /** The due cards themselves, to say whether that group has been worked. */
  const dueCards = useStore(
    useCallback(
      (db: DbDoc) =>
        deck.isArchive
          ? []
          : selectDueCardsByDeckForUser(db, deck.id, LOCAL_USER_ID),
      [deck.id, deck.isArchive],
    ),
  );
  /** Faded with a tick once a group has been gone through — see the deck card. */
  const doneLook = (done: boolean) => (done ? " opacity-60" : "");


  const nothingLeft = useStore(
    useCallback(
      (db: DbDoc) =>
        deck.isArchive
          ? true
          : selectUnstudiedToday(db, deck.id, LOCAL_USER_ID).length === 0,
      [deck.id, deck.isArchive],
    ),
  );
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
        className="relative flex h-full flex-col overflow-hidden transition-all duration-200 group-hover/deck:-translate-y-0.5 group-hover/deck:border-[var(--deck-accent-line)] group-hover/deck:shadow-lg group-hover/deck:shadow-[var(--deck-accent-soft)]"
      >
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1.5 bg-[var(--deck-accent)]"
        />
        <Link href={`/deck/?id=${deck.id}`} className="relative flex-1">
          <CardHeader>
            <CardTitle>{deck.title}</CardTitle>
            {deck.description && (
              <CardDescription>{deck.description}</CardDescription>
            )}
          </CardHeader>
        </Link>
        <CardFooter className="relative flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* Only once there is nothing left to open. Having opened the deck
                at some point today said almost nothing — it sat next to sixty
                new and a hundred due and read as a claim that the deck was
                dealt with. Now it means what it looks like it means.

                Hard is deliberately not part of the test. `timesMissed` only
                ever counts up, so a card missed three times is hard for good
                and the count can never reach zero — requiring it would retire
                this badge rather than qualify it. */}
            {deck.studiedToday && nothingLeft && (
              <span className={badgeClass("studied")}>
                <CircleCheckBig className="size-3.5" />
                Studied today
              </span>
            )}
            {deck.isArchive
              ? deck.totalCards > 0 && (
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
              : deck.totalCards > 0 && (
              <>
              {newCards.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setStudyPicks(
                      deck.id,
                      newCards.map((c) => c.id),
                    );
                    router.push(`/deck/study/?id=${deck.id}`);
                  }}
                  className={badgeClass(
                    "new",
                    doneLook(allAnsweredToday(newCards)) +
                      " group/new cursor-pointer shadow-sm transition-all duration-150 hover:-translate-y-px hover:bg-sky-500/25 hover:shadow-md hover:shadow-sky-500/20 active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:hover:bg-sky-400/25",
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
                  {allAnsweredToday(newCards) ? (
                    <CircleCheckBig className="-mr-0.5 size-3.5" />
                  ) : (
                    <ChevronRight className="-mr-0.5 size-3.5 opacity-60 transition-transform duration-150 group-hover/new:translate-x-0.5 group-hover/new:opacity-100" />
                  )}
                </button>
              )}
              {deck.dueCount > 0 ? (
                <button
                  type="button"
                  onClick={() => router.push(`/deck/study/?id=${deck.id}`)}
                  className={badgeClass(
                    "due",
                    // Reads as a control rather than a label: it lifts on hover,
                    // presses on click, and the chevron nudges toward where it
                    // goes. Keyboard users get an outline rather than a ring,
                    // since the pill's own ring is inset and would be hidden.
                    doneLook(allAnsweredToday(dueCards)) +
                      " group/due cursor-pointer shadow-sm transition-all duration-150 hover:-translate-y-px hover:bg-amber-500/25 hover:shadow-md hover:shadow-amber-500/20 active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:hover:bg-amber-400/25",
                  )}
                  aria-label={`Study ${deck.dueCount} cards due in ${deck.title}`}
                >
                  <BookOpen className="size-3.5" />
                  <span>
                    <span className="font-semibold tabular-nums">
                      {deck.dueCount}
                    </span>{" "}
                    due
                  </span>
                  {allAnsweredToday(dueCards) ? (
                    <CircleCheckBig className="-mr-0.5 size-3.5" />
                  ) : (
                    <ChevronRight className="-mr-0.5 size-3.5 opacity-60 transition-transform duration-150 group-hover/due:translate-x-0.5 group-hover/due:opacity-100" />
                  )}
                </button>
              ) : (
                <span className={badgeClass("done")}>
                  <CheckCircle className="size-3.5" />
                  All caught up
                </span>
              )}
              </>
              )}
          </div>
        </CardFooter>
      </Card>

      <div className="absolute top-3 right-3 z-10 flex gap-1 opacity-0 transition-opacity group-hover/deck:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setEditOpen(true)}
        >
          <Pencil className="size-3.5" />
          <span className="sr-only">Edit sub-deck</span>
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="size-3.5" />
          <span className="sr-only">Delete sub-deck</span>
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
              This will permanently delete this sub-deck and all of its cards.
              This action cannot be undone.
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
