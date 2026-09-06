"use client";

import { useCallback, useState } from "react";
import {
  BookOpen,
  Filter,
  CalendarClock,
  FolderInput,
  Layers,
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
import { HARD_MISS_THRESHOLD, isHardCard } from "@/db/queries/cards";
import { useRouter } from "next/navigation";
import { VaryDeckDialog } from "@/components/vary-deck-dialog";
import type { CardRow } from "@/lib/store/types";
import { FlashCard } from "./flash-card";

interface CardGridProps {
  cards: CardRow[];
  /**
   * Whether the grid is in selection mode.
   *
   * Controlled by the deck page rather than held here, because the header's
   * "Pick cards to study…" has to turn it on and the header is a sibling. The
   * grid still owns *which* cards are selected — only the mode is shared.
   */
  selecting: boolean;
  onSelectingChange: (selecting: boolean) => void;
  /** Whether the "make every card vary" dialog is open. */
  varyOpen: boolean;
  onVaryOpenChange: (open: boolean) => void;
  /**
   * Bumped by the header's Features menu to reshuffle.
   *
   * A nonce rather than the order itself: a shuffle is state that cannot be
   * recomputed, and it belongs beside the cards it reorders. Lifting it to the
   * page would have put it next to a `cards` array that is rebuilt on every
   * render, where the grid's own "cards changed, drop the shuffle" rule could
   * no longer tell a real change from a re-read.
   */
  shuffleNonce: number;
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

/**
 * The ways a deck can be narrowed, each with the question it answers.
 *
 * Single-select rather than a set of independent checkboxes: combinations like
 * "overdue and streak 2 and never missed" are rarely what anyone wants and
 * would leave the count meaning something different every time. One at a time
 * keeps "showing 12 of 340" true and legible.
 *
 * The counts are worked out for every filter whether or not it is chosen, so
 * the menu says how many each would leave before you pick it — which is most of
 * the value in asking.
 */
type Filter = {
  value: string;
  label: string;
  test: (card: CardRow, now: Bounds) => boolean;
};

/** Day boundaries, computed once per render rather than per card. */
type Bounds = { startOfToday: number; endOfToday: number; endOfWeek: number };

const FILTERS: Filter[] = [
  { value: "all", label: "All cards", test: () => true },
  {
    value: "overdue",
    label: "Overdue",
    test: (c, n) => c.nextReviewAt.getTime() < n.startOfToday,
  },
  {
    value: "today",
    label: "Due today",
    test: (c, n) => c.nextReviewAt.getTime() < n.endOfToday,
  },
  {
    value: "week",
    label: "Due within a week",
    test: (c, n) => c.nextReviewAt.getTime() < n.endOfWeek,
  },
  {
    value: "hard",
    label: `Hard (missed ${HARD_MISS_THRESHOLD}+)`,
    test: (c) => isHardCard(c),
  },
  {
    value: "missed",
    label: "Missed at least once",
    test: (c) => c.timesMissed > 0,
  },
  { value: "clean", label: "Never missed", test: (c) => c.timesMissed === 0 },
  {
    value: "streak0",
    label: "Streak 0",
    test: (c) => c.consecutiveCorrect === 0,
  },
  {
    value: "streak1",
    label: "Streak 1",
    test: (c) => c.consecutiveCorrect === 1,
  },
  {
    value: "streak2",
    label: "Streak 2",
    test: (c) => c.consecutiveCorrect === 2,
  },
  {
    value: "streak3",
    label: "Streak 3 or more",
    test: (c) => c.consecutiveCorrect >= 3,
  },
  {
    value: "varying",
    label: "Varying only",
    test: (c) => c.type === "generated",
  },
  { value: "fixed", label: "Fixed only", test: (c) => c.type !== "generated" },
];

function boundsNow(): Bounds {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const week = new Date(start);
  week.setDate(week.getDate() + 7);
  return {
    startOfToday: start.getTime(),
    endOfToday: end.getTime(),
    endOfWeek: week.getTime(),
  };
}

const SCHEDULE_LABELS: Record<ReviewSchedule, string> = {
  incremental: "Daily",
  weekly: "Widening",
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

export function CardGrid({
  cards,
  selecting,
  onSelectingChange,
  varyOpen,
  onVaryOpenChange,
  shuffleNonce,
}: CardGridProps) {
  const router = useRouter();
  /** Every card here belongs to one deck, so the first one names it. */
  const deckId = cards[0]?.deckId ?? 0;
  /**
   * A shuffle is an order that cannot be recomputed, so it is held rather than
   * derived. Choosing a sort drops it; the two are the same control by another
   * name, and leaving a stale shuffle underneath would make the sort look
   * broken.
   */
  const [shuffled, setShuffled] = useState<CardRow[] | null>(null);
  const [prevCards, setPrevCards] = useState(cards);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  /**
   * Which cards to show: all of them, or only the ones still fixed.
   *
   * Converting a deck is a long job done a card at a time, and the hard part is
   * remembering where you were. Filtering to the fixed ones turns that into a
   * list that visibly shortens.
   */
  const [filter, setFilter] = useState("all");
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
      // Closed here, not by the button that opened it: clearing the selection
      // leaves a confirmation asking about nothing — "Delete 0 cards?" — with
      // the work already done and no way out of it.
      setConfirmDelete(false);
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

  const [prevShuffleNonce, setPrevShuffleNonce] = useState(shuffleNonce);
  if (shuffleNonce !== prevShuffleNonce) {
    setPrevShuffleNonce(shuffleNonce);
    setShuffled((current) => shuffleArray(current ?? cards));
  }

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function exitSelection() {
    onSelectingChange(false);
    setSelected(new Set());
  }

  if (cards.length === 0) return null;

  // Last edited first, which is the order the store already holds them in and
  // the order this page has always opened on. Shuffle still overrides it.
  const displayCards = shuffled ?? cards;
  const varying = cards.filter((c) => c.type === "generated").length;
  const bounds = boundsNow();
  const counts = new Map(
    FILTERS.map((f) => [
      f.value,
      cards.filter((c) => f.test(c, bounds)).length,
    ]),
  );
  const active = FILTERS.find((f) => f.value === filter) ?? FILTERS[0];
  const visibleCards = displayCards.filter((c) => active.test(c, bounds));
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
            <DropdownMenu>
              <DropdownMenuTrigger
                className={buttonVariants({
                  variant: filter === "all" ? "outline" : "default",
                  size: "sm",
                })}
              >
                <Filter className="size-3.5" />
                {/* The count is the point: "showing 12 of 340" is the answer
                    the filter was opened to get. */}
                {filter === "all"
                  ? "Filter"
                  : `${active.label} · ${visibleCards.length} of ${cards.length}`}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={filter}
                  onValueChange={setFilter}
                >
                  {FILTERS.filter(
                    // A filter that would empty the deck, or leave it whole, is
                    // not a choice worth offering — except "All cards", which is
                    // how you come back.
                    (f) =>
                      f.value === "all" ||
                      (counts.get(f.value)! > 0 &&
                        counts.get(f.value)! < cards.length),
                  ).map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                      <span className="ml-auto pl-3 tabular-nums opacity-60">
                        {counts.get(option.value)}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

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
      {visibleCards.length === 0 && (
        // Reachable after editing: a filter chosen when it matched something
        // can be left holding nothing once those cards change.
        <p className="rounded-lg border border-border/60 bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
          No cards match {active.label.toLowerCase()}.{" "}
          <button
            type="button"
            onClick={() => setFilter("all")}
            className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline"
          >
            Show all {cards.length}
          </button>
        </p>
      )}

      <div className="card-list grid gap-4 sm:grid-cols-2">
        {visibleCards.map((card) => (
          <FlashCard
            key={card.id}
            card={card}
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

      {varyOpen && (
        <VaryDeckDialog cards={cards} open onOpenChange={onVaryOpenChange} />
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
