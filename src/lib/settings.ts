"use client";

/**
 * Small user-held settings that aren't part of the synced document.
 *
 * The OpenAI key deliberately stays in localStorage and out of `data.json`: it
 * is per-device, and syncing it would commit a live API key to a git repo.
 */

const STUDY_SOUND = "flashycardy.studySound";
const AI_PROVIDER = "flashycardy.aiProvider";

/**
 * Who answers the AI requests — writing cards, and reading text out of a scan.
 *
 * Gemini is spoken to through its OpenAI-compatible endpoint rather than its
 * own API. The two features here are an ordinary chat completion and an image
 * in a message, which that endpoint serves exactly as OpenAI does, so one code
 * path covers both providers instead of two that drift apart.
 *
 * Keys are kept per provider rather than in one slot: switching to try the
 * other one should not throw away the key you already had.
 */
export const AI_PROVIDERS = ["openai", "gemini"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

type ProviderSpec = {
  label: string;
  keyStorage: string;
  modelStorage: string;
  defaultModel: string;
  baseUrl: string;
  /** Where the user gets a key, shown beside the field. */
  keysUrl: string;
  /**
   * Whether the provider honours a strict JSON schema. OpenAI does; the Gemini
   * compatibility layer is uneven about it, so card generation asks that one
   * for JSON and validates the shape itself — which it does either way.
   */
  strictJsonSchema: boolean;
};

export const AI_PROVIDER_SPECS: Record<AIProvider, ProviderSpec> = {
  openai: {
    label: "OpenAI",
    keyStorage: "flashycardy.openaiKey",
    modelStorage: "flashycardy.openaiModel",
    defaultModel: "gpt-5.3-chat-latest",
    baseUrl: "https://api.openai.com/v1",
    keysUrl: "https://platform.openai.com/api-keys",
    strictJsonSchema: true,
  },
  gemini: {
    label: "Google Gemini",
    keyStorage: "flashycardy.geminiKey",
    modelStorage: "flashycardy.geminiModel",
    defaultModel: "gemini-3.5-flash-lite",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keysUrl: "https://aistudio.google.com/apikey",
    strictJsonSchema: false,
  },
};

export function getAIProvider(): AIProvider {
  if (typeof window === "undefined") return "openai";
  const stored = window.localStorage.getItem(AI_PROVIDER);
  return AI_PROVIDERS.includes(stored as AIProvider)
    ? (stored as AIProvider)
    : "openai";
}

export function setAIProvider(provider: AIProvider) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AI_PROVIDER, provider);
}

export function getAIKey(provider: AIProvider = getAIProvider()): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AI_PROVIDER_SPECS[provider].keyStorage);
}

export function setAIKey(provider: AIProvider, key: string | null) {
  if (typeof window === "undefined") return;
  const slot = AI_PROVIDER_SPECS[provider].keyStorage;
  if (key) window.localStorage.setItem(slot, key);
  else window.localStorage.removeItem(slot);
}

export function getAIModel(provider: AIProvider = getAIProvider()): string {
  const spec = AI_PROVIDER_SPECS[provider];
  if (typeof window === "undefined") return spec.defaultModel;
  return window.localStorage.getItem(spec.modelStorage) || spec.defaultModel;
}

export function setAIModel(provider: AIProvider, model: string | null) {
  if (typeof window === "undefined") return;
  const slot = AI_PROVIDER_SPECS[provider].modelStorage;
  if (model) window.localStorage.setItem(slot, model);
  else window.localStorage.removeItem(slot);
}

/** Everything a request needs, or null when no key has been entered. */
export function getAIConfig(): {
  provider: AIProvider;
  label: string;
  key: string;
  model: string;
  baseUrl: string;
  strictJsonSchema: boolean;
} | null {
  const provider = getAIProvider();
  const key = getAIKey(provider);
  if (!key) return null;
  const spec = AI_PROVIDER_SPECS[provider];
  return {
    provider,
    label: spec.label,
    key,
    model: getAIModel(provider),
    baseUrl: spec.baseUrl,
    strictJsonSchema: spec.strictJsonSchema,
  };
}

export function hasAIKey(): boolean {
  return Boolean(getAIKey());
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
