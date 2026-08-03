"use client";

/**
 * Small user-held settings that aren't part of the synced document.
 *
 * The OpenAI key deliberately stays in localStorage and out of `data.json`: it
 * is per-device, and syncing it would commit a live API key to a git repo.
 */

const OPENAI_KEY = "flashycardy.openaiKey";
const OPENAI_MODEL = "flashycardy.openaiModel";
const STUDY_SOUND = "flashycardy.studySound";

export const DEFAULT_OPENAI_MODEL = "gpt-5.3-chat-latest";

export function getOpenAIKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(OPENAI_KEY);
}

export function setOpenAIKey(key: string | null) {
  if (typeof window === "undefined") return;
  if (key) window.localStorage.setItem(OPENAI_KEY, key);
  else window.localStorage.removeItem(OPENAI_KEY);
}

export function getOpenAIModel(): string {
  if (typeof window === "undefined") return DEFAULT_OPENAI_MODEL;
  return window.localStorage.getItem(OPENAI_MODEL) || DEFAULT_OPENAI_MODEL;
}

export function setOpenAIModel(model: string | null) {
  if (typeof window === "undefined") return;
  if (model) window.localStorage.setItem(OPENAI_MODEL, model);
  else window.localStorage.removeItem(OPENAI_MODEL);
}

export function hasOpenAIKey(): boolean {
  return Boolean(getOpenAIKey());
}

/**
 * Whether the study timer is allowed to make a noise.
 *
 * On by default — the amber and red chimes are the point of the pacing, and a
 * warning you have to be watching for isn't much of a warning. Only an explicit
 * "off" silences them, so a browser with no localStorage still gets sound.
 *
 * Subscribable, so the study screen can read it with `useSyncExternalStore`
 * rather than mirroring it into component state after mount.
 */
const soundListeners = new Set<() => void>();

export function isStudySoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STUDY_SOUND) !== "off";
}

/** The value before the browser is available — sound is on by default. */
export function studySoundServerSnapshot(): boolean {
  return true;
}

export function setStudySoundEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STUDY_SOUND, enabled ? "on" : "off");
  for (const listener of soundListeners) listener();
}

export function subscribeStudySound(listener: () => void): () => void {
  soundListeners.add(listener);
  return () => soundListeners.delete(listener);
}
