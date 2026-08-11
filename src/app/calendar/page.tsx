"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore, useStoreReady } from "@/lib/store/use-store";
import { isArchiveDeck, startOfDay } from "@/lib/store/selectors";
import type { CardRow, DbDoc } from "@/lib/store/types";
import { Button } from "@/components/ui/button";

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

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Cards that are actually in rotation — archived decks are retired. */
function selectActiveCards(db: DbDoc): CardRow[] {
  const archived = new Set(
    db.decks.filter((d) => isArchiveDeck(db, d)).map((d) => d.id),
  );
  return db.cards.filter(
    (c) =>
      !archived.has(c.deckId) &&
      db.decks.some((d) => d.id === c.deckId && d.userId === LOCAL_USER_ID),
  );
}

export default function CalendarPage() {
  const ready = useStoreReady();
  const cards = useStore(useCallback((db: DbDoc) => selectActiveCards(db), []));
  const [monthOffset, setMonthOffset] = useState(0);

  const { days, monthLabel, monthTotal, busiest, max, overdueTotal } =
    useMemo(() => {
      const today = startOfDay(new Date());

      // Everything already past shows on today, which is where the app will
      // actually present it — dotting it across previous days would describe a
      // backlog that no longer exists as separate days of work.
      const counts = new Map<string, number>();
      let overdueTotal = 0;
      for (const card of cards) {
        const due = startOfDay(new Date(card.nextReviewAt));
        const day = due < today ? today : due;
        if (due < today) overdueTotal += 1;
        const key = ymd(day);
        counts.set(key, (counts.get(key) ?? 0) + 1);
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

      return { days, monthLabel, monthTotal, busiest, max, overdueTotal };
    }, [cards, monthOffset]);

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
            onClick={() => setMonthOffset((m) => m - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMonthOffset(0)}
            disabled={monthOffset === 0}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonthOffset((m) => m + 1)}
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

        {days.map((day) => (
          <div
            key={day.key}
            className={`relative flex aspect-square flex-col items-center justify-center rounded-lg border transition-colors ${
              day.isToday
                ? "border-primary ring-2 ring-primary/40"
                : "border-border/60"
            } ${day.inMonth ? shade(day.count) : "border-transparent bg-transparent text-muted-foreground/40"}`}
            title={
              day.count > 0
                ? `${day.date.toLocaleDateString()} — ${day.count} due${day.overdue > 0 ? `, including ${day.overdue} overdue` : ""}`
                : day.date.toLocaleDateString()
            }
          >
            <span className="absolute top-1 left-1.5 text-[0.65rem] opacity-70">
              {day.date.getDate()}
            </span>
            {day.inMonth && day.count > 0 && (
              <span className="text-base font-semibold tabular-nums sm:text-lg">
                {day.count}
              </span>
            )}
          </div>
        ))}
      </div>

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
