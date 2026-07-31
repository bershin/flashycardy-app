"use client";

export type Theme = "light" | "dark";

const KEY = "flashycardy.theme";

/**
 * Runs before first paint, inlined into <head>.
 *
 * Without this the page renders in the default theme and then snaps to the
 * stored one on hydration — a visible flash on every navigation. Kept as a
 * string because it has to execute before React exists.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${KEY}');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    var root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  } catch (e) {}
})();
`;

/**
 * The theme is external state — it lives on `<html>`, written by the inline
 * script before React exists. Exposing it as a subscribable store lets
 * components read it with `useSyncExternalStore`, which handles the
 * server/client difference properly instead of flashing through an effect.
 */
const listeners = new Set<() => void>();

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Prerender has no DOM to read; the real value arrives on hydration. */
export function getServerTheme(): Theme {
  return "dark";
}

export function setTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // A refused write just means the choice won't survive a reload.
  }
  for (const listener of listeners) listener();
}
