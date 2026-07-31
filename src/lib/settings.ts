"use client";

/**
 * Small user-held settings that aren't part of the synced document.
 *
 * The OpenAI key deliberately stays in localStorage and out of `data.json`: it
 * is per-device, and syncing it would commit a live API key to a git repo.
 */

const OPENAI_KEY = "flashycardy.openaiKey";
const OPENAI_MODEL = "flashycardy.openaiModel";

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
