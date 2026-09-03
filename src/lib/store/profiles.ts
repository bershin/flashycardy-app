/**
 * Separate sets of decks in one browser, for people who share a machine.
 *
 * Everything this app keeps is scoped to the origin: one IndexedDB document,
 * one sync configuration, one set of half-finished study sessions. Two people
 * on the same browser profile were therefore one person as far as the app was
 * concerned — and pointing Settings at a second GitHub repo did not divide them,
 * because a pull *merges* rather than replaces (`github-sync.ts`), so the two
 * collections would have run together in both repos.
 *
 * A profile is a name and an id, and the id is a suffix on every key that holds
 * something personal. Which keys those are is decided by each module, not here;
 * this file only says what the active profile is and how to spell a key for it.
 *
 * The default profile deliberately uses the unsuffixed keys — the exact keys the
 * app used before profiles existed. So the decks, sync setup and history already
 * on a device stay where they are and keep working, with nothing to migrate and
 * nothing that can be lost in migrating. Only profiles added later carry a
 * suffix.
 *
 * Import-safe on the server: `next build` prerenders in Node, where there is no
 * `window`, and every function here answers as the default profile there.
 */

export type Profile = {
  id: string;
  name: string;
};

/** The list of profiles, and which one is in use. Both device-level. */
const LIST_KEY = "flashycardy.profiles";
const ACTIVE_KEY = "flashycardy.profile";

/**
 * The profile whose keys carry no suffix.
 *
 * Its id is stored in the list like any other, but never appended to a key —
 * that is what keeps a device that has never seen this feature working exactly
 * as it did.
 */
export const DEFAULT_PROFILE_ID = "default";

const DEFAULT_PROFILE: Profile = { id: DEFAULT_PROFILE_ID, name: "Main" };

/**
 * The active id, read once.
 *
 * Cached because switching reloads the page: within one page load the answer
 * cannot change, and a key that answered differently halfway through would
 * write half a profile's state into another's.
 */
let activeId: string | null = null;

/**
 * The list, cached, plus who to tell when it changes.
 *
 * `useSyncExternalStore` compares snapshots by reference, so parsing the JSON
 * afresh on every read would hand it a new array each time and re-render for
 * ever. The cache is dropped on every write, which is the only way the list
 * changes — nothing else on the device touches these keys.
 */
let cachedList: Profile[] | null = null;
const listeners = new Set<() => void>();

export function subscribeProfiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Prerender sees one profile; the real list arrives after hydration. */
const SERVER_PROFILES: Profile[] = [DEFAULT_PROFILE];

export function getProfilesServerSnapshot(): Profile[] {
  return SERVER_PROFILES;
}

function readList(): Profile[] {
  if (typeof window === "undefined") return [DEFAULT_PROFILE];
  const raw = window.localStorage.getItem(LIST_KEY);
  if (!raw) return [DEFAULT_PROFILE];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [DEFAULT_PROFILE];
    const profiles = parsed
      .filter(
        (p): p is Profile =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as Profile).id === "string" &&
          typeof (p as Profile).name === "string",
      )
      .map((p) => ({ id: p.id, name: p.name }));
    // The default is always present: it owns the unsuffixed keys, so a list
    // that had lost it would strand the data those keys hold.
    return profiles.some((p) => p.id === DEFAULT_PROFILE_ID)
      ? profiles
      : [DEFAULT_PROFILE, ...profiles];
  } catch {
    return [DEFAULT_PROFILE];
  }
}

function writeList(profiles: Profile[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LIST_KEY, JSON.stringify(profiles));
  cachedList = profiles;
  for (const listener of listeners) listener();
}

export function listProfiles(): Profile[] {
  if (typeof window === "undefined") return SERVER_PROFILES;
  if (cachedList === null) cachedList = readList();
  return cachedList;
}

export function getActiveProfileId(): string {
  if (typeof window === "undefined") return DEFAULT_PROFILE_ID;
  if (activeId !== null) return activeId;
  const stored = window.localStorage.getItem(ACTIVE_KEY);
  // An id naming a profile that has since been deleted falls back rather than
  // opening an empty set of decks under a name nothing knows.
  activeId =
    stored && listProfiles().some((p) => p.id === stored)
      ? stored
      : DEFAULT_PROFILE_ID;
  return activeId;
}

export function getActiveProfile(): Profile {
  const id = getActiveProfileId();
  return listProfiles().find((p) => p.id === id) ?? DEFAULT_PROFILE;
}

/**
 * The name a key takes for the profile in use.
 *
 * `#` separates because no key here contains one, so a scoped key can never
 * collide with an unscoped one belonging to something else.
 */
export function scopedKey(key: string): string {
  const id = getActiveProfileId();
  return id === DEFAULT_PROFILE_ID ? key : `${key}#${id}`;
}

/** The same, for a profile other than the active one — used when deleting. */
export function scopedKeyFor(key: string, profileId: string): string {
  return profileId === DEFAULT_PROFILE_ID ? key : `${key}#${profileId}`;
}

/**
 * Every localStorage key that belongs to one profile rather than the device.
 *
 * Listed here so deleting a profile can clear all of them. The modules that own
 * these keys scope them through `scopedKey`; this is the same set written down
 * once more, because there is no way to ask localStorage which keys a module
 * would have used. `flashycardy.theme` and `flashycardy.storageAsked` are
 * deliberately absent — they describe the browser, not the person.
 */
const PROFILE_KEYS = [
  "flashycardy.deviceId",
  "flashycardy.sync",
  "flashycardy.sync.base",
  "flashycardy.sync.sha",
  "flashycardy.sync.pushedAt",
  "flashycardy.sync.lastSyncedAt",
  "flashycardy.sessions",
  "flashycardy.studyPicks",
  "flashycardy.pendingBlobs",
] as const;

export function addProfile(name: string): Profile {
  const profile: Profile = {
    id: crypto.randomUUID().slice(0, 8),
    name: name.trim() || "Untitled",
  };
  writeList([...listProfiles(), profile]);
  return profile;
}

export function renameProfile(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  writeList(listProfiles().map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
}

/**
 * Forget a profile and everything it held on this device.
 *
 * The document itself lives in IndexedDB and is removed by
 * `deleteDocumentFor` in `local-store.ts` — kept there so this module never
 * imports the store it is scoping, which would be a cycle.
 *
 * The default profile cannot be removed: its keys are the unsuffixed ones, so
 * "deleting" it would mean clearing the app rather than one person's copy.
 */
export function deleteProfile(id: string): void {
  if (typeof window === "undefined" || id === DEFAULT_PROFILE_ID) return;
  for (const key of PROFILE_KEYS) {
    window.localStorage.removeItem(scopedKeyFor(key, id));
  }
  writeList(listProfiles().filter((p) => p.id !== id));
  if (window.localStorage.getItem(ACTIVE_KEY) === id) {
    window.localStorage.setItem(ACTIVE_KEY, DEFAULT_PROFILE_ID);
  }
}

/**
 * Change profile and start again from scratch.
 *
 * A reload rather than a re-render on purpose. The document, the sync loop, the
 * tab channel and every piece of React state above them were built around the
 * old profile's keys; tearing all of that down correctly in place is a great
 * deal of machinery to get right, and getting it wrong mixes two people's cards.
 * A reload is the same thing, already written, and impossible to half-do.
 */
export function switchProfile(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_KEY, id);
  window.location.reload();
}
