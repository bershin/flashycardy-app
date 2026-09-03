"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CloudOff,
  CloudUpload,
  ListTodo,
  Moon,
  NotebookPen,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";
import {
  getServerTheme,
  getTheme,
  setTheme,
  subscribeTheme,
  type Theme,
} from "@/lib/theme";
import { buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useStore,
  useStoreBootstrap,
  useStoreNotice,
} from "@/lib/store/use-store";
import { dismissNotice } from "@/lib/store/local-store";
import { TodoReminders } from "@/components/todo-reminders";
import { ProfileMenu } from "@/components/profile-menu";
import {
  getLastCheckedAt,
  hasUnpushedChanges,
  getSyncError,
  getSyncState,
  subscribeSync,
  type SyncState,
} from "@/lib/store/github-sync";

/**
 * The app header, plus the one place that boots the database and sync loop.
 *
 * This replaces Clerk's sign-in buttons and `<UserButton>`; with no accounts,
 * the only persistent chrome that matters is whether your data has made it to
 * GitHub.
 */
export function AppChrome() {
  useStoreBootstrap();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registered from here rather than at module scope so it only runs in the
    // browser and only once the app has actually mounted.
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    void navigator.serviceWorker.register(`${base}/sw.js`).catch(() => {
      /* offline support is best-effort */
    });
  }, []);

  return (
    <>
      <TabNotice />
      <TodoReminders />
      <header className="flex items-center justify-end gap-2 p-4">
        <SyncIndicator />
        {/* Beside the calendar because it lands on the same page — the list of
            things to do sits above the grid there. What it adds over the
            calendar's own icon is the cursor: `?todo=new` opens with today's
            add field focused, so jotting something down is one press from
            anywhere in the app rather than a page and a click. */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href="/calendar?todo=new"
                aria-label="Add a todo for today"
                className={buttonVariants({ variant: "ghost", size: "icon-lg" })}
              >
                <ListTodo className="size-5" />
              </Link>
            }
          />
          <TooltipContent>Add a todo for today</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href="/notes"
                aria-label="Notes"
                className={buttonVariants({ variant: "ghost", size: "icon-lg" })}
              >
                <NotebookPen className="size-5" />
              </Link>
            }
          />
          <TooltipContent>Notes</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href="/calendar"
                aria-label="Review calendar"
                className={buttonVariants({ variant: "ghost", size: "icon-lg" })}
              >
                <CalendarDays className="size-5" />
              </Link>
            }
          />
          <TooltipContent>Review calendar</TooltipContent>
        </Tooltip>
        <ThemeToggle />
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href="/settings"
                aria-label="Settings"
                className={buttonVariants({ variant: "ghost", size: "icon-lg" })}
              >
                <SettingsIcon className="size-5" />
              </Link>
            }
          />
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
        {/* Last, in the corner. It is the only control here that answers a
            different question from the rest — not "where does this go" but
            "who is this" — and it is deliberately the largest thing in the
            row. */}
        <ProfileMenu />
      </header>
    </>
  );
}

/**
 * Shown when the store stepped aside for a newer document from another tab.
 *
 * Worth interrupting for: the decks on screen have just changed underneath the
 * user, and an edit they made did not survive. Silence would look like the app
 * had lost their work at random.
 */
function TabNotice() {
  const notice = useStoreNotice();
  if (!notice) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100"
    >
      <span className="flex-1">{notice}</span>
      <button
        type="button"
        onClick={dismissNotice}
        className="shrink-0 rounded px-2 py-0.5 font-medium underline-offset-2 hover:underline"
      >
        Dismiss
      </button>
    </div>
  );
}

function ThemeToggle() {
  // The theme is stamped onto <html> by an inline script before React runs, so
  // it is external state. Reading it through useSyncExternalStore lets React
  // reconcile the prerendered guess with the real value on hydration.
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Switch to ${next} mode`}
            onClick={() => setTheme(next)}
            className={buttonVariants({ variant: "ghost", size: "icon-lg" })}
          >
            {theme === "dark" ? (
              <Sun className="size-5" />
            ) : (
              <Moon className="size-5" />
            )}
          </button>
        }
      />
      <TooltipContent>Switch to {next} mode</TooltipContent>
    </Tooltip>
  );
}

/**
 * "just now", "4 minutes ago" — how long since GitHub was last asked.
 *
 * Computed when the tooltip renders, which is when it opens, so there is no
 * ticking clock re-rendering the header for a line nobody is reading.
 */
function ago(at: Date | null): string {
  if (!at) return "not yet checked";
  const seconds = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
  if (seconds < 45) return "checked just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60)
    return `checked ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `checked ${hours} hour${hours === 1 ? "" : "s"} ago`;
}

const LABELS: Record<SyncState | "unsent", string> = {
  disabled: "Sync is off — set up a GitHub repo in Settings",
  // Says what it knows rather than what it hopes: the tick means the last
  // attempt succeeded, and the tooltip adds when that was.
  idle: "In step with GitHub as of the last check",
  unsent: "This device has changes GitHub has not accepted yet",
  pulling: "Checking GitHub for changes…",
  pushing: "Saving to GitHub…",
  conflict: "This file changed on GitHub — resolve in Settings",
  offline: "Offline — changes are saved locally and will sync later",
  error: "Sync failed — see Settings",
};

function SyncIndicator() {
  const state = useSyncExternalStore(
    subscribeSync,
    getSyncState,
    () => "disabled" as SyncState,
  );
  const error = useSyncExternalStore(subscribeSync, getSyncError, () => null);
  const checkedAt = useSyncExternalStore(
    subscribeSync,
    getLastCheckedAt,
    () => null,
  );
  /**
   * Whether anything here has never reached GitHub.
   *
   * Read through the store so it settles the moment a push lands. A tick that
   * means "nothing has failed" is not the same as "your work is saved", and
   * this app has now twice looked synced while holding a day of unsent
   * changes — including a migration of every card in every deck.
   */
  const unsent = useStore(useCallback(() => hasUnpushedChanges(), []));

  if (state === "disabled") {
    return (
      <Link
        href="/settings"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Set up sync
      </Link>
    );
  }

  // Said before the state, because "no error" is the weaker claim of the two.
  const shown: SyncState | "unsent" =
    state === "idle" && unsent ? "unsent" : state;

  const icon =
    state === "pushing" || state === "pulling" ? (
      <RefreshCw className="size-4 animate-spin" />
    ) : state === "offline" ? (
      <CloudOff className="size-4" />
    ) : state === "conflict" || state === "error" ? (
      <AlertTriangle className="size-4 text-amber-500" />
    ) : shown === "unsent" ? (
      <CloudUpload className="size-4 text-amber-500" />
    ) : (
      <Check className="size-4 text-emerald-500" />
    );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href="/settings"
            aria-label={LABELS[shown]}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {icon}
          </Link>
        }
      />
      <TooltipContent>
        {error
          ? `${LABELS[shown]} — ${error}`
          : `${LABELS[shown]} · ${ago(checkedAt)}`}
      </TooltipContent>
    </Tooltip>
  );
}
