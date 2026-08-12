"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  CalendarArrowUp,
  ChevronLeft,
  ChevronRight,
  Undo2,
  X,
} from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore, useStoreReady } from "@/lib/store/use-store";
import { isArchiveDeck, startOfDay } from "@/lib/store/selectors";
import type { CardRow, DbDoc } from "@/lib/store/types";
import { Button } from "@/components/ui/button";
import { MoveDueCardsDialog, type MovableCard } from "./move-due-cards-dialog";
import {
  getLastMove,
  lastMoveServerSnapshot,
  setLastMove,
  subscribeLastMove,
} from "./last-move";
import { undoRescheduleAction } from "@/app/deck/actions";

/** Monday-first, matching how a week is read here. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A single hue, light to dark, because the quantity being shown is a magnitude.
 * The count is printed in every cell as well, so the shade is reinforcement
 * rather than the only way to read it.
 */
const STEPS = [
  "bg-violet-500/12 text-foreground",
  "bg-violet-500/28 text-foreground",
  "bg-violet-500/45 text-violet-950 dark:text-violet-50",
  "bg-violet-500/65 text-white",
  "bg-violet-600/85 text-white",
];

type Day = {
  date: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
  count: number;
  /** Cards already past their date, all folded into today. */
  overdue: number;
};

type DeckRef = {
  id: number;
  title: string;
  /** Set for a sub-deck, shown as context so two same-named children differ. */
  parentTitle: string | null;
};

/**
 * One deck's share of a single day.
 *
 * The cards themselves ride along, not just a tally, because the move control
 * has to name the exact ids it is rescheduling and pick them by streak.
 */
type DeckCount = DeckRef & {
  count: number;
  overdue: number;
  cards: MovableCard[];
};

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Reads a `YYYY-MM-DD` key back as a local date, never a UTC instant. */
function keyLabel(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

type ActiveCards = {
  cards: CardRow[];
  /**
   * The deck a card is counted under, keyed by deck id.
   *
   * Cards are attributed to the deck they actually sit in rather than rolled up
   * into a top-level parent: a collection kept as one parent with many
   * sub-decks would otherwise report every day as a single deck, which is the
   * one answer the breakdown exists to avoid. The parent's name rides along as
   * context instead.
   */
  deckOf: Map<number, DeckRef>;
};

/** Cards that are actually in rotation — archived decks are retired. */
function selectActiveCards(db: DbDoc): ActiveCards {
  const owned = db.decks.filter((d) => d.userId === LOCAL_USER_ID);
  const byId = new Map(owned.map((d) => [d.id, d]));

  const deckOf = new Map<number, DeckRef>();
  for (const deck of owned) {
    if (isArchiveDeck(db, deck)) continue;
    const parent = deck.parentId === null ? null : byId.get(deck.parentId);
    deckOf.set(deck.id, {
      id: deck.id,
      title: deck.title,
      parentTitle: parent?.title ?? null,
    });
  }

  return { cards: db.cards.filter((c) => deckOf.has(c.deckId)), deckOf };
}

export default function CalendarPage() {
  const ready = useStoreReady();
  const { cards, deckOf } = useStore(
    useCallback((db: DbDoc) => selectActiveCards(db), []),
  );
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  /** A day's breakdown opens short; a long tail is a click away. */
  const DECK_LIMIT = 8;

  function selectDay(key: string | null) {
    setSelectedKey(key);
    setExpanded(false);
  }

  const {
    days,
    monthLabel,
    monthTotal,
    busiest,
    max,
    overdueTotal,
    byDeck,
    counts,
  } = useMemo(() => {
      const today = startOfDay(new Date());

      // Everything already past shows on today, which is where the app will
      // actually present it — dotting it across previous days would describe a
      // backlog that no longer exists as separate days of work.
      const counts = new Map<string, number>();
      // The same tally split by deck, so a heavy day can be read as "which
      // decks is this?" without opening each one.
      const byDeck = new Map<string, Map<number, DeckCount>>();
      let overdueTotal = 0;
      for (const card of cards) {
        const due = startOfDay(new Date(card.nextReviewAt));
        const overdue = due < today;
        if (overdue) overdueTotal += 1;
        const key = ymd(overdue ? today : due);
        counts.set(key, (counts.get(key) ?? 0) + 1);

        const deck = deckOf.get(card.deckId);
        if (!deck) continue;
        let decks = byDeck.get(key);
        if (!decks) {
          decks = new Map();
          byDeck.set(key, decks);
        }
        const entry = decks.get(deck.id) ?? {
          ...deck,
          count: 0,
          overdue: 0,
          cards: [],
        };
        entry.count += 1;
        if (overdue) entry.overdue += 1;
        entry.cards.push({ id: card.id, streak: card.consecutiveCorrect });
        decks.set(deck.id, entry);
      }

      const anchor = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
      const monthLabel = anchor.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });

      // Grid starts on the Monday on or before the 1st.
      const start = new Date(anchor);
      const weekday = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - weekday);

      const days: Day[] = [];
      for (let i = 0; i < 42; i++) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        const key = ymd(date);
        days.push({
          date,
          key,
          inMonth: date.getMonth() === anchor.getMonth(),
          isToday: key === ymd(today),
          count: counts.get(key) ?? 0,
          overdue: key === ymd(today) ? overdueTotal : 0,
        });
      }

      const inMonth = days.filter((d) => d.inMonth);
      const monthTotal = inMonth.reduce((sum, d) => sum + d.count, 0);
      const max = Math.max(...days.map((d) => d.count), 0);
      const busiest = inMonth.reduce<Day | null>(
        (best, d) => (d.count > (best?.count ?? 0) ? d : best),
        null,
      );

      return {
        days,
        monthLabel,
        monthTotal,
        busiest,
        max,
        overdueTotal,
        byDeck,
        counts,
      };
    }, [cards, deckOf, monthOffset]);

  /**
   * How many cards a day holds, for any date — including ones off this grid,
   * which the move dialog can reach with its date field.
   */
  const countOn = useCallback(
    (key: string) => counts.get(key) ?? 0,
    [counts],
  );

  const selected = selectedKey
    ? (days.find((d) => d.key === selectedKey) ?? null)
    : null;

  /** The picked day's decks, heaviest first. */
  const selectedDecks = useMemo(() => {
    if (!selected) return [];
    return [...(byDeck.get(selected.key)?.values() ?? [])].sort(
      (a, b) => b.count - a.count || a.title.localeCompare(b.title),
    );
  }, [byDeck, selected]);

  const visibleDecks = expanded
    ? selectedDecks
    : selectedDecks.slice(0, DECK_LIMIT);

  /** The deck row whose Move control is open, or null. */
  const [moving, setMoving] = useState<DeckCount | null>(null);

  /**
   * The last completed move, kept until it is undone or dismissed.
   *
   * Deliberately not on a timer: a move can shift a hundred cards, and the
   * moment to reconsider is after looking at the new shape of the month, which
   * takes longer than any toast would stay up. It is held in localStorage
   * rather than component state so closing the tab isn't the same as accepting
   * the move.
   */
  const lastMove = useSyncExternalStore(
    subscribeLastMove,
    getLastMove,
    lastMoveServerSnapshot,
  );
  const [undoing, setUndoing] = useState(false);
  const [undoNote, setUndoNote] = useState<string | null>(null);

  async function undoLastMove() {
    if (!lastMove) return;
    setUndoing(true);
    setUndoNote(null);
    try {
      const { restored, requested } = await undoRescheduleAction({
        entries: lastMove.entries,
        stillOn: lastMove.toKey,
      });
      if (restored === 0) {
        setUndoNote("Those cards have moved on since — nothing to undo.");
      } else if (restored < requested) {
        // Said plainly rather than silently: the day's count won't match what
        // undoing appeared to promise, and that needs a reason.
        setUndoNote(
          `Put back ${restored} of ${requested}. The rest have been studied since.`,
        );
        setLastMove(null);
      } else {
        setLastMove(null);
      }
    } catch {
      setUndoNote("Couldn't undo that — try again.");
    } finally {
      setUndoing(false);
    }
  }

  /** Moving month keeps no selection: the picked day is no longer on screen. */
  function goToMonth(next: (m: number) => number) {
    setMonthOffset(next);
    selectDay(null);
  }

  function shade(count: number): string {
    if (count === 0) return "bg-transparent text-muted-foreground";
    // Square-rooted, not linear. One heavy day is typically several times any
    // other, and against a linear scale every ordinary day collapses into the
    // same pale tint — the shape of a normal week disappears behind the spike.
    const ratio = max === 0 ? 0 : Math.sqrt(count / max);
    const index = Math.min(
      STEPS.length - 1,
      Math.floor(ratio * (STEPS.length - 1) + 0.5),
    );
    return STEPS[index];
  }

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <div className="h-9 w-56 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-80 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link
        href="/dashboard"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Back to decks
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="bg-gradient-to-br from-[oklch(0.55_0.22_300)] via-[oklch(0.6_0.2_330)] to-[oklch(0.55_0.2_265)] bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl dark:from-[oklch(0.85_0.14_300)] dark:via-[oklch(0.82_0.13_330)] dark:to-[oklch(0.8_0.14_265)]">
            {monthLabel}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {monthTotal === 0
              ? "Nothing due this month"
              : `${monthTotal} card${monthTotal === 1 ? "" : "s"} due this month`}
            {busiest && busiest.count > 0 && (
              <>
                {" · heaviest is "}
                <strong className="text-foreground">
                  {busiest.date.toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })}
                </strong>
                {` with ${busiest.count}`}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => goToMonth((m) => m - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => goToMonth(() => 0)}
            disabled={monthOffset === 0}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => goToMonth((m) => m + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-7 gap-1 sm:gap-2">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="pb-1 text-center text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}

        {days.map((day) => {
          const isSelected = day.key === selected?.key;
          // Days with nothing on them have no breakdown to open, so they stay
          // plain cells rather than buttons that would do nothing.
          const clickable = day.inMonth && day.count > 0;
          const title =
            day.count > 0
              ? `${day.date.toLocaleDateString()} — ${day.count} due${day.overdue > 0 ? `, including ${day.overdue} overdue` : ""}${clickable ? ". Click for the deck breakdown" : ""}`
              : day.date.toLocaleDateString();
          // Ring and border are chosen once rather than layered, so the
          // selected and today states can't fight over the same properties.
          const outline = isSelected
            ? "border-violet-600 ring-2 ring-violet-500 ring-offset-2 ring-offset-background dark:border-violet-400"
            : day.isToday
              ? "border-primary ring-2 ring-primary/40"
              : "border-border/60";
          const className = `relative flex aspect-square flex-col items-center justify-center rounded-lg border transition-colors ${outline} ${
            day.inMonth
              ? shade(day.count)
              : "border-transparent bg-transparent text-muted-foreground/40"
          }`;
          const body = (
            <>
              <span className="absolute top-1 left-1.5 text-[0.65rem] opacity-70">
                {day.date.getDate()}
              </span>
              {day.inMonth && day.count > 0 && (
                <span className="text-base font-semibold tabular-nums sm:text-lg">
                  {day.count}
                </span>
              )}
            </>
          );

          if (!clickable) {
            return (
              <div key={day.key} className={className} title={title}>
                {body}
              </div>
            );
          }

          return (
            <button
              key={day.key}
              type="button"
              aria-pressed={isSelected}
              title={title}
              onClick={() =>
                selectDay(day.key === selectedKey ? null : day.key)
              }
              className={`${className} cursor-pointer hover:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none`}
            >
              {body}
            </button>
          );
        })}
      </div>

      {/* Outlives the move it describes: once an undo comes back partial, the
          bar has to stay long enough to say so. */}
      {(lastMove || undoNote) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-3 text-sm">
          <span className="flex-1">
            {lastMove && (
              <>
                Moved {lastMove.entries.length} {lastMove.deckLabel} card
                {lastMove.entries.length === 1 ? "" : "s"} to{" "}
                <strong>{keyLabel(lastMove.toKey)}</strong>.{" "}
              </>
            )}
            {undoNote && (
              <span className="text-muted-foreground">{undoNote}</span>
            )}
          </span>
          {lastMove && (
            <Button
              variant="secondary"
              size="sm"
              disabled={undoing}
              onClick={undoLastMove}
            >
              <Undo2 className="mr-1 size-3.5" />
              {undoing ? "Undoing…" : "Undo"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Dismiss"
            disabled={undoing}
            onClick={() => {
              setLastMove(null);
              setUndoNote(null);
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      {selected && (
        <div className="mt-4 rounded-lg border border-border/60 bg-card/60 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">
                {selected.date.toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {selected.count} card{selected.count === 1 ? "" : "s"} across{" "}
                {selectedDecks.length} deck
                {selectedDecks.length === 1 ? "" : "s"}
                {selected.overdue > 0 && `, including ${selected.overdue} overdue`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close breakdown"
              onClick={() => selectDay(null)}
            >
              <X className="size-4" />
            </Button>
          </div>

          <ul className="mt-3 space-y-1">
            {visibleDecks.map((deck) => (
              // The Move control is a sibling of the link rather than inside
              // it: a button nested in an anchor is invalid, and clicking it
              // would navigate away from the day being rebalanced.
              <li
                key={deck.id}
                className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <Link
                  href={`/deck?id=${deck.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  {/* Proportional to the heaviest deck of this day, so the
                      split is legible before the numbers are read. */}
                  <span
                    aria-hidden
                    className="h-1.5 shrink-0 rounded-full bg-violet-500/70"
                    style={{
                      width: `${Math.max(8, (deck.count / selectedDecks[0].count) * 96)}px`,
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {deck.parentTitle && (
                      <span className="text-muted-foreground">
                        {deck.parentTitle} ·{" "}
                      </span>
                    )}
                    {deck.title}
                  </span>
                  {deck.overdue > 0 && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {deck.overdue} overdue
                    </span>
                  )}
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {deck.count}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setMoving(deck)}
                  aria-label={`Move ${deck.title} cards to another day`}
                  className="shrink-0 cursor-pointer rounded-md border border-border/60 px-2 py-0.5 text-xs font-medium text-muted-foreground hover:border-violet-500 hover:text-foreground"
                >
                  <CalendarArrowUp className="mr-1 inline size-3.5" />
                  Move
                </button>
              </li>
            ))}
          </ul>

          {selectedDecks.length > DECK_LIMIT && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="mt-2 cursor-pointer px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {expanded
                ? "Show fewer"
                : `Show all ${selectedDecks.length} decks`}
            </button>
          )}
        </div>
      )}

      {moving && selected && (
        <MoveDueCardsDialog
          // Remounted per deck and day, so the count and destination always
          // start from this row rather than the last one opened.
          key={`${selected.key}:${moving.id}`}
          open={moving !== null}
          onOpenChange={(open) => !open && setMoving(null)}
          deckLabel={
            moving.parentTitle
              ? `${moving.parentTitle} · ${moving.title}`
              : moving.title
          }
          fromKey={selected.key}
          fromLabel={selected.date.toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          cards={moving.cards}
          countOn={countOn}
          onMoved={(move) => {
            setLastMove(move);
            setUndoNote(null);
          }}
        />
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Lighter</span>
          <div className="flex gap-0.5">
            {STEPS.map((step) => (
              <span
                key={step}
                className={`size-4 rounded-sm ${step.split(" ")[0]}`}
              />
            ))}
          </div>
          <span>heavier{max > 0 && ` (up to ${max})`}</span>
        </div>
        {max > 0 && <span>Click a day for its deck breakdown</span>}
        {overdueTotal > 0 && (
          <span>
            {overdueTotal} overdue card{overdueTotal === 1 ? "" : "s"} shown on
            today
          </span>
        )}
      </div>
    </div>
  );
}
