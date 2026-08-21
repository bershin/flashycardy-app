"use client";

import { useCallback, useTransition } from "react";
import Link from "next/link";
import { Check, ListTodo } from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectTodosByUser } from "@/db/queries/todos";
import { updateDayTodoAction } from "@/app/calendar/actions";
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
 * The calendar is where a day's list is written, but nobody opens a calendar to
 * be reminded of something — that is what makes a list a reminder rather than a
 * diary. Finished items are left behind on their day: this is the part that is
 * still owed.
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

  // Keys are `YYYY-MM-DD`, so string comparison is date comparison — no
  // parsing, and no timezone to get wrong. Anything left open on a past day
  // stays here rather than vanishing with the day it was written on.
  const todos = all
    .filter((t) => !t.done && t.date <= horizonKey)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  if (todos.length === 0) return null;

  const urgent = (t: DayTodo) => t.date <= todayKey;

  return (
    <ul className="mt-6 grid gap-2">
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
          <ListTodo
            aria-hidden
            className={`size-4 shrink-0 ${urgent(todo) ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
          />
          <Link href="/calendar/" className="min-w-0 flex-1 hover:underline">
            <span className="font-medium">
              {when(todo.date, todayKey, tomorrowKey)}
            </span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-muted-foreground">{todo.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
