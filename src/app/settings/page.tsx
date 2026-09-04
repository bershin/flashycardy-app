"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { Download, ShieldAlert, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectLearnedButUnarchived } from "@/db/queries/cards";
import { inlineImageLoad, migrateInlineImages } from "@/lib/migrate-images";
import type { MigrationProgress } from "@/lib/migrate-images";
import { archiveLearnedCardsAction } from "@/app/deck/actions";
import type { DbDoc } from "@/lib/store/types";
import {
  readStorageStatus,
  readStorageUsage,
  requestPersistentStorage,
  type StorageStatus,
} from "@/lib/storage-persistence";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ProfileSettings, SyncPathHint } from "@/components/profile-settings";
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
  getServerSnapshot,
  getSnapshot,
  replaceDoc,
  resetDoc,
  subscribe,
} from "@/lib/store/local-store";
import {
  deserializeDoc,
  serializeDoc,
  type SerializedDbDoc,
} from "@/lib/store/types";
import {
  flushPush,
  getLastSyncedAt,
  getSyncConfig,
  getSyncError,
  getSyncState,
  syncNow,
  resolveWithLocal,
  resolveWithRemote,
  setSyncConfig,
  subscribeSync,
  testConnection,
  type SyncConfig,
  type SyncState,
} from "@/lib/store/github-sync";
import {
  AI_PROVIDERS,
  AI_PROVIDER_SPECS,
  getAIKey,
  getAIModel,
  getAIProvider,
  setAIKey,
  setAIModel,
  setAIProvider,
  type AIProvider,
} from "@/lib/settings";

const EMPTY_CONFIG: SyncConfig = {
  owner: "",
  repo: "",
  path: "data.json",
  branch: "main",
  token: "",
};

export default function SettingsPage() {
  const doc = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const syncState = useSyncExternalStore(
    subscribeSync,
    getSyncState,
    () => "disabled" as SyncState,
  );
  const syncError = useSyncExternalStore(
    subscribeSync,
    getSyncError,
    () => null,
  );

  const [config, setConfig] = useState<SyncConfig>(EMPTY_CONFIG);
  const [provider, setProvider] = useState<AIProvider>("openai");
  const [apiKey, setKey] = useState("");
  const [model, setModel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Read from the store rather than counted once, so it falls to zero the
   * moment the sweep runs and cannot sit there quoting a number that is no
   * longer true.
   */
  const [moving, setMoving] = useState<MigrationProgress | null>(null);
  /** What is still inline, read from the store so it falls to zero as it goes. */
  const inlineImages = useStore(
    useCallback((db: DbDoc) => inlineImageLoad(db.cards), []),
  );
  const learned = useStore(
    useCallback(
      (db: DbDoc) => selectLearnedButUnarchived(db, LOCAL_USER_ID).length,
      [],
    ),
  );
  const [resetOpen, setResetOpen] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [storage, setStorage] = useState<StorageStatus>("unsupported");
  const [usageMb, setUsageMb] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // localStorage is browser-only, so everything is read after mount.
  useEffect(() => {
    setConfig(getSyncConfig() ?? EMPTY_CONFIG);
    const active = getAIProvider();
    setProvider(active);
    setKey(getAIKey(active) ?? "");
    setModel(getAIModel(active));
    setLastSynced(getLastSyncedAt());
    void readStorageStatus().then(setStorage);
    void readStorageUsage().then((bytes) =>
      setUsageMb(bytes === null ? null : bytes / 1024 / 1024),
    );
  }, []);

  const serialized = JSON.stringify(serializeDoc(doc));
  const sizeMb = new Blob([serialized]).size / 1024 / 1024;
  const configured = Boolean(config.owner && config.repo && config.token);

  async function handleSaveSync() {
    setBusy(true);
    setMessage(null);
    const result = await testConnection(config);
    if (!result.ok) {
      setMessage(result.error);
      setBusy(false);
      return;
    }
    setSyncConfig(config);
    setMessage(
      result.exists
        ? `Connected. Found ${config.path} (${(result.size / 1024 / 1024).toFixed(2)} MB) — pulling it in now.`
        : `Connected. ${config.path} doesn't exist yet — it will be created on the first save.`,
    );
    setBusy(false);
  }

  async function handleSyncNow() {
    const active = getSyncConfig();
    if (!active) {
      setMessage("Save your GitHub settings first.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      flushPush();
      const result = await syncNow(active);
      setMessage(
        result === "conflict"
          ? "The file changed on GitHub. Choose which version to keep below."
          : "Saved to GitHub.",
      );
      setLastSynced(getLastSyncedAt());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    setBusy(false);
  }

  function handleDownload() {
    const blob = new Blob([JSON.stringify(serializeDoc(doc), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cue-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleRestore(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(await file.text()) as SerializedDbDoc;
      if (!Array.isArray(parsed.decks) || !Array.isArray(parsed.cards)) {
        throw new Error("That file doesn't look like a Cue backup.");
      }
      await replaceDoc(deserializeDoc(parsed));
      setMessage(
        `Restored ${parsed.decks.length} decks and ${parsed.cards.length} cards.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <Link
        href="/dashboard"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Back to decks
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Settings</h1>

      <ProfileSettings />

      <section className="mt-8">
        <h2 className="text-lg font-semibold">GitHub sync</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your decks live in this browser. Point this at a{" "}
          <strong>private</strong> repository and every change is committed
          there, so your data survives clearing the browser and follows you to
          other devices.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Create a{" "}
          <a
            className="underline underline-offset-4"
            href="https://github.com/settings/personal-access-tokens"
            target="_blank"
            rel="noreferrer"
          >
            fine-grained token
          </a>{" "}
          scoped to only that repository, with <em>Contents: read and write</em>
          .
        </p>

        <Card className="mt-4">
          <CardContent className="grid gap-4 pt-6">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="owner">Owner</Label>
                <Input
                  id="owner"
                  value={config.owner}
                  placeholder="your-username"
                  onChange={(e) =>
                    setConfig({ ...config, owner: e.target.value.trim() })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="repo">Repository</Label>
                <Input
                  id="repo"
                  value={config.repo}
                  placeholder="cue-data"
                  onChange={(e) =>
                    setConfig({ ...config, repo: e.target.value.trim() })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="path">File path</Label>
                <Input
                  id="path"
                  value={config.path}
                  onChange={(e) =>
                    setConfig({ ...config, path: e.target.value.trim() })
                  }
                />
                <SyncPathHint />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="branch">Branch</Label>
                <Input
                  id="branch"
                  value={config.branch}
                  onChange={(e) =>
                    setConfig({ ...config, branch: e.target.value.trim() })
                  }
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="token">Access token</Label>
              <Input
                id="token"
                type="password"
                value={config.token}
                placeholder="github_pat_…"
                onChange={(e) =>
                  setConfig({ ...config, token: e.target.value.trim() })
                }
              />
              <p className="text-xs text-muted-foreground">
                Stored only in this browser. It is never included in backups or
                committed to the repo.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleSaveSync} disabled={busy || !configured}>
                Save &amp; test connection
              </Button>
              <Button
                variant="secondary"
                onClick={handleSyncNow}
                disabled={busy || !configured}
              >
                Sync now
              </Button>
              {configured && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSyncConfig(null);
                    setConfig(EMPTY_CONFIG);
                    setMessage(
                      "Sync turned off. Your data stays in this browser.",
                    );
                  }}
                >
                  Turn off sync
                </Button>
              )}
            </div>

            <dl className="grid gap-1 text-sm text-muted-foreground">
              <div className="flex gap-2">
                <dt>Status:</dt>
                <dd>{syncError ? `${syncState} — ${syncError}` : syncState}</dd>
              </div>
              <div className="flex gap-2">
                <dt>Last synced:</dt>
                <dd>{lastSynced ? lastSynced.toLocaleString() : "never"}</dd>
              </div>
              <div className="flex gap-2">
                <dt>Data size:</dt>
                <dd>{sizeMb.toFixed(2)} MB</dd>
              </div>
            </dl>

            {sizeMb > 40 && (
              <p className="rounded-md border border-amber-900 bg-amber-950 p-3 text-sm text-amber-200">
                Your data is over 40 MB, mostly from images pasted into cards.
                GitHub refuses files above 100 MB — consider trimming large
                images before you get there.
              </p>
            )}

            {syncState === "conflict" && (
              <div className="rounded-md border border-amber-900 bg-amber-950 p-3">
                <p className="text-sm text-amber-100">
                  This file also changed on GitHub. Keeping one version discards
                  the other.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      const active = getSyncConfig();
                      if (!active) return;
                      setBusy(true);
                      await resolveWithLocal(active);
                      setMessage(
                        "Overwrote GitHub with this device's version.",
                      );
                      setBusy(false);
                    }}
                  >
                    Keep this device
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={async () => {
                      const active = getSyncConfig();
                      if (!active) return;
                      setBusy(true);
                      await resolveWithRemote(active);
                      setMessage(
                        "Replaced local data with the GitHub version.",
                      );
                      setBusy(false);
                    }}
                  >
                    Take GitHub&apos;s version
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Storage on this device</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your decks are read from this browser and only synced to GitHub. A
          browser may clear a site&apos;s storage to reclaim space, or after a
          stretch without a visit — which would take your sync token with it.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {storage === "persistent" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-500/25 ring-inset dark:text-emerald-300">
              <ShieldCheck className="size-3.5" />
              Kept — this browser won&apos;t clear it on its own
            </span>
          ) : storage === "evictable" ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-500/25 ring-inset dark:text-amber-300">
                <ShieldAlert className="size-3.5" />
                Treated as temporary
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const next = await requestPersistentStorage();
                  setStorage(next);
                  setMessage(
                    next === "persistent"
                      ? "This browser will now keep your decks."
                      : "The browser declined for now. Adding Cue to your home screen usually changes its mind.",
                  );
                  setBusy(false);
                }}
              >
                Ask the browser to keep it
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              This browser doesn&apos;t report a storage policy.
            </span>
          )}
          {usageMb !== null && (
            <span className="text-xs text-muted-foreground">
              {usageMb.toFixed(1)} MB used on this device
            </span>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Pictures</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pictures pasted into cards used to be stored inside the deck file
          itself, encoded as text. That costs about a third again in the file,
          and another third when the file is sent — which is why syncing
          stopped: GitHub refused the size. Moved out, each picture is a file of
          its own, uploaded once instead of on every change.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {inlineImages.cards === 0 ? (
            <span className="text-xs text-muted-foreground">
              Nothing to move — every picture is already stored on its own.
            </span>
          ) : (
            <>
              <span className="text-sm">
                <strong className="tabular-nums">
                  {(inlineImages.bytes / 1024 / 1024).toFixed(1)} MB
                </strong>{" "}
                of pictures inside{" "}
                <strong className="tabular-nums">{inlineImages.cards}</strong>{" "}
                card{inlineImages.cards === 1 ? "" : "s"}.
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || moving !== null}
                onClick={async () => {
                  setMoving({ done: 0, total: inlineImages.cards, images: 0 });
                  try {
                    const result = await migrateInlineImages(setMoving);
                    setMessage(
                      `Moved ${result.images} picture${result.images === 1 ? "" : "s"} out of ${result.cards} card${result.cards === 1 ? "" : "s"} — the deck file is ${(result.freed / 1024 / 1024).toFixed(1)} MB smaller.`,
                    );
                  } finally {
                    setMoving(null);
                  }
                }}
              >
                Move them out
              </Button>
              {moving && (
                <span
                  role="status"
                  className="text-xs text-muted-foreground tabular-nums"
                >
                  {moving.done} of {moving.total} cards · {moving.images}{" "}
                  pictures stored
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {/* Said here rather than in a dialog: it is advice, not a
                    gate, and the work is safe to interrupt. */}
                Take a backup first, below.
              </span>
            </>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Review schedules</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A card is archived when it has been answered correctly enough times in
          a row for its schedule. Shortening a schedule leaves cards that have
          already passed the new mark still sitting in their decks — nothing has
          asked them a question since, so nothing has noticed.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {learned === 0 ? (
            <span className="text-xs text-muted-foreground">
              Nothing is waiting — every card is where its schedule says it
              should be.
            </span>
          ) : (
            <>
              <span className="text-sm">
                <strong className="tabular-nums">{learned}</strong> card
                {learned === 1 ? " has" : "s have"} already met their schedule.
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const moved = await archiveLearnedCardsAction();
                  setMessage(
                    `Archived ${moved} card${moved === 1 ? "" : "s"} that had already met their schedule.`,
                  );
                  setBusy(false);
                }}
              >
                Archive them
              </Button>
            </>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Backup</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A copy you hold yourself, independent of GitHub.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handleDownload}>
            <Download className="size-4" />
            Download backup
          </Button>
          <Button
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            <Upload className="size-4" />
            Restore from file
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleRestore(file);
              e.target.value = "";
            }}
          />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {doc.decks.length} decks, {doc.cards.length} cards.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">AI</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional. With a key set, decks get a &ldquo;Generate with AI&rdquo;
          button and a selected image can be turned into text. Requests go
          straight from this browser to {AI_PROVIDER_SPECS[provider].label} and
          are billed to your own account.
        </p>
        <Card className="mt-4">
          <CardContent className="grid gap-4 pt-6">
            {/* Each provider keeps its own key and model, so trying the other
                one and coming back does not mean typing a key in again. */}
            <div className="grid gap-1.5">
              <Label>Provider</Label>
              <div className="flex flex-wrap gap-2">
                {AI_PROVIDERS.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={option === provider ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setProvider(option);
                      setKey(getAIKey(option) ?? "");
                      setModel(getAIModel(option));
                    }}
                  >
                    {AI_PROVIDER_SPECS[option].label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-key">
                {AI_PROVIDER_SPECS[provider].label} API key
              </Label>
              <Input
                id="ai-key"
                type="password"
                value={apiKey}
                placeholder={provider === "gemini" ? "AIza…" : "sk-…"}
                onChange={(e) => setKey(e.target.value.trim())}
              />
              <p className="text-xs text-muted-foreground">
                Get one at{" "}
                <a
                  href={AI_PROVIDER_SPECS[provider].keysUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  {new URL(AI_PROVIDER_SPECS[provider].keysUrl).host}
                </a>
                . Kept on this device only — never in the synced file.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                value={model}
                placeholder={AI_PROVIDER_SPECS[provider].defaultModel}
                onChange={(e) => setModel(e.target.value.trim())}
              />
            </div>
            <div>
              <Button
                onClick={() => {
                  setAIProvider(provider);
                  setAIKey(provider, apiKey || null);
                  setAIModel(provider, model || null);
                  setMessage(
                    `AI settings saved — using ${AI_PROVIDER_SPECS[provider].label}.`,
                  );
                }}
              >
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
        <div className="mt-3">
          <Button variant="outline" onClick={() => setResetOpen(true)}>
            Reset local data
          </Button>
        </div>
      </section>

      {message && (
        <p className="mt-6 rounded-md border bg-muted p-3 text-sm">{message}</p>
      )}

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Erase everything on this device?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This clears all decks and cards stored in this browser. If sync is
              on, the empty database will be pushed to GitHub the next time you
              make a change — download a backup first if you are unsure.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                await resetDoc();
                setResetOpen(false);
                setMessage("Local data cleared.");
              }}
            >
              Erase
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
