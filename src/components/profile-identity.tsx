"use client";

import { useCallback, useEffect } from "react";
import { useStore } from "@/lib/store/use-store";
import { selectProfileIdentity } from "@/db/queries/profile";
import type { DbDoc } from "@/lib/store/types";
import {
  getActiveProfileId,
  listProfiles,
  renameProfile,
  setProfileEmoji,
} from "@/lib/store/profiles";

/**
 * Takes the collection's name and face from its document into this device's
 * registry.
 *
 * The point of the whole exercise: add a profile on a second device, point it
 * at the same repo, and once it syncs it calls itself the right thing instead
 * of leaving you to retype the name and hunt for the emoji.
 *
 * The document wins, and that is safe rather than pushy — renaming a profile
 * here writes the document in the same breath, so the two can only disagree
 * when some *other* device did the renaming, which is exactly the case worth
 * adopting.
 *
 * Renders nothing. Mounted once, from the app chrome, so the header and the
 * settings page both see the corrected name without either owning the job.
 */
export function ProfileIdentity() {
  const identity = useStore(
    useCallback((db: DbDoc) => selectProfileIdentity(db), []),
  );

  const name = identity?.name ?? null;
  const emoji = identity?.emoji ?? null;

  useEffect(() => {
    if (name === null) return;
    const id = getActiveProfileId();
    const current = listProfiles().find((p) => p.id === id);
    if (!current) return;
    // Compared before writing, both because a write notifies every listener —
    // which would land straight back here — and because the registry is
    // localStorage, where a needless write is a needless serialisation.
    if (current.name !== name) renameProfile(id, name);
    if ((current.emoji ?? null) !== emoji) setProfileEmoji(id, emoji);
  }, [name, emoji]);

  return null;
}
