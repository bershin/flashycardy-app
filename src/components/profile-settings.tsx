"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Check, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  addProfile,
  DEFAULT_PROFILE_ID,
  PROFILE_EMOJI,
  setProfileEmoji,
  deleteProfile,
  getActiveProfileId,
  getProfilesServerSnapshot,
  listProfiles,
  renameProfile,
  subscribeProfiles,
  switchProfile,
  type Profile,
} from "@/lib/store/profiles";
import { ProfileAvatar } from "@/components/profile-avatar";
import { deleteDocumentFor } from "@/lib/store/local-store";
import { getSyncTargetFor } from "@/lib/store/github-sync";
import { saveProfileIdentity } from "@/db/queries/profile";

/**
 * Whether the browser has taken over from the prerendered HTML.
 *
 * The subscription never fires — nothing changes after hydration — so this is
 * only a way to render one thing on the server and another once the real
 * browser APIs are readable, without a state update in an effect. Declared out
 * here because a fresh arrow each render would re-subscribe on every commit.
 */
const noopSubscribe = () => () => {};
const getTrue = () => true;
const getFalse = () => false;

/**
 * Separate sets of decks for people who share this browser.
 *
 * The whole feature is device-local: a profile is a name and a suffix on the
 * keys holding one person's decks, sync setup and unfinished sessions. Nothing
 * about it is synced, because it describes this browser rather than the
 * collection — the same GitHub repo opened on a phone is simply that person's
 * decks there.
 */
export function ProfileSettings() {
  // The list lives in localStorage, which the prerender in Node cannot see;
  // the server snapshot is the lone default profile, so the first paint agrees
  // with the prerendered HTML and the real list arrives on hydration.
  const profiles = useSyncExternalStore(
    subscribeProfiles,
    listProfiles,
    getProfilesServerSnapshot,
  );
  const activeId = getActiveProfileId();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [doomed, setDoomed] = useState<Profile | null>(null);

  /**
   * Where each profile syncs, for spotting two of them on one file.
   *
   * Derived from the list rather than kept in state, so it follows a profile
   * being added or removed on its own. It will not notice the sync repo being
   * changed further down this page until the next load, which is the moment the
   * warning would matter anyway — a switch reloads.
   *
   * Held back until after hydration. `getSyncTargetFor` reads localStorage, so
   * on the server it answers null for everything while in the browser it knows
   * the real repo — and the hydration render runs in the browser, so rendering
   * it straight away made the server's "no sync repo set" disagree with the
   * client's text and threw the tree away to re-render it.
   */
  const hydrated = useSyncExternalStore(noopSubscribe, getTrue, getFalse);
  const targets = useMemo(
    () =>
      hydrated
        ? Object.fromEntries(
            profiles.map((p) => [p.id, getSyncTargetFor(p.id)]),
          )
        : {},
    [profiles, hydrated],
  );

  function handleAdd() {
    if (!draft.trim()) return;
    addProfile(draft);
    setDraft("");
  }

  function commitRename(id: string) {
    const name = editText.trim();
    renameProfile(id, name);
    setEditingId(null);
    // Also into the document, so the collection carries its own name to any
    // other device syncing the same repo. Only for the profile in use: the
    // others' documents are not open, and writing to one would mean loading it.
    if (name && id === activeId) {
      const emoji = profiles.find((p) => p.id === id)?.emoji ?? null;
      void saveProfileIdentity(name, emoji);
    }
  }

  function chooseEmoji(profile: Profile, emoji: string | null) {
    setProfileEmoji(profile.id, emoji);
    if (profile.id === activeId) {
      void saveProfileIdentity(profile.name, emoji);
    }
  }

  async function handleDelete(profile: Profile) {
    setDoomed(null);
    // The document first: if clearing the registry succeeded and this failed,
    // the decks would be left in IndexedDB under a key nothing names any more.
    await deleteDocumentFor(profile.id);
    deleteProfile(profile.id);
  }

  /**
   * Targets claimed by more than one profile, and who claims them.
   *
   * Grouped rather than counted so the warning can name the profiles and the
   * file, which is the difference between "something is wrong somewhere" and
   * knowing which two rows to go and change.
   */
  const clashes = Object.entries(
    profiles.reduce<Record<string, string[]>>((acc, profile) => {
      const target = targets[profile.id];
      if (target) (acc[target] ??= []).push(profile.name);
      return acc;
    }, {}),
  ).filter(([, names]) => names.length > 1);

  /** Ids sitting on a shared file, so their rows can say so too. */
  const clashing = new Set(
    profiles
      .filter((p) => {
        const target = targets[p.id];
        return target ? clashes.some(([t]) => t === target) : false;
      })
      .map((p) => p.id),
  );

  return (
    <section className="mt-8 scroll-mt-8" id="profiles">
      <h2 className="text-lg font-semibold">Profiles</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Separate sets of decks in this browser, for a machine more than one
        person studies on. Each profile has its own decks, its own GitHub sync
        settings and its own unfinished sessions, and switching reloads the page.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        The list itself lives on this device — a profile is mostly a pointer to
        a GitHub repo and its token, and a token has no business in a synced
        file. The name and face do travel: add the profile on another device,
        point it at the same repo, and it will call itself the same thing.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        If you each have your own computer or browser profile you do not need
        this at all, since the browser is already keeping you apart.
      </p>

      <div className="mt-4 grid gap-2">
        {profiles.map((profile) => {
          const target = targets[profile.id];
          return (
            <div
              key={profile.id}
              className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2"
            >
              {editingId === profile.id ? (
                <div className="grid flex-1 gap-2">
                 <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(profile.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-8"
                  />
                  <Button size="sm" onClick={() => commitRename(profile.id)}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                 </div>
                 {/* Chosen from a fixed row rather than the system emoji
                     picker, which is a different control on every platform and
                     missing on some. Clearing goes back to the initial. */}
                 <div className="flex flex-wrap items-center gap-1">
                  {PROFILE_EMOJI.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`Use ${emoji} for ${profile.name}`}
                      aria-pressed={profile.emoji === emoji}
                      onClick={() => chooseEmoji(profile, emoji)}
                      className={`rounded-md px-1.5 py-0.5 text-base hover:bg-muted ${
                        profile.emoji === emoji ? "bg-muted ring-1 ring-ring" : ""
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label={`Use the initial for ${profile.name}`}
                    aria-pressed={!profile.emoji}
                    onClick={() => chooseEmoji(profile, null)}
                    className={`rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted ${
                      !profile.emoji ? "bg-muted ring-1 ring-ring" : ""
                    }`}
                  >
                    Initial
                  </button>
                 </div>
                </div>
              ) : (
                <>
                  <span className="flex flex-1 items-center gap-2 text-sm">
                    <Check
                      className={`size-3.5 text-emerald-500 ${
                        profile.id === activeId ? "" : "invisible"
                      }`}
                    />
                    <ProfileAvatar profile={profile} size="md" />
                    <span className="font-medium">{profile.name}</span>
                    <span
                      className={`text-xs ${
                        clashing.has(profile.id)
                          ? "font-medium text-amber-700 dark:text-amber-300"
                          : "text-muted-foreground"
                      }`}
                    >
                      {target ?? "no sync repo set"}
                    </span>
                    {clashing.has(profile.id) && (
                      <AlertTriangle
                        aria-label="Shares a file with another profile"
                        className="size-3.5 shrink-0 text-amber-500"
                      />
                    )}
                  </span>
                  {profile.id !== activeId && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => switchProfile(profile.id)}
                    >
                      Switch to
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Rename ${profile.name}`}
                    onClick={() => {
                      setEditingId(profile.id);
                      setEditText(profile.name);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${profile.name}`}
                    // The default profile owns the unsuffixed keys, so removing
                    // it would mean clearing the app rather than one person's
                    // copy. The active one is spared because the page is
                    // currently running on it.
                    disabled={
                      profile.id === DEFAULT_PROFILE_ID ||
                      profile.id === activeId
                    }
                    onClick={() => setDoomed(profile)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {clashes.length > 0 && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            {clashes.map(([target, names]) => {
              // `owner/repo/path@branch` — the file is what has to change, so
              // it is worth pulling out and showing on its own.
              const path = target.split("@")[0].split("/").slice(2).join("/");
              const repo = target.split("/").slice(0, 2).join("/");
              return (
                <p key={target} className="font-medium">
                  {names.join(" and ")} are both syncing to{" "}
                  <code className="rounded bg-amber-500/20 px-1">{path}</code> in{" "}
                  <code className="rounded bg-amber-500/20 px-1">{repo}</code>.
                </p>
              );
            })}
            <p className="mt-1.5">
              They will run into each other. Syncing <em>merges</em>{" "}
              rather than replaces, so each will pull in the other&rsquo;s
              decks, cards,
              notes and todos and keep them — in both directions, and in both
              copies of the file. That is the one way separate profiles can
              still end up as one pile.
            </p>
            <p className="mt-1.5">
              Fix it under <strong>GitHub sync</strong>{" "}
              above: switch to the profile that should move, and give it a{" "}
              <strong>File path</strong>{" "}
              of its own &mdash; the same repository is fine, and one token
              covers both. So{" "}
              <code className="rounded bg-amber-500/20 px-1">data.json</code>{" "}
              for one and{" "}
              <code className="rounded bg-amber-500/20 px-1">
                {profiles.find((p) => clashing.has(p.id) && p.id !== activeId)
                  ?.name.toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-") || "second"}
                .json
              </code>{" "}
              for the other.
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-end gap-2">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="new-profile">Add a profile</Label>
          <Input
            id="new-profile"
            value={draft}
            placeholder="Their name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
        </div>
        <Button onClick={handleAdd} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        A new profile starts empty. Switch to it, then point it at its own
        private GitHub repo under <strong>GitHub sync</strong> above.
      </p>

      <AlertDialog
        open={doomed !== null}
        onOpenChange={(open) => !open && setDoomed(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {doomed?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their decks, cards and sync settings go from this browser. If this
              profile was syncing to a GitHub repo, that repo is untouched and
              still holds everything — adding the profile again and pointing it
              back at that repo brings it all back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => doomed && void handleDelete(doomed)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/**
 * Said where the mistake is actually made, rather than only diagnosed
 * afterwards in the Profiles section below.
 *
 * Only once a second profile exists: on a device with one, "give each profile
 * its own file" is advice about a situation that does not exist, and the field
 * is already the hardest one on this form to be confident about.
 */
export function SyncPathHint() {
  const profiles = useSyncExternalStore(
    subscribeProfiles,
    listProfiles,
    getProfilesServerSnapshot,
  );
  if (profiles.length < 2) return null;

  return (
    <p className="text-xs text-muted-foreground">
      One file per profile. Sharing a repository is fine — give each profile its
      own path, such as <code>data.json</code> and <code>arjun.json</code> — but
      two profiles on the <em>same</em> file will merge into each other.
    </p>
  );
}
