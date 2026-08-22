"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ListTodo,
  Plus,
  Star,
} from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectTodosByUser } from "@/db/queries/todos";
import { addDayTodoAction, updateDayTodoAction } from "@/app/calendar/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DayTodo, DbDoc } from "@/lib/store/types";

/** How far ahead the "and then" count reaches. */
const LOOKAHEAD_DAYS = 7;

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDay(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return ymd(new Date(year, month - 1, day + days));
}

function dayLabel(key: string, todayKey: string, tomorrowKey: string): string {
  if (key === todayKey) return "Today";
  if (key === tomorrowKey) return "Tomorrow";
  if (key === shiftDay(todayKey, -1)) return "Yesterday";
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

/**
 * One day's outstanding items, with the days either side a click away.
 *
 * A week of days listed at once buried the decks — the thing the dashboard is
 * actually for — under a wall of rows that were mostly not today's problem. A
 * day at a time keeps it to a few lines and puts the rest behind an arrow.
 *
 * Anything still open from before today is the exception, and rides along with
 * today rather than staying on the day it was written: in a strict day view it
 * would disappear the moment its day passed, which is precisely when it most
 * needs saying. Finished items are left behind on their own day.
 */
export function DashboardTodos() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = ymd(today);
  const tomorrowKey = shiftDay(todayKey, 1);
  const horizonKey = shiftDay(todayKey, LOOKAHEAD_DAYS);

  const all = useStore(
    useCallback((db: DbDoc) => selectTodosByUser(db, LOCAL_USER_ID), []),
  );
  const [pending, startWriting] = useTransition();
  /** The day on show. Starts on today and stays where it is put. */
  const [viewDay, setViewDay] = useState(todayKey);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const addRef = useRef<HTMLInputElement>(null);

  const open = all.filter((t) => !t.done);
  const onToday = viewDay === todayKey;
  // Keys are `YYYY-MM-DD`, so string comparison is date comparison — no
  // parsing, and no timezone to get wrong.
  const overdue = onToday ? open.filter((t) => t.date < todayKey) : [];
  const showing = [...overdue, ...open.filter((t) => t.date === viewDay)].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      // Starred first, then timed in time order — a list with times on it reads
      // as a schedule — and the rest keep the order that day was arranged into.
      Number(b.important) - Number(a.important) ||
      Number(a.remindAt === null) - Number(b.remindAt === null) ||
      (a.remindAt ?? "").localeCompare(b.remindAt ?? "") ||
      a.position - b.position ||
      a.id - b.id,
  );
  /** What the arrow leads to: everything else still owed within the week. */
  const ahead = open.filter(
    (t) => t.date > viewDay && t.date <= horizonKey,
  ).length;

  const clock = new Date();
  const nowTime = `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`;
  /** A time that has gone by — the app was shut when it would have rung. */
  const missed = (t: DayTodo) =>
    t.remindAt !== null && (t.date < todayKey || t.remindAt <= nowTime);

  function add() {
    if (!draft.trim()) return;
    const text = draft;
    setDraft("");
    startWriting(async () => {
      await addDayTodoAction({ date: viewDay, text });
      addRef.current?.focus();
    });
  }

  const label = dayLabel(viewDay, todayKey, tomorrowKey);

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2">
        <ListTodo className="size-3.5 shrink-0 text-muted-foreground" />
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          To do
        </h2>
        <span className="text-xs font-medium">{label}</span>
        {ahead > 0 && (
          <span className="text-xs text-muted-foreground">
            · {ahead} more {onToday ? "this week" : "ahead"}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1">
          {!onToday && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setViewDay(todayKey)}
            >
              Today
            </Button>
          )}
          {/* The picker sits between the arrows it belongs with, so a day far
              off is reached without pressing one of them thirty times. */}
          <button
            type="button"
            title={`Show ${dayLabel(shiftDay(viewDay, -1), todayKey, tomorrowKey)}`}
            aria-label={`Show ${dayLabel(shiftDay(viewDay, -1), todayKey, tomorrowKey)}`}
            onClick={() => setViewDay(shiftDay(viewDay, -1))}
            className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <Input
            type="date"
            value={viewDay}
            aria-label="Show a particular day"
            onChange={(e) => e.target.value && setViewDay(e.target.value)}
            className="h-7 w-[9.5rem] px-2 py-0 text-xs"
          />
          <button
            type="button"
            title={`Show ${dayLabel(shiftDay(viewDay, 1), todayKey, tomorrowKey)}`}
            aria-label={`Show ${dayLabel(shiftDay(viewDay, 1), todayKey, tomorrowKey)}`}
            onClick={() => setViewDay(shiftDay(viewDay, 1))}
            className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </span>
      </div>

      <ul className="mt-2 grid gap-2">
        {showing.map((todo) => {
          const late = todo.date < todayKey;
          return (
            <li
              key={todo.id}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${
                late
                  ? "border-red-500/40 bg-red-500/5"
                  : onToday
                    ? "border-amber-500/50 bg-amber-500/10"
                    : "border-border/60 bg-card/40"
              }`}
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={false}
                aria-label={`Mark "${todo.text}" as done`}
                disabled={pending}
                onClick={() =>
                  startWriting(async () => {
                    await updateDayTodoAction({ id: todo.id, done: true });
                  })
                }
                className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded border border-input transition-colors hover:border-emerald-500 hover:bg-emerald-500/10"
              >
                <Check className="size-3 opacity-0 hover:opacity-40" />
              </button>
              {todo.important ? (
                <Star
                  aria-label="Important"
                  className="size-4 shrink-0 fill-current text-amber-500"
                />
              ) : (
                <ListTodo
                  aria-hidden
                  className={`size-4 shrink-0 ${onToday ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                />
              )}
              <Link
                href="/calendar/"
                className="min-w-0 flex-1 hover:underline"
              >
                {/* Only a straggler names its day: on the rest it would be the
                    heading repeated on every line. */}
                {late && (
                  <>
                    <span className="font-medium text-red-700 dark:text-red-300">
                      {dayLabel(todo.date, todayKey, tomorrowKey)}
                    </span>
                    <span className="text-muted-foreground"> · </span>
                  </>
                )}
                <span
                  className={
                    todo.important ? "font-medium" : "text-muted-foreground"
                  }
                >
                  {todo.text}
                </span>
              </Link>
              {todo.remindAt !== null && (
                <span
                  title={missed(todo) ? "This time has gone by" : undefined}
                  className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${
                    missed(todo)
                      ? "bg-red-500/10 text-red-700 dark:text-red-300"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  }`}
                >
                  <Clock className="size-3" />
                  {todo.remindAt}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <div className="mt-2 flex items-center gap-2">
          <Input
            ref={addRef}
            value={draft}
            autoFocus
            maxLength={500}
            placeholder={`Something to do ${onToday ? "today" : `on ${label.toLowerCase()}`}…`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
              if (e.key === "Escape") setAdding(false);
            }}
            // Folds away when left empty, so an abandoned field doesn't sit
            // open on the dashboard for the rest of the session.
            onBlur={() => !draft.trim() && setAdding(false)}
            className="h-8 max-w-md text-sm"
          />
          <Button
            size="sm"
            className="h-8"
            disabled={pending || !draft.trim()}
            onClick={add}
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3.5" />
          {/* Names the day it lands on, which is the one on show and not
              always today. */}
          {showing.length === 0
            ? `Nothing ${onToday ? "for today" : `on ${label.toLowerCase()}`} — add something`
            : `Add something for ${onToday ? "today" : label.toLowerCase()}`}
        </button>
      )}
    </div>
  );
}
