"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CloudOff,
  Moon,
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
import { useStoreBootstrap, useStoreNotice } from "@/lib/store/use-store";
import { dismissNotice } from "@/lib/store/local-store";
import {
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
      <header className="flex items-center justify-end gap-2 p-4">
        <SyncIndicator />
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href="/calendar"
                aria-label="Review calendar"
                className={buttonVariants({ variant: "ghost", size: "icon" })}
              >
                <CalendarDays className="size-4" />
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
                className={buttonVariants({ variant: "ghost", size: "icon" })}
              >
                <SettingsIcon className="size-4" />
              </Link>
            }
          />
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
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
  const theme = useSyncExternalStore(
    subscribeTheme,
    getTheme,
    getServerTheme,
  );
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Switch to ${next} mode`}
            onClick={() => setTheme(next)}
            className={buttonVariants({ variant: "ghost", size: "icon" })}
          >
            {theme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </button>
        }
      />
      <TooltipContent>Switch to {next} mode</TooltipContent>
    </Tooltip>
  );
}

const LABELS: Record<SyncState, string> = {
  disabled: "Sync is off — set up a GitHub repo in Settings",
  idle: "Everything is synced to GitHub",
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

  const icon =
    state === "pushing" || state === "pulling" ? (
      <RefreshCw className="size-3.5 animate-spin" />
    ) : state === "offline" ? (
      <CloudOff className="size-3.5" />
    ) : state === "conflict" || state === "error" ? (
      <AlertTriangle className="size-3.5 text-amber-500" />
    ) : (
      <Check className="size-3.5 text-emerald-500" />
    );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href="/settings"
            aria-label={LABELS[state]}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {icon}
          </Link>
        }
      />
      <TooltipContent>{error ? `${LABELS[state]} — ${error}` : LABELS[state]}</TooltipContent>
    </Tooltip>
  );
}
