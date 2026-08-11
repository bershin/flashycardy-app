"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, BookOpen, CalendarClock, CheckCircle, CircleCheckBig, Pencil, Trash2 } from "lucide-react";
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
    updatedAtFormatted: string;
    totalCards: number;
    dueCount: number;
    tomorrowCount: number;
    studiedToday: boolean;
    isArchive?: boolean;
  };
}

export function ChildDeckCard({ deck }: ChildDeckCardProps) {
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
        className="relative flex h-full flex-col overflow-hidden transition-all duration-200 group-hover/deck:-translate-y-0.5 group-hover/deck:border-[var(--deck-accent-line)] group-hover/deck:shadow-lg group-hover/deck:shadow-[var(--deck-accent-soft)]"
      >
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1.5 bg-[var(--deck-accent)]"
        />
        <Link href={`/deck?id=${deck.id}`} className="relative flex-1">
          <CardHeader>
            <CardTitle>{deck.title}</CardTitle>
            {deck.description && (
              <CardDescription>{deck.description}</CardDescription>
            )}
          </CardHeader>
        </Link>
        <CardFooter className="relative flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Updated {deck.updatedAtFormatted}
          </p>
          <div className="flex items-center gap-2">
            {deck.studiedToday && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-600 dark:text-violet-400">
                <CircleCheckBig className="size-3" />
                Studied today
              </span>
            )}
            {deck.isArchive
              ? deck.totalCards > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                    <Archive className="size-3" />
                    {deck.totalCards} learned
                  </span>
                )
              : deck.totalCards > 0 &&
              (deck.dueCount > 0 ? (
                <button
                  type="button"
                  onClick={() => router.push(`/deck/study?id=${deck.id}`)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                >
                  <BookOpen className="size-3" />
                  {deck.dueCount} due
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle className="size-3" />
                  All caught up
                </span>
              ))}
            {/* Tomorrow's load, same as on the dashboard. */}
            {!deck.isArchive && deck.tomorrowCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
                <CalendarClock className="size-3" />
                {deck.tomorrowCount} tomorrow
              </span>
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
