"use client";

import { useCallback } from "react";
import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectNotesByUser } from "@/db/queries/notes";
import type { DbDoc } from "@/lib/store/types";

/** How far ahead a note is worth warning about. */
const LOOKAHEAD_DAYS = 7;

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "Today", "Tomorrow", or a weekday — a date needs decoding, these don't. */
function when(date: string, todayKey: string, tomorrowKey: string): string {
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
 * Notes for today and the week ahead, shown where study actually starts.
 *
 * The calendar is where a note is written, but nobody opens the calendar to be
 * reminded of something — that is what makes a note a reminder rather than a
 * diary entry. Anything already past is dropped: a note is about its day, and
 * yesterday's is history.
 */
export function DayNotes() {
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
    useCallback((db: DbDoc) => selectNotesByUser(db, LOCAL_USER_ID), []),
  );
  // Keys are `YYYY-MM-DD`, so string comparison is date comparison — no
  // parsing, and no timezone to get wrong.
  const notes = all
    .filter((n) => n.date >= todayKey && n.date <= horizonKey)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (notes.length === 0) return null;

  return (
    <ul className="mt-6 grid gap-2">
      {notes.map((note) => {
        const isToday = note.date === todayKey;
        return (
          <li key={note.id}>
            <Link
              href="/calendar/"
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/60 ${
                isToday
                  ? "border-amber-500/50 bg-amber-500/10"
                  : "border-border/60 bg-card/40"
              }`}
            >
              <NotebookPen
                className={`mt-0.5 size-4 shrink-0 ${isToday ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
              />
              <span className="min-w-0">
                <span className="font-medium">
                  {when(note.date, todayKey, tomorrowKey)}
                </span>
                <span className="text-muted-foreground"> · </span>
                <span className="text-muted-foreground">{note.text}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
