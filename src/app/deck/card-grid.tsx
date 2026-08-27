"use client";

import { useCallback, useState } from "react";
import {
  ArrowDownWideNarrow,
  BookOpen,
  CalendarClock,
  CheckSquare,
  Dices,
  FolderInput,
  Layers,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoveCardDialog } from "@/components/move-card-dialog";
import { Input } from "@/components/ui/input";
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
import {
  deleteCardsAction,
  rescheduleCardsAction,
  setCardsScheduleAction,
} from "./actions";
import { REVIEW_SCHEDULES, type ReviewSchedule } from "@/lib/store/types";
import { setStudyPicks } from "@/lib/study-picks";
import { useRouter } from "next/navigation";
import { VaryDeckDialog } from "@/components/vary-deck-dialog";
import type { CardRow } from "@/lib/store/types";
import { FlashCard } from "./flash-card";

interface CardGridProps {
  cards: CardRow[];
}

/**
 * The orders a deck can be read in.
 *
 * `recent` is the order the cards arrive in — last edited first, which is what
 * the deck has always shown — and stays the default so the page opens the way
 * it used to. Note that it tracks editing, not creation: a card written a year
 * ago and fixed this morning is at the top, which is why the two are separate
 * options rather than one.
 *
 * The rest each answer a question. Due first: what is coming, and how soon.
 * Missed most: what keeps catching you out, which is the list worth an extra
 * pass before an exam. Newest first: what you have just written, for when you
 * are still adding and want to check what you typed. Longest streak is the
 * mirror of missed — what is nearly learned, and can be skimmed.
 */
const SORTS = [
  { value: "recent", label: "Last edited" },
  { value: "due", label: "Due soonest" },
  { value: "missed", label: "Missed most" },
  { value: "streak", label: "Longest streak" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
] as const;

type SortKey = (typeof SORTS)[number]["value"];

/**
 * Sorted copies, never in place: `cards` is the store's array, and reordering
 * it would be reordering the deck itself.
 */
function sortCards(cards: CardRow[], sort: SortKey): CardRow[] {
  const by = (fn: (c: CardRow) => number) =>
    [...cards].sort((a, b) => fn(a) - fn(b) || a.id - b.id);

  switch (sort) {
    case "due":
      return by((c) => c.nextReviewAt.getTime());
    case "missed":
      return by((c) => -c.timesMissed);
    case "streak":
      return by((c) => -c.consecutiveCorrect);
    case "newest":
      return by((c) => -c.createdAt.getTime());
    case "oldest":
      return by((c) => c.createdAt.getTime());
    default:
      return cards;
  }
}

/** Today as `YYYY-MM-DD`, in the reader's own calendar. */
/** How a chosen date reads back in the confirmation line. */
function dueLabelFor(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return dueLabel(new Date(year, month - 1, day));
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const SCHEDULE_LABELS: Record<ReviewSchedule, string> = {
  incremental: "Widening",
  weekly: "Steady",
};

/** "Today", "Tomorrow", or a short date — relative where it is most read. */
function dueLabel(date: Date): string {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return day.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function CardGrid({ cards }: CardGridProps) {
  const router = useRouter();
  /** Every card here belongs to one deck, so the first one names it. */
  const deckId = cards[0]?.deckId ?? 0;
  const [sort, setSort] = useState<SortKey>("recent");
  /**
   * A shuffle is an order that cannot be recomputed, so it is held rather than
   * derived. Choosing a sort drops it; the two are the same control by another
   * name, and leaving a stale shuffle underneath would make the sort look
   * broken.
   */
  const [shuffled, setShuffled] = useState<CardRow[] | null>(null);
  const [prevCards, setPrevCards] = useState(cards);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  /**
   * Which cards to show: all of them, or only the ones still fixed.
   *
   * Converting a deck is a long job done a card at a time, and the hard part is
   * remembering where you were. Filtering to the fixed ones turns that into a
   * list that visibly shortens.
   */
  const [onlyFixed, setOnlyFixed] = useState(false);
  const [varyDeckOpen, setVaryDeckOpen] = useState(false);
  /** Which bulk edit is open, if any — only one at a time in the toolbar. */
  const [editing, setEditing] = useState<"schedule" | "due" | null>(null);
  const [dueDate, setDueDate] = useState(() => todayKey());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function applyToSelection(
    work: (ids: number[]) => Promise<unknown>,
    said: (n: number) => string,
  ) {
    const ids = [...selected];
    setBusy(true);
    try {
      await work(ids);
      setNote(said(ids.length));
      setEditing(null);
      exitSelection();
    } finally {
      setBusy(false);
    }
  }

  if (cards !== prevCards) {
    setPrevCards(cards);
    setShuffled(null);
    // Cards may have been moved away or deleted underneath the selection.
    setSelected((prev) => {
      const ids = new Set(cards.map((c) => c.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }

  const handleShuffle = useCallback(() => {
    setShuffled((current) => shuffleArray(current ?? cards));
  }, [cards]);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function exitSelection() {
    setSelecting(false);
    setSelected(new Set());
  }

  if (cards.length === 0) return null;

  const displayCards = shuffled ?? sortCards(cards, sort);
  const varying = cards.filter((c) => c.type === "generated").length;
  const visibleCards = onlyFixed
    ? displayCards.filter((c) => c.type !== "generated")
    : displayCards;
  const allSelected = selected.size === visibleCards.length;

  return (
    <div className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        {selecting ? (
          <>
            <span className="mr-auto text-sm text-muted-foreground">
              {selected.size} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setSelected(
                  allSelected
                    ? new Set()
                    : new Set(visibleCards.map((c) => c.id)),
                )
              }
            >
              {allSelected ? "Clear all" : "Select all"}
            </Button>
            {/* Each control acts on the ticked cards. Grouped as one row so
                the count above them is plainly what they all apply to. */}
            {editing === "schedule" ? (
              <>
                <span className="text-xs text-muted-foreground">
                  Put {selected.size} on
                </span>
                {REVIEW_SCHEDULES.map((schedule) => (
                  <Button
                    key={schedule}
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      applyToSelection(
                        (ids) =>
                          setCardsScheduleAction({ cardIds: ids, schedule }),
                        (n) =>
                          `Put ${n} card${n === 1 ? "" : "s"} on ${SCHEDULE_LABELS[schedule]}.`,
                      )
                    }
                  >
                    {SCHEDULE_LABELS[schedule]}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
              </>
            ) : editing === "due" ? (
              <>
                <span className="text-xs text-muted-foreground">
                  Review {selected.size} on
                </span>
                <Input
                  type="date"
                  value={dueDate}
                  autoFocus
                  onChange={(e) => setDueDate(e.target.value)}
                  className="h-8 w-[9.5rem] px-2 py-0 text-xs"
                />
                <Button
                  size="sm"
                  disabled={busy || !dueDate}
                  onClick={() =>
                    applyToSelection(
                      (ids) =>
                        rescheduleCardsAction({ cardIds: ids, date: dueDate }),
                      (n) =>
                        `Moved ${n} card${n === 1 ? "" : "s"} to ${dueLabelFor(dueDate)}.`,
                    )
                  }
                >
                  Set date
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                {/* First, because studying a few cards you have just picked
                    out is the likeliest reason to have picked them. */}
                <Button
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => {
                    const ids = displayCards
                      .filter((c) => selected.has(c.id))
                      .map((c) => c.id);
                    setStudyPicks(deckId, ids);
                    router.push(`/deck/study/?id=${deckId}`);
                  }}
                >
                  <BookOpen className="size-3.5" />
                  Study {selected.size}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => setEditing("schedule")}
                >
                  <Layers className="size-3.5" />
                  Schedule
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => setEditing("due")}
                >
                  <CalendarClock className="size-3.5" />
                  Review date
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => setMoveOpen(true)}
                >
                  <FolderInput className="size-3.5" />
                  Move
                  {selected.size > 0 ? ` ${selected.size}` : ""}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => setConfirmDelete(true)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
                <Button variant="outline" size="sm" onClick={exitSelection}>
                  <X className="size-3.5" />
                  Done
                </Button>
              </>
            )}
          </>
        ) : (
          <>
            {varying > 0 && (
              <span className="mr-auto text-sm text-muted-foreground">
                {varying} of {cards.length} vary
              </span>
            )}
            {varying > 0 && varying < cards.length && (
              <Button
                variant={onlyFixed ? "default" : "outline"}
                size="sm"
                onClick={() => setOnlyFixed((only) => !only)}
              >
                <Dices className="size-3.5" />
                {onlyFixed ? "Showing fixed only" : "Hide the varying ones"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVaryDeckOpen(true)}
            >
              <Dices className="size-3.5" />
              Make all vary…
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelecting(true)}
            >
              <CheckSquare className="size-3.5" />
              Select
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <ArrowDownWideNarrow className="size-3.5" />
                {/* The current order is on the button, not hidden inside the
                    menu: which way a few hundred cards are stacked is not
                    something you can tell by looking at them. */}
                {shuffled
                  ? "Shuffled"
                  : (SORTS.find((s) => s.value === sort)?.label ?? "Sort")}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={shuffled ? "" : sort}
                  onValueChange={(value) => {
                    setShuffled(null);
                    setSort(value as SortKey);
                  }}
                >
                  {SORTS.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={handleShuffle}>
              <Shuffle className="size-3.5" />
              Shuffle
            </Button>
          </>
        )}
      </div>

      {note && (
        <p role="status" className="mb-3 text-xs text-muted-foreground">
          {note}
        </p>
      )}

      {/* `card-list` lets the browser skip the work for cards that are nowhere
          near the viewport — see the rule in globals.css. A deck of a few
          hundred image cards is otherwise laid out and painted in full before
          the first one can be looked at. */}
      <div className="card-list grid gap-4 sm:grid-cols-2">
        {visibleCards.map((card) => (
          <FlashCard
            key={card.id}
            card={card}
            dueLabel={
              sort === "due" && !shuffled ? dueLabel(card.nextReviewAt) : null
            }
            selecting={selecting}
            selected={selected.has(card.id)}
            onToggleSelected={toggle}
          />
        ))}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} card{selected.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {/* Said plainly: this is the one bulk action with nothing behind
                  it. The rest can be set back by setting them again. */}
              This cannot be undone here. A copy of your decks before this
              change stays in your sync repo&rsquo;s history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() =>
                applyToSelection(
                  (ids) => deleteCardsAction({ cardIds: ids }),
                  (n) => `Deleted ${n} card${n === 1 ? "" : "s"}.`,
                )
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {varyDeckOpen && (
        <VaryDeckDialog cards={cards} open onOpenChange={setVaryDeckOpen} />
      )}

      <MoveCardDialog
        cardIds={[...selected]}
        currentDeckId={cards[0].deckId}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        onMoved={exitSelection}
      />
    </div>
  );
}
