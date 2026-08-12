"use client";

import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import Link from "next/link";
import {
  CalendarArrowUp,
  ChevronLeft,
  ChevronRight,
  Undo2,
  X,
} from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { accentVar } from "@/lib/deck-accent";
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
  /** The top-level deck this rolls up into — itself, for a deck with no parent. */
  rootId: number;
  rootTitle: string;
  rootPosition: number;
};

/** A top-level deck's share of one day, as shown in the grid cell. */
type ParentCount = {
  id: number;
  title: string;
  /** Dashboard ordering, so the same deck keeps the same half of every cell. */
  position: number;
  count: number;
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
      // A deck with no parent is its own root, so every card has a top-level
      // deck to be counted under whether or not sub-decks are being used.
      rootId: parent?.id ?? deck.id,
      rootTitle: parent?.title ?? deck.title,
      rootPosition: parent?.position ?? deck.position,
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

  /**
   * Which top-level deck the open breakdown is narrowed to, or null for all.
   *
   * Set by clicking a parent's count in a cell, which is the whole point of
   * splitting the cell: the number you pressed is the list you get.
   */
  const [selectedParent, setSelectedParent] = useState<number | null>(null);

  function selectDay(key: string | null, parentId: number | null = null) {
    setSelectedKey(key);
    setSelectedParent(key === null ? null : parentId);
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
    byParent,
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
      // And rolled up again to top level, which is what a cell has room to
      // show: a day of 67 is legible as 60 of one collection and 7 of another
      // without opening anything at all.
      const byParent = new Map<string, Map<number, ParentCount>>();
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

        let parents = byParent.get(key);
        if (!parents) {
          parents = new Map();
          byParent.set(key, parents);
        }
        const parent = parents.get(deck.rootId) ?? {
          id: deck.rootId,
          title: deck.rootTitle,
          position: deck.rootPosition,
          count: 0,
        };
        parent.count += 1;
        parents.set(deck.rootId, parent);
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
        byParent,
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

  /** The picked day's decks, heaviest first, narrowed to one parent if asked. */
  const selectedDecks = useMemo(() => {
    if (!selected) return [];
    return [...(byDeck.get(selected.key)?.values() ?? [])]
      .filter((d) => selectedParent === null || d.rootId === selectedParent)
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  }, [byDeck, selected, selectedParent]);

  /**
   * The top-level decks with anything on this month's grid.
   *
   * Every cell is divided between these in this order, so a deck keeps the same
   * half of every square all month — the position becomes as good a label as
   * the letter, and a row of cells can be scanned without reading either.
   * Dashboard order, so the two screens agree on which deck comes first.
   */
  const monthParents = useMemo(() => {
    const seen = new Map<number, ParentCount>();
    for (const day of days) {
      if (!day.inMonth) continue;
      for (const parent of byParent.get(day.key)?.values() ?? []) {
        const entry = seen.get(parent.id) ?? { ...parent, count: 0 };
        entry.count += parent.count;
        seen.set(parent.id, entry);
      }
    }
    return [...seen.values()].sort(
      (a, b) => a.position - b.position || a.title.localeCompare(b.title),
    );
  }, [days, byParent]);

  /** The name of the deck being narrowed to, for the panel's own heading. */
  const selectedParentTitle =
    selectedParent === null
      ? null
      : (byParent.get(selected?.key ?? "")?.get(selectedParent)?.title ?? null);

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

  /**
   * Which of the five tints a day's count falls on.
   *
   * Square-rooted, not linear. One heavy day is typically several times any
   * other, and against a linear scale every ordinary day collapses into the
   * same pale tint — the shape of a normal week disappears behind the spike.
   */
  function shadeIndex(count: number): number {
    const ratio = max === 0 ? 0 : Math.sqrt(count / max);
    return Math.min(
      STEPS.length - 1,
      Math.floor(ratio * (STEPS.length - 1) + 0.5),
    );
  }

  function shade(count: number): string {
    if (count === 0) return "bg-transparent text-muted-foreground";
    return STEPS[shadeIndex(count)];
  }

  /**
   * A deck's colour, lightened on the tints dark enough to swallow it.
   *
   * The band's text is the deck's accent, and the heaviest cells are deep
   * violet — a mid-tone blue on that is technically present and practically
   * unreadable. Mixing towards white keeps the hue, which is what identifies
   * the deck, while restoring the contrast.
   */
  function bandColour(deckId: number, count: number): string {
    const accent = accentVar(deckId);
    return shadeIndex(count) >= 3
      ? `color-mix(in oklab, ${accent} 50%, white)`
      : accent;
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
          const className = `relative flex aspect-square flex-col overflow-hidden rounded-lg border transition-colors ${outline} ${
            day.inMonth
              ? shade(day.count)
              : "border-transparent bg-transparent text-muted-foreground/40"
          }`;

          // Every deck on this month's grid gets a band, whether or not it has
          // cards today: the bands are how a deck is identified at a glance, so
          // they cannot move about from square to square. A deck with nothing
          // due reads 0 and is not clickable — there is no list behind it.
          const bands = clickable
            ? monthParents.map((parent) => ({
                ...parent,
                count: byParent.get(day.key)?.get(parent.id)?.count ?? 0,
              }))
            : [];

          return (
            // A container of buttons rather than one button: each deck's count
            // opens that deck, and the date opens the day whole.
            <div key={day.key} className={className} title={title}>
              {clickable ? (
                <button
                  type="button"
                  aria-pressed={isSelected && selectedParent === null}
                  title={`${day.count} due — every deck`}
                  onClick={() =>
                    selectDay(
                      isSelected && selectedParent === null ? null : day.key,
                    )
                  }
                  className="absolute top-0.5 left-0.5 z-10 cursor-pointer rounded px-1 text-[0.65rem] opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none"
                >
                  {day.date.getDate()}
                  <span className="sr-only"> — every deck</span>
                </button>
              ) : (
                <span className="absolute top-1 left-1.5 text-[0.65rem] opacity-70">
                  {day.date.getDate()}
                </span>
              )}

              {/* The square is divided between the decks, one band each,
                  separated by a hairline. The day's total is deliberately gone:
                  it was the sum of two collections studied separately, so it
                  was never a number to act on — these are. */}
              {clickable &&
                bands.map((band, index) => {
                  const active = isSelected && selectedParent === band.id;
                  return (
                    <button
                      key={band.id}
                      type="button"
                      disabled={band.count === 0}
                      aria-pressed={active}
                      title={
                        band.count === 0
                          ? `${band.title} — nothing due`
                          : `${band.title} — ${band.count} due. Click for its sub-decks`
                      }
                      style={
                        {
                          "--band": bandColour(band.id, day.count),
                        } as CSSProperties
                      }
                      onClick={() =>
                        selectDay(active ? null : day.key, band.id)
                      }
                      // The first band starts below the date in the corner
                      // rather than under it, so the deck name is never read
                      // through the day number.
                      className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 leading-none tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 focus-visible:outline-none ${
                        index > 0 ? "border-t border-current/15" : "pt-4"
                      } ${
                        band.count === 0
                          ? "opacity-35"
                          : active
                            ? "cursor-pointer bg-current/10"
                            : "cursor-pointer hover:bg-current/5"
                      }`}
                    >
                      {/* Name above count, both in the deck's own colour, so
                          the pair reads as one statement about one deck. Stacked
                          rather than set on a line: a name and a large number
                          side by side do not fit a square this size, and the
                          number is the part that must stay big. A faint shadow
                          keeps the accent legible on the darkest cells. */}
                      <span
                        className="max-w-full truncate text-[0.55rem] leading-tight font-semibold tracking-tight text-[var(--band)] sm:text-[0.7rem]"
                        style={{ textShadow: "0 0 3px rgb(0 0 0 / 0.28)" }}
                      >
                        {band.title}
                      </span>
                      <span
                        className="text-lg font-bold text-[var(--band)] sm:text-2xl"
                        style={{ textShadow: "0 0 3px rgb(0 0 0 / 0.28)" }}
                      >
                        {band.count}
                      </span>
                    </button>
                  );
                })}
            </div>
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
                {selectedParentTitle && (
                  <>
                    <span className="text-muted-foreground"> · </span>
                    <span
                      aria-hidden
                      className="mr-1.5 inline-block size-2 rounded-full align-middle"
                      style={{
                        background: accentVar(selectedParent ?? 0),
                      }}
                    />
                    {selectedParentTitle}
                  </>
                )}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {/* When narrowed, the totals are that deck's — quoting the
                    day's full count next to one deck's sub-decks would not
                    add up. */}
                {selectedParent === null
                  ? selected.count
                  : selectedDecks.reduce((sum, d) => sum + d.count, 0)}{" "}
                card
                {(selectedParent === null
                  ? selected.count
                  : selectedDecks.reduce((sum, d) => sum + d.count, 0)) === 1
                  ? ""
                  : "s"}{" "}
                across {selectedDecks.length} deck
                {selectedDecks.length === 1 ? "" : "s"}
                {selectedParent === null &&
                  selected.overdue > 0 &&
                  `, including ${selected.overdue} overdue`}
              </p>
              {selectedParent !== null && (
                <button
                  type="button"
                  onClick={() => selectDay(selected.key)}
                  className="mt-1 cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Show every deck for this day
                </button>
              )}
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
                  href={`/deck/?id=${deck.id}`}
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
        {/* No key for the colours: every cell names its own decks now, so a
            legend would only repeat what is already on screen. */}
        {max > 0 && (
          <span>Click a count for its sub-decks, or the date for the day</span>
        )}
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
