/**
 * The name and face a collection carries in its own document.
 *
 * Lives here rather than in `lib/store/profiles.ts` because that module must
 * not import the store it is scoping — the store imports it, and a cycle
 * between the two would be worse than the split. `profiles.ts` owns the
 * device-local registry; this owns the one part of a profile that travels.
 */

import { getSnapshot, mutate } from "@/lib/store/local-store";
import type { DbDoc, DocProfile } from "@/lib/store/types";

export function selectProfileIdentity(db: DbDoc): DocProfile | null {
  return db.profile ?? null;
}

export async function getProfileIdentity() {
  return selectProfileIdentity(getSnapshot());
}

/**
 * Record what this collection is called, in the document that syncs.
 *
 * A no-op when nothing changed. Every write restamps the document and schedules
 * a push, so renaming a profile to what it is already called should not put a
 * commit in the repo and tell every other device there is something new to
 * pull.
 */
export async function saveProfileIdentity(name: string, emoji: string | null) {
  return mutate((draft) => {
    const existing = draft.profile;
    if (existing && existing.name === name && existing.emoji === emoji) {
      return existing;
    }
    const identity: DocProfile = { name, emoji, updatedAt: new Date() };
    draft.profile = identity;
    return identity;
  });
}
