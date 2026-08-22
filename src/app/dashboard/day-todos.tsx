"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Clock, ListTodo, Plus, Star } from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectTodosByUser } from "@/db/queries/todos";
import { addDayTodoAction, updateDayTodoAction } from "@/app/calendar/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DayTodo, DbDoc } from "@/lib/store/types";

/** How far ahead something is worth warning about. */
const LOOKAHEAD_DAYS = 7;

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "Late", "Today", "Tomorrow", or a weekday — dates need decoding, these don't. */
function when(date: string, todayKey: string, tomorrowKey: string): string {
  if (date < todayKey) return "Overdue";
  if (date === todayKey) return "Today";
  if (date === tomorrowKey) return "Tomorrow";
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

/**
 * What there is to do today, plus anything overdue or coming up this week.
 *
 * The calendar is where a day's list is arranged, but nobody opens a calendar to
 * be reminded of something — that is what makes a list a reminder rather than a
 * diary. Finished items are left behind on their day: this is the part that is
 * still owed.
 *
 * Adding here writes to today, which is the only day this view is opinionated
 * about. Anything wanting a different day, a time, or a place in the order is a
 * click away on the calendar.
 */
export function DashboardTodos() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = ymd(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = ymd(tomorrow);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + LOOKAHEAD_DAYS);
  const horizonKey = ymd(horizon);

  // Filtered outside the selector, which stays a plain read of the store: the
  // window depends on today's date, and a selector that closes over it would be
  // rebuilt on every render anyway.
  const all = useStore(
    useCallback((db: DbDoc) => selectTodosByUser(db, LOCAL_USER_ID), []),
  );
  const [pending, startWriting] = useTransition();
  /** The add field is folded away until asked for — see the button below. */
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const addRef = useRef<HTMLInputElement>(null);

  function add() {
    if (!draft.trim()) return;
    const text = draft;
    setDraft("");
    startWriting(async () => {
      await addDayTodoAction({ date: todayKey, text });
      addRef.current?.focus();
    });
  }

  // Keys are `YYYY-MM-DD`, so string comparison is date comparison — no
  // parsing, and no timezone to get wrong. Anything left open on a past day
  // stays here rather than vanishing with the day it was written on. Within a
  // day, starred items come first, then timed ones in time order — a list with
  // times on it reads as a schedule — and the rest keep the order that day was
  // arranged into.
  const todos = all
    .filter((t) => !t.done && t.date <= horizonKey)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        Number(b.important) - Number(a.important) ||
        Number(a.remindAt === null) - Number(b.remindAt === null) ||
        (a.remindAt ?? "").localeCompare(b.remindAt ?? "") ||
        a.position - b.position ||
        a.id - b.id,
    );

  const urgent = (t: DayTodo) => t.date <= todayKey;
  // `today` was floored to midnight, so the clock comes from a fresh reading.
  const clock = new Date();
  const nowTime = `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`;
  /** A time today that has already gone by — the app was shut when it rang. */
  const missed = (t: DayTodo) =>
    t.remindAt !== null && (t.date < todayKey || t.remindAt <= nowTime);

  return (
    <div className="mt-6">
      <ul className="grid gap-2">
        {todos.map((todo) => (
          <li
            key={todo.id}
            className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${
              urgent(todo)
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
                className={`size-4 shrink-0 ${urgent(todo) ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
              />
            )}
            <Link href="/calendar/" className="min-w-0 flex-1 hover:underline">
              <span className="font-medium">
                {when(todo.date, todayKey, tomorrowKey)}
              </span>
              <span className="text-muted-foreground"> · </span>
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
                // A time that has gone says so: the reminder could only have rung
                // if the app happened to be open, so this is the record of it.
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
        ))}
      </ul>

      {adding ? (
        <div className="mt-2 flex items-center gap-2">
          <Input
            ref={addRef}
            value={draft}
            autoFocus
            maxLength={500}
            placeholder="Something to do today…"
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
          {/* Says which day it lands on: everything else in this list is
              labelled by day, and an unlabelled one would be a guess. */}
          Add something to do today
        </button>
      )}
    </div>
  );
}
