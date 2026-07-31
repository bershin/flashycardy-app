"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  getServerSnapshot,
  getSnapshot,
  getStatus,
  init,
  subscribe,
} from "./local-store";
import type { DbDoc } from "./types";
import { startSync } from "./github-sync";

/**
 * Boot the local store and the GitHub sync loop. Mounted once, from the root
 * layout. Kept separate from `useStore` so that the many components reading the
 * database don't each try to initialise it.
 */
export function useStoreBootstrap() {
  useEffect(() => {
    let disposeSync: (() => void) | undefined;
    void init().then(() => {
      disposeSync = startSync();
    });
    return () => disposeSync?.();
  }, []);
}

/**
 * Read derived data out of the store, re-rendering when it changes.
 *
 * `selector` must be stable — wrap it in `useCallback` at the call site, or
 * define it at module scope — because it runs on every store notification.
 *
 * The result is recomputed on each call rather than memoised. That is fine at
 * this data scale (a personal flashcard collection) and avoids the stale-cache
 * bugs that a naive equality check would introduce for the array-returning
 * selectors.
 */
export function useStore<T>(selector: (db: DbDoc) => T): T {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return selector(snapshot);
}

/** Whether the initial IndexedDB load has finished. */
export function useStoreReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => getStatus() === "ready", []),
    useCallback(() => false, []),
  );
}
