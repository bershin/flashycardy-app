"use client";

import {
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CalendarArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Ellipsis,
  Layers,
  Plus,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { accentVar } from "@/lib/deck-accent";
import { useStore, useStoreReady } from "@/lib/store/use-store";
import { isArchiveDeck, startOfDay } from "@/lib/store/selectors";
import { selectTodoDays } from "@/db/queries/todos";
import type { CardRow, DbDoc } from "@/lib/store/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { deleteCardsAction, setCardsScheduleAction } from "@/app/deck/actions";
import { REVIEW_SCHEDULES, type ReviewSchedule } from "@/lib/store/types";
import { MoveDueCardsDialog, type MovableCard } from "./move-due-cards-dialog";
import {
  getLastMove,
  lastMoveServerSnapshot,
  setLastMove,
  subscribeLastMove,
} from "./last-move";
import { undoRescheduleAction } from "@/app/deck/actions";
import { DayTodos } from "./day-todos";
import { isTodoDrag, readTodoDrag } from "./todo-drag";
import { updateDayTodoAction } from "./actions";

/**
 * How many weeks the grid shows at once.
 *
 * Six, which is what a month grid needed at its widest — so the page is the
 * size it always was, and scrolling changes which weeks are in it rather than
 * how much there is to look at.
 */
const WINDOW_WEEKS = 6;

/**
 * How far the scrollable ribbon reaches either side of this week.
 *
 * Rendered in full rather than fetched as you go: a cell is a handful of
 * elements and this is one person's calendar, so eight months of them costs
 * less than the machinery for loading weeks on demand would.
 */
const WEEKS_BEFORE = 4;
const WEEKS_AFTER = 30;
const TOTAL_WEEKS = WEEKS_BEFORE + WEEKS_AFTER;

const SCHEDULE_LABELS: Record<ReviewSchedule, string> = {
  incremental: "Widening",
  weekly: "Steady",
};

/** Monday-first, matching how a week is read here. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Day = {
  date: Date;
  key: string;
  /** True on the 1st, where the grid crosses into a new month. */
  startsMonth: boolean;
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

/**
 * What the corner of a square reads.
 *
 * Plain on most days; on the 1st the month comes with it, because with the
 * window free to sit across two months a bare "1" between the 31st and the 2nd
 * is the only thing that says which month you are now looking at.
 */
function dayNumber(day: Day): string {
  return day.startsMonth
    ? day.date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : String(day.date.getDate());
}

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

function CalendarPageContent() {
  const ready = useStoreReady();
  const searchParams = useSearchParams();
  const { cards, deckOf } = useStore(
    useCallback((db: DbDoc) => selectActiveCards(db), []),
  );
  /** Keyed by day, so a cell can mark itself without searching the list. */
  const todoDays = useStore(
    useCallback((db: DbDoc) => selectTodoDays(db, LOCAL_USER_ID), []),
  );
  /** The square a dragged item is currently over, if any. */
  const [dropDay, setDropDay] = useState<string | null>(null);
  /** The deck-day whose cards are being deleted, pending confirmation. */
  const [deleting, setDeleting] = useState<DeckCount | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchNote, setBatchNote] = useState<string | null>(null);

  /**
   * Apply something to every card a deck has on the open day.
   *
   * The ids are already here — the breakdown carries them so the move dialog
   * can name them — so nothing has to be re-derived from the day and the deck.
   */
  async function runOnDeckDay(
    deck: DeckCount,
    said: string,
    work: (ids: number[]) => Promise<unknown>,
  ) {
    setBatchBusy(true);
    try {
      await work(deck.cards.map((c) => c.id));
      setBatchNote(`${said} · ${deck.title}`);
    } finally {
      setBatchBusy(false);
    }
  }

  /**
   * Bumped whenever a square asks for the cursor in the add field.
   *
   * Starts at one when the header's todo icon sent us here with `?todo=new`,
   * so arriving that way lands in the add field for today rather than at the
   * top of a page that still needs a click. Read once, as the initial value:
   * the signal is a request made on arrival, not a piece of state the URL
   * keeps owning, and re-reading it would put the cursor back every render.
   */
  const [addSignal, setAddSignal] = useState(
    searchParams.get("todo") === "new" ? 1 : 0,
  );
  /** The topmost week in view, as an index into the rendered range. */
  const [topWeek, setTopWeek] = useState(WEEKS_BEFORE);
  const ribbon = useRef<HTMLDivElement | null>(null);
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

  const { days, max, overdueTotal, byDeck, byParent, counts } = useMemo(() => {
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

    // One long ribbon of weeks that scrolls, rather than a month you page
    // through. Anchoring to a month meant the days after the 31st were
    // greyed-out scenery you had to leave the month to reach; here every square
    // is a real day and the next month is simply further down.
    const start = new Date(today);
    start.setDate(
      start.getDate() - ((start.getDay() + 6) % 7) - WEEKS_BEFORE * 7,
    );

    const days: Day[] = [];
    for (let i = 0; i < TOTAL_WEEKS * 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const key = ymd(date);
      days.push({
        date,
        key,
        startsMonth: date.getDate() === 1,
        isToday: key === ymd(today),
        count: counts.get(key) ?? 0,
        overdue: key === ymd(today) ? overdueTotal : 0,
      });
    }

    const max = Math.max(...days.map((d) => d.count), 0);

    return { days, max, overdueTotal, byDeck, byParent, counts };
  }, [cards, deckOf]);

  /**
   * What the heading describes: the six weeks currently in view.
   *
   * Recomputed as the ribbon scrolls, because a total covering eight months
   * would be a number about nothing you can see.
   */
  const { rangeLabel, windowTotal, busiest } = useMemo(() => {
    const shown = days.slice(topWeek * 7, (topWeek + WINDOW_WEEKS) * 7);
    const first = shown[0].date;
    const last = shown[shown.length - 1].date;
    const sameYear = first.getFullYear() === last.getFullYear();
    return {
      rangeLabel:
        first.getMonth() === last.getMonth() && sameYear
          ? first.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })
          : `${first.toLocaleDateString(undefined, { month: "short", ...(sameYear ? {} : { year: "numeric" }) })} – ${last.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`,
      windowTotal: shown.reduce((sum, d) => sum + d.count, 0),
      busiest: shown.reduce<Day | null>(
        (best, d) => (d.count > (best?.count ?? 0) ? d : best),
        null,
      ),
    };
  }, [days, topWeek]);

  /**
   * How many cards a day holds, for any date — including ones off this grid,
   * which the move dialog can reach with its date field.
   */
  const countOn = useCallback((key: string) => counts.get(key) ?? 0, [counts]);

  const selected = selectedKey
    ? (days.find((d) => d.key === selectedKey) ?? null)
    : null;

  /**
   * The day the list at the top belongs to: the one picked, or today.
   *
   * Falling back to today rather than hiding means the page opens on the list
   * you are most likely to want, and a month you are only browsing does not
   * quietly leave you editing a day you had forgotten was selected.
   */
  const todayKey = ymd(startOfDay(new Date()));
  const todoDay = selected?.key ?? todayKey;

  /** The picked day's decks, heaviest first, narrowed to one parent if asked. */
  const selectedDecks = useMemo(() => {
    if (!selected) return [];
    return [...(byDeck.get(selected.key)?.values() ?? [])]
      .filter((d) => selectedParent === null || d.rootId === selectedParent)
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  }, [byDeck, selected, selectedParent]);

  /** What the open panel is counting: the whole day, or one parent's share. */
  const selectedCount =
    selectedParent === null
      ? (selected?.count ?? 0)
      : selectedDecks.reduce((sum, d) => sum + d.count, 0);

  /**
   * The top-level decks with anything on the visible weeks.
   *
   * Every cell is divided between these in this order, so a deck keeps the same
   * half of every square — the position becomes as good a label as the letter,
   * and a row of cells can be scanned without reading either. Dashboard order,
   * so the two screens agree on which deck comes first.
   */
  const gridParents = useMemo(() => {
    const seen = new Map<number, ParentCount>();
    for (const day of days) {
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

  /** The pixel pitch of one week row, measured rather than assumed. */
  function weekPitch(box: HTMLDivElement): number {
    return box.scrollHeight / TOTAL_WEEKS;
  }

  /**
   * Move the ribbon by whole weeks.
   *
   * The scroll position is the source of truth — `topWeek` follows it rather
   * than driving it — so the buttons and the wheel cannot disagree about where
   * the calendar is.
   */
  function scrollWeeks(delta: number) {
    const box = ribbon.current;
    if (!box) return;
    box.scrollTo({
      top: (topWeek + delta) * weekPitch(box),
      // Animated only when there is someone to watch it. A smooth scroll is
      // driven by animation frames, which a hidden tab does not get — so the
      // move simply never happened until the tab was looked at again.
      behavior: document.visibilityState === "visible" ? "smooth" : "auto",
    });
  }

  /**
   * Bring the week holding a date into view.
   *
   * Measured from the ribbon's own first day rather than from today, so it
   * stays right however far the view has been scrolled — and clamped, because
   * a date outside the eight months rendered has no week to show and should
   * land on the nearest one rather than nowhere.
   */
  function scrollToDay(target: Date) {
    const start = days[0].date;
    const week = Math.floor(
      (startOfDay(target).getTime() - startOfDay(start).getTime()) /
        (7 * 24 * 60 * 60 * 1000),
    );
    const clamped = Math.min(Math.max(week, 0), TOTAL_WEEKS - WINDOW_WEEKS);
    scrollWeeks(clamped - topWeek);
  }

  /**
   * Move the day the page is about.
   *
   * The field names a day, not a week, so the arrows either side of it move by
   * one — and the grid follows only when that day falls in a different week,
   * because the squares are laid out a week at a time. The to-do list below
   * follows too: it is the same day, and having the header and the list
   * disagree about which day is in question would be the confusing part.
   */
  function goToDay(key: string) {
    const [year, month, day] = key.split("-").map(Number);
    selectDay(key);
    scrollToDay(new Date(year, month - 1, day));
  }

  function stepDay(delta: number) {
    const [year, month, day] = todoDay.split("-").map(Number);
    goToDay(ymd(new Date(year, month - 1, day + delta)));
  }

  function stepMonth(delta: number) {
    const [year, month, day] = todoDay.split("-").map(Number);
    // Clamped to the month's length, so the 31st stepping into a short month
    // lands on its last day rather than sliding into the next one.
    const target = new Date(year, month - 1 + delta, 1);
    const lastDay = new Date(year, month + delta, 0).getDate();
    target.setDate(Math.min(day, lastDay));
    goToDay(ymd(target));
  }

  function onRibbonScroll() {
    const box = ribbon.current;
    if (!box) return;
    const week = Math.round(box.scrollTop / weekPitch(box));
    // Clamped so the heading never describes weeks past the end of the ribbon.
    const clamped = Math.min(Math.max(week, 0), TOTAL_WEEKS - WINDOW_WEEKS);
    if (clamped !== topWeek) setTopWeek(clamped);
  }

  /**
   * Opens on this week, not on the four weeks of history above it.
   *
   * Done as the node mounts rather than in an effect, because the page spends
   * its first render on a loading skeleton with no ribbon in it — an effect
   * with an empty dependency list would fire against nothing and never run
   * again.
   */
  const placed = useRef(false);
  const attachRibbon = useCallback((node: HTMLDivElement | null) => {
    ribbon.current = node;
    if (!node || placed.current) return;
    placed.current = true;
    node.scrollTop = (WEEKS_BEFORE * node.scrollHeight) / TOTAL_WEEKS;
  }, []);

  /**
   * The heaviest single deck-day on the grid, which the tints are scaled to.
   *
   * Per band rather than per day: the bands are what carry the colour now, and
   * scaling them against a day's combined total would leave the smaller deck
   * permanently pale however busy its own week was.
   */
  const bandMax = useMemo(() => {
    let most = 0;
    for (const day of days) {
      for (const parent of byParent.get(day.key)?.values() ?? []) {
        most = Math.max(most, parent.count);
      }
    }
    return most;
  }, [days, byParent]);

  /**
   * How strongly a band is tinted, 0 to 1.
   *
   * Square-rooted, not linear. One heavy day is typically several times any
   * other, and against a linear scale every ordinary day collapses into the
   * same pale wash — the shape of a normal week disappears behind the spike.
   */
  function intensity(count: number): number {
    if (count === 0 || bandMax === 0) return 0;
    return Math.sqrt(count / bandMax);
  }

  /**
   * A band's fill: its deck's colour, deepening with its own count.
   *
   * Hue says which deck, depth says how much — one swatch answering both, which
   * is what a square this small has room for.
   */
  function bandFill(deckId: number, count: number): string {
    const strength = 10 + intensity(count) * 80;
    return `color-mix(in oklab, ${accentVar(deckId)} ${strength}%, transparent)`;
  }

  /** White once the fill is deep enough to swallow ordinary text. */
  function bandText(count: number): string {
    return intensity(count) > 0.62 ? "text-white" : "text-foreground";
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
            {rangeLabel}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {windowTotal === 0
              ? "Nothing due in these weeks"
              : `${windowTotal} card${windowTotal === 1 ? "" : "s"} due in these weeks`}
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
          {/* Two scales, because the grid spans eight months: the single
              arrows nudge a week, the double ones step a month. */}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back a month"
            title="Back a month"
            onClick={() => stepMonth(-1)}
          >
            <ChevronsLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back a day"
            title="Back a day"
            onClick={() => stepDay(-1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          {topWeek !== WEEKS_BEFORE && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => scrollWeeks(WEEKS_BEFORE - topWeek)}
            >
              Today
            </Button>
          )}
          {/* The same control as the dashboard's, between the same arrows: the
              ribbon reaches eight months, and stepping a week at a time to a
              date in November is not reaching it. */}
          <Input
            type="date"
            aria-label="Go to a day"
            value={todoDay}
            onChange={(e) => e.target.value && goToDay(e.target.value)}
            className="h-8 w-[9.5rem] px-2 py-0 text-xs"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Forward a day"
            title="Forward a day"
            onClick={() => stepDay(1)}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Forward a month"
            title="Forward a month"
            onClick={() => stepMonth(1)}
          >
            <ChevronsRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Above the grid rather than under it: the list is the part you act on,
          and it was a scroll away from the days it belongs to. Sitting here it
          is the first thing the page says, and an item is dragged down onto a
          square rather than up out of a panel. */}
      <div className="mt-6 rounded-lg border border-border/60 bg-card/60 px-4 pt-3 pb-4">
        <DayTodos
          key={todoDay}
          date={todoDay}
          // Named, because the list shown is not always today's — clicking a
          // square switches it, and a list with no date on it would look like
          // today's however far into the month you had clicked.
          label={todoDay === todayKey ? "Today" : keyLabel(todoDay)}
          focusSignal={addSignal}
        />
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
      </div>

      {/* The weeks are a real scrolling region, not a wheel handler pretending
          to be one: the wheel, a trackpad, a scrollbar and the keyboard all
          work without being taught to, and `overscroll-contain` stops a flick
          that ends at the last week from carrying on into the page. */}
      <div
        ref={attachRibbon}
        onScroll={onRibbonScroll}
        className="grid max-h-[70vh] snap-y snap-proximity grid-cols-7 gap-1 overflow-y-auto overscroll-contain sm:gap-2"
      >
        {days.map((day) => {
          const isSelected = day.key === selected?.key;
          // Days with nothing on them have no breakdown to open, so they stay
          // plain cells rather than buttons that would do nothing.
          const clickable = day.count > 0;
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
          // The cell itself is plain now: the colour lives in the bands, where
          // it can say whose cards these are as well as how many.
          // `snap-start` on every cell lands the scroll on a whole week rather
          // than halfway through one — the cells of a row share a top edge, so
          // snapping them individually snaps the row.
          const className = `group/day relative flex aspect-square snap-start flex-col overflow-hidden rounded-lg border bg-transparent transition-colors ${outline}`;

          // Every deck on this month's grid gets a band, whether or not it has
          // cards today: the bands are how a deck is identified at a glance, so
          // they cannot move about from square to square. A deck with nothing
          // due reads 0 and is not clickable — there is no list behind it.
          const bands = clickable
            ? gridParents.map((parent) => ({
                ...parent,
                count: byParent.get(day.key)?.get(parent.id)?.count ?? 0,
              }))
            : [];

          const dropping = dropDay === day.key;

          return (
            // A container of buttons rather than one button: each deck's count
            // opens that deck, and the date opens the day whole. It is also the
            // drop target for an item dragged out of the panel below — the
            // wrapper rather than any button inside it, so every part of the
            // square accepts it.
            <div
              key={day.key}
              className={`${className} ${dropping ? "outline-2 outline-offset-2 outline-amber-500" : ""}`}
              title={title}
              onDragOver={(e) => {
                if (!isTodoDrag(e)) return;
                // Without this the browser refuses the drop entirely.
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dropDay !== day.key) setDropDay(day.key);
              }}
              onDragLeave={(e) => {
                // Moving between the square's own children fires a leave for
                // each one; only a leave that exits the square counts.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  return;
                }
                setDropDay((current) => (current === day.key ? null : current));
              }}
              onDrop={(e) => {
                const id = readTodoDrag(e);
                setDropDay(null);
                if (id === null) return;
                e.preventDefault();
                void updateDayTodoAction({ id, date: day.key });
                // The panel follows the item, so the list you were working in
                // is the one you can still see. Opened whole rather than
                // narrowed: the deck you had filtered to need not have
                // anything on the day you dropped onto.
                selectDay(day.key);
              }}
            >
              {/* Adding straight from the square: it picks the day and puts
                  the cursor in the list above in one go, rather than leaving
                  you to find the field yourself. Shown on hover, and on
                  keyboard focus, so it costs the cell nothing at rest. */}
              <button
                type="button"
                title={`Add something to do on ${day.date.toLocaleDateString()}`}
                aria-label={`Add something to do on ${day.date.toLocaleDateString()}`}
                onClick={() => {
                  selectDay(day.key);
                  setAddSignal((n) => n + 1);
                }}
                className="absolute right-1 bottom-1 z-20 flex size-5 cursor-pointer items-center justify-center rounded-md bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none group-hover/day:opacity-100"
              >
                <Plus className="size-3.5" />
              </button>

              {todoDays.has(day.key) && (
                // Above the bands, which are laid over the whole square on a
                // day that has cards. Filled while anything is still open,
                // hollow once the day's list is finished — a day that has been
                // dealt with should not keep asking to be looked at.
                <span
                  aria-hidden
                  title={
                    todoDays.get(day.key)!.open > 0
                      ? `${todoDays.get(day.key)!.open} still to do`
                      : "Everything here is done"
                  }
                  className={`absolute top-1.5 right-1.5 z-20 size-1.5 rounded-full ${
                    todoDays.get(day.key)!.open > 0
                      ? "bg-amber-500"
                      : // Carries its own background so the ring reads against a
                        // saturated band as well as an empty square.
                        "border border-emerald-500 bg-background"
                  }`}
                />
              )}
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
                  {dayNumber(day)}
                  <span className="sr-only"> — every deck</span>
                </button>
              ) : (
                // Openable even with nothing due: a free day is exactly the one
                // worth putting "away until Thursday" on.
                <button
                  type="button"
                  aria-pressed={isSelected}
                  title={`${day.date.toLocaleDateString()} — nothing due. Click to add something to do`}
                  onClick={() => selectDay(isSelected ? null : day.key)}
                  className="absolute inset-0 cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 focus-visible:outline-none"
                >
                  <span className="absolute top-1 left-1.5 text-[0.65rem] opacity-70">
                    {dayNumber(day)}
                  </span>
                </button>
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
                      style={{ background: bandFill(band.id, band.count) }}
                      onClick={() =>
                        selectDay(active ? null : day.key, band.id)
                      }
                      // The first band starts below the date in the corner
                      // rather than under it, so nothing is read through the
                      // day number.
                      className={`group/band relative flex min-w-0 flex-1 flex-col items-center justify-center px-1 leading-none tabular-nums transition-[filter] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 focus-visible:outline-none ${
                        index > 0 ? "border-t border-black/10" : "pt-3"
                      } ${bandText(band.count)} ${
                        band.count === 0
                          ? "opacity-60"
                          : active
                            ? "cursor-pointer brightness-90"
                            : "cursor-pointer hover:brightness-95"
                      }`}
                    >
                      {/* The name is a hover away rather than always present:
                          the fill already says which deck this is, and at rest
                          the number should have the band to itself. */}
                      <span className="pointer-events-none absolute inset-x-1 top-0.5 hidden truncate text-center text-[0.55rem] leading-tight font-semibold tracking-tight opacity-80 group-hover/band:block group-focus-visible/band:block sm:text-[0.65rem]">
                        {band.title}
                      </span>
                      <span className="sr-only">{band.title} </span>
                      <span className="text-lg font-bold sm:text-2xl">
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
                    add up. A free day is opened for its note, so it says so
                    rather than reporting "0 cards across 0 decks". */}
                {selectedCount === 0 ? (
                  "Nothing due"
                ) : (
                  <>
                    {selectedCount} card{selectedCount === 1 ? "" : "s"} across{" "}
                    {selectedDecks.length} deck
                    {selectedDecks.length === 1 ? "" : "s"}
                    {selectedParent === null &&
                      selected.overdue > 0 &&
                      `, including ${selected.overdue} overdue`}
                  </>
                )}
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

          {batchNote && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              {batchNote}
            </p>
          )}

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
                {/* The rest of what can be done to a batch. Moving keeps its
                    own button because it is why this row is being looked at —
                    the day is heavy — while these are the occasional ones. */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`More actions for ${deck.title}`}
                    className="shrink-0 cursor-pointer rounded-md border border-border/60 px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:border-violet-500 hover:text-foreground"
                  >
                    <Ellipsis className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {REVIEW_SCHEDULES.map((schedule) => (
                      <DropdownMenuItem
                        key={schedule}
                        disabled={batchBusy}
                        onClick={() =>
                          runOnDeckDay(
                            deck,
                            `Put ${deck.count} on ${SCHEDULE_LABELS[schedule]}`,
                            (ids) =>
                              setCardsScheduleAction({
                                cardIds: ids,
                                schedule,
                              }),
                          )
                        }
                      >
                        <Layers />
                        Put these {deck.count} on {SCHEDULE_LABELS[schedule]}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem
                      disabled={batchBusy}
                      onClick={() => setDeleting(deck)}
                      variant="destructive"
                    >
                      <Trash2 />
                      Delete these {deck.count}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleting?.count} card
              {deleting?.count === 1 ? "" : "s"} from {deleting?.title}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {/* Named by day as well as deck: this is reached from a square,
                  and "the ones due then" is the part that could be misread. */}
              {`The ${deleting?.count} due on ${selected ? keyLabel(selected.key) : "this day"} go, not the whole deck.`}{" "}
              This cannot be undone here, though a copy of your decks before
              this change stays in your sync repo&rsquo;s history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              disabled={batchBusy}
              onClick={() => {
                const deck = deleting;
                setDeleting(null);
                if (deck) {
                  void runOnDeckDay(deck, `Deleted ${deck.count}`, (ids) =>
                    deleteCardsAction({ cardIds: ids }),
                  );
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
        {/* The names are behind a hover now, so the key carries them: each
            deck's colour, and the scale that colour is read on. */}
        {gridParents.map((parent) => (
          <div key={parent.id} className="flex items-center gap-2">
            <span className="font-medium text-foreground">{parent.title}</span>
            <span className="flex gap-0.5">
              {[0.15, 0.4, 0.7, 1].map((step) => (
                <span
                  key={step}
                  className="size-4 rounded-sm"
                  style={{
                    background: `color-mix(in oklab, ${accentVar(parent.id)} ${10 + step * 80}%, transparent)`,
                  }}
                />
              ))}
            </span>
          </div>
        ))}
        {bandMax > 0 && (
          <span>Deeper is heavier, up to {bandMax} in a day</span>
        )}
        {max > 0 && (
          <span>
            Scroll the grid to move through the weeks · Click a count for its
            sub-decks, or the date for the day
          </span>
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

export default function CalendarPage() {
  // `useSearchParams` suspends during prerender, so the boundary is required.
  return (
    <Suspense>
      <CalendarPageContent />
    </Suspense>
  );
}
