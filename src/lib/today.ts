"use client";

/**
 * What day it is, as something React can subscribe to.
 *
 * Half this app's screen is an answer to "today": what is due, what is new,
 * whether a deck has been studied. All of it was computed during render from
 * `new Date()`, which is correct at the moment it runs and then quietly wrong
 * from midnight onwards — a tab left open overnight kept yesterday's counts and
 * went on claiming a deck had been studied today, because nothing had happened
 * to make it render again.
 *
 * The date is external state, like the theme and the sync status, so it is read
 * the same way: a snapshot that changes when the day does, and a subscription
 * that says when.
 *
 * The snapshot is a `YYYY-MM-DD` string rather than a Date, because
 * `useSyncExternalStore` compares by identity and a fresh Date every call would
 * re-render for ever.
 */

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

let current = ymd(new Date());
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function announceIfChanged(): void {
  const now = ymd(new Date());
  if (now === current) return;
  current = now;
  for (const listener of listeners) listener();
}

/**
 * Wake just after the next midnight.
 *
 * A timer rather than a poll, and re-armed each time: one wake-up a day costs
 * nothing, where a minute-by-minute poll would keep a phone's tab alive for the
 * sake of a date that changes once.
 *
 * The visibility handler covers what a timer cannot — a laptop asleep at
 * midnight fires its timer late or not at all, and the first thing that happens
 * on waking is the tab becoming visible again.
 */
function schedule(): void {
  if (typeof window === "undefined") return;
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  // A second past, so the clock has certainly rolled over when this runs.
  const delay = Math.max(1000, midnight.getTime() - Date.now() + 1000);
  timer = setTimeout(() => {
    announceIfChanged();
    schedule();
  }, delay);
}

export function subscribeToday(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    schedule();
    window.addEventListener("visibilitychange", announceIfChanged);
    window.addEventListener("focus", announceIfChanged);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      if (timer) clearTimeout(timer);
      timer = null;
      window.removeEventListener("visibilitychange", announceIfChanged);
      window.removeEventListener("focus", announceIfChanged);
    }
  };
}

export function getToday(): string {
  return current;
}

/** Prerendered HTML carries no day; the browser's arrives on hydration. */
export function getTodayServerSnapshot(): string {
  return "";
}
