/**
 * Ask the browser to keep this site's storage rather than treat it as cache.
 *
 * By default a site's IndexedDB and localStorage are "best-effort": the browser
 * may clear them under disk pressure, and Safari clears them after roughly a
 * week without a visit. That would take the working copy of the decks *and* the
 * GitHub token stored beside it — so the cards would still be safe in the repo,
 * but the app would have lost the means to fetch them back.
 *
 * `persist()` is a request, not an instruction. Chrome and Safari decide from
 * engagement signals, an installed app being the strongest. A refusal leaves
 * things exactly as they were, so asking can only help.
 */

const ASKED_KEY = "flashycardy.storageAsked";

export type StorageStatus = "unsupported" | "persistent" | "evictable";

function supported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.persist === "function" &&
    typeof navigator.storage?.persisted === "function"
  );
}

export async function readStorageStatus(): Promise<StorageStatus> {
  if (!supported()) return "unsupported";
  try {
    return (await navigator.storage.persisted()) ? "persistent" : "evictable";
  } catch {
    return "unsupported";
  }
}

/** Bytes in use, when the browser will say. */
export async function readStorageUsage(): Promise<number | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return null;
  }
  try {
    return (await navigator.storage.estimate()).usage ?? null;
  } catch {
    return null;
  }
}

/** Ask now. Safe to call repeatedly — a granted origin short-circuits. */
export async function requestPersistentStorage(): Promise<StorageStatus> {
  if (!supported()) return "unsupported";
  try {
    if (await navigator.storage.persisted()) return "persistent";
    const granted = await navigator.storage.persist();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ASKED_KEY, "1");
    }
    return granted ? "persistent" : "evictable";
  } catch {
    return "unsupported";
  }
}

/**
 * Ask once per browser, on the first load that gets this far.
 *
 * Chrome and Safari answer silently, but Firefox raises a permission prompt, so
 * this remembers that it asked rather than putting the same prompt up on every
 * visit. Settings keeps a button for asking again — worth doing after adding the
 * app to a home screen, which often turns a refusal into a grant.
 */
export async function requestPersistenceOnce(): Promise<void> {
  if (!supported() || typeof window === "undefined") return;
  try {
    if (await navigator.storage.persisted()) return;
    if (window.localStorage.getItem(ASKED_KEY)) return;
    await requestPersistentStorage();
  } catch {
    /* best effort: never let this break start-up */
  }
}
