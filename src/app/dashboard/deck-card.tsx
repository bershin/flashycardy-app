"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  BookOpen,
  CalendarClock,
  ChevronRight,
  CheckCircle,
  CircleCheckBig,
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
import { deleteDeckAction } from "./actions";

interface DeckCardProps {
  deck: {
    id: number;
    title: string;
    description: string | null;
    totalCards: number;
    dueCount: number;
    tomorrowCount: number;
    studiedToday: boolean;
    childCount: number;
    isArchive: boolean;
  };
}

export function DeckCard({ deck }: DeckCardProps) {
  const router = useRouter();
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
        <Link href={`/deck?id=${deck.id}`} className="relative flex-1">
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
              deck.dueCount > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    deck.childCount > 0
                      ? router.push(`/deck?id=${deck.id}`)
                      : router.push(`/deck/study?id=${deck.id}`)
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
              )
              )
            )}
            {/* Tomorrow's workload, stated quietly beside today's. Deliberately
                not a button: it is a heads-up, not something to act on yet. */}
            {!deck.isArchive && deck.tomorrowCount > 0 && (
              <span
                className={badgeClass("tomorrow")}
                title={`${deck.tomorrowCount} card${deck.tomorrowCount === 1 ? "" : "s"} due tomorrow`}
              >
                <CalendarClock className="size-3.5" />
                <span>
                  <span className="font-semibold tabular-nums">
                    {deck.tomorrowCount}
                  </span>{" "}
                  tomorrow
                </span>
              </span>
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
