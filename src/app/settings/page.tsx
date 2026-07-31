"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
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
  push,
  resolveWithLocal,
  resolveWithRemote,
  setSyncConfig,
  subscribeSync,
  testConnection,
  type SyncConfig,
  type SyncState,
} from "@/lib/store/github-sync";
import {
  DEFAULT_OPENAI_MODEL,
  getOpenAIKey,
  getOpenAIModel,
  setOpenAIKey,
  setOpenAIModel,
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
  const syncError = useSyncExternalStore(subscribeSync, getSyncError, () => null);

  const [config, setConfig] = useState<SyncConfig>(EMPTY_CONFIG);
  const [openaiKey, setKey] = useState("");
  const [openaiModel, setModel] = useState(DEFAULT_OPENAI_MODEL);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // localStorage is browser-only, so everything is read after mount.
  useEffect(() => {
    setConfig(getSyncConfig() ?? EMPTY_CONFIG);
    setKey(getOpenAIKey() ?? "");
    setModel(getOpenAIModel());
    setLastSynced(getLastSyncedAt());
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
        ? `Connected. Found ${config.path} (${(result.size / 1024 / 1024).toFixed(2)} MB). Reload to pull it in.`
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
      const result = await push(active);
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
    link.download = `flashycardy-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleRestore(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(await file.text()) as SerializedDbDoc;
      if (!Array.isArray(parsed.decks) || !Array.isArray(parsed.cards)) {
        throw new Error("That file doesn't look like a FlashyCardy backup.");
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
          scoped to only that repository, with <em>Contents: read and write</em>.
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
                  placeholder="flashycardy-data"
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
                    setMessage("Sync turned off. Your data stays in this browser.");
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
                      setMessage("Overwrote GitHub with this device's version.");
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
                      setMessage("Replaced local data with the GitHub version.");
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
        <h2 className="text-lg font-semibold">AI card generation</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional. With a key set, decks get a &ldquo;Generate with AI&rdquo;
          button. Requests go straight from this browser to OpenAI and are billed
          to your own account.
        </p>
        <Card className="mt-4">
          <CardContent className="grid gap-4 pt-6">
            <div className="grid gap-1.5">
              <Label htmlFor="openai">OpenAI API key</Label>
              <Input
                id="openai"
                type="password"
                value={openaiKey}
                placeholder="sk-…"
                onChange={(e) => setKey(e.target.value.trim())}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                value={openaiModel}
                onChange={(e) => setModel(e.target.value.trim())}
              />
            </div>
            <div>
              <Button
                onClick={() => {
                  setOpenAIKey(openaiKey || null);
                  setOpenAIModel(openaiModel || null);
                  setMessage("AI settings saved.");
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
            <AlertDialogTitle>Erase everything on this device?</AlertDialogTitle>
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
