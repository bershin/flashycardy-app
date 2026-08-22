"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { BellRing, X } from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectTodosByUser } from "@/db/queries/todos";
import type { DayTodo, DbDoc } from "@/lib/store/types";

/**
 * How often the clock is checked.
 *
 * A poll rather than a timer per item, because a timer set for this afternoon
 * does not survive the machine going to sleep: it comes back having missed its
 * moment entirely. A poll notices late, which is the failure worth having.
 */
const TICK_MS = 30_000;

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Whether a notification can be shown at all, without asking for anything.
 *
 * Kept out of render: `Notification` does not exist on the server, and the
 * permission can change from browser settings while the app is open.
 */
function canNotify(): boolean {
  return (
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );
}

async function notify(todo: DayTodo): Promise<void> {
  if (!canNotify()) return;
  const options: NotificationOptions = {
    body: `Reminder · ${todo.remindAt}`,
    tag: `cue-todo-${todo.id}`,
    icon: "/icon-192x192.png",
    badge: "/icon-192x192.png",
  };
  try {
    // Through the service worker where there is one: a notification owned by
    // the registration outlives the page that asked for it, so it survives the
    // window being closed a second later.
    const registration = await navigator.serviceWorker?.ready;
    if (registration) {
      await registration.showNotification(todo.text, options);
      return;
    }
  } catch {
    /* falls through to the page-owned notification */
  }
  new Notification(todo.text, options);
}

/**
 * Rings today's timed items as their times come round.
 *
 * The honest shape of a reminder in an app with no server: this fires while the
 * app is open — a tab, or the installed window — and cannot fire while it is
 * closed. Real push would need a server holding a subscription and sending to
 * it, and there isn't one; the service worker's push handler is there for the
 * day there is. So the banner is the primary channel and the notification is
 * the bonus, rather than the other way round.
 */
export function TodoReminders() {
  const todos = useStore(
    useCallback((db: DbDoc) => selectTodosByUser(db, LOCAL_USER_ID), []),
  );
  const [rung, setRung] = useState<DayTodo[]>([]);
  /**
   * Items already dealt with, by id.
   *
   * Seeded on the first tick with everything whose time has already gone, so
   * opening the app at four in the afternoon doesn't announce the whole day at
   * once. What it means is that a reminder missed while the app was closed is
   * missed — the dashboard is where those are caught, marked as overdue.
   */
  const handled = useRef<Set<number> | null>(null);
  // Read inside the interval rather than closed over, so the tick always sees
  // the current list without being torn down and rebuilt on every edit.
  const latest = useRef(todos);
  useEffect(() => {
    latest.current = todos;
  }, [todos]);

  useEffect(() => {
    function tick() {
      const now = new Date();
      const today = ymd(now);
      const time = hhmm(now);
      const due = latest.current.filter(
        (t) => !t.done && t.remindAt !== null && t.date === today && t.remindAt <= time,
      );

      if (handled.current === null) {
        handled.current = new Set(due.map((t) => t.id));
        return;
      }

      const fresh = due.filter((t) => !handled.current!.has(t.id));
      if (fresh.length === 0) return;
      for (const todo of fresh) {
        handled.current.add(todo.id);
        void notify(todo);
      }
      setRung((current) => [...current, ...fresh]);
    }

    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  if (rung.length === 0) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-500/30 bg-amber-500/10 text-sm text-amber-900 dark:text-amber-100"
    >
      {rung.map((todo) => (
        <div key={todo.id} className="flex items-start gap-3 px-4 py-3">
          <BellRing className="mt-0.5 size-4 shrink-0" />
          <Link href="/calendar/" className="flex-1 hover:underline">
            <span className="font-medium">{todo.remindAt}</span>
            <span className="opacity-70"> · </span>
            {todo.text}
          </Link>
          <button
            type="button"
            aria-label="Dismiss this reminder"
            onClick={() => setRung((c) => c.filter((t) => t.id !== todo.id))}
            className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-amber-500/20"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * The browser's notification permission, as external state.
 *
 * It lives outside React — it can be changed from the browser's own settings,
 * and asking for it is a promise rather than a render — so it is read the same
 * way the theme is, rather than mirrored into component state.
 */
type PermissionState = NotificationPermission | "unsupported";

const permissionListeners = new Set<() => void>();

function subscribePermission(listener: () => void): () => void {
  permissionListeners.add(listener);
  return () => permissionListeners.delete(listener);
}

function getPermission(): PermissionState {
  return typeof Notification === "undefined"
    ? "unsupported"
    : Notification.permission;
}

/** Prerender has no browser to ask, and must not guess "granted". */
function getServerPermission(): PermissionState {
  return "default";
}

/**
 * Asks for notification permission, on a click and never otherwise.
 *
 * Browsers ignore — and Chrome penalises — a prompt raised on page load, and
 * rightly: the question only makes sense once there is something to be
 * notified about. Shown beside a list that has a time on it.
 */
export function EnableNotifications() {
  const permission = useSyncExternalStore(
    subscribePermission,
    getPermission,
    getServerPermission,
  );

  if (permission !== "default") return null;

  return (
    <button
      type="button"
      onClick={() =>
        void Notification.requestPermission().then(() => {
          for (const listener of permissionListeners) listener();
        })
      }
      className="cursor-pointer text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      Let Cue show a notification when a time comes round
    </button>
  );
}
