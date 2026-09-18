"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore, useStoreReady } from "@/lib/store/use-store";
import { selectMemoById, selectMemosMatching } from "@/db/queries/memos";
import type { DbDoc, Memo } from "@/lib/store/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/rich-text-editor";
import { noteBodyToHtml, noteBodyToText } from "@/lib/note-body";
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
  addNoteAction,
  deleteNoteAction,
  updateNoteAction,
} from "./actions";

/** How long typing has to pause before a note is written. */
const SAVE_AFTER_MS = 700;

/** "Just now", "14:32" today, otherwise a short date. */
function when(date: Date): string {
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The first line that has anything on it, for the list. */
function preview(memo: Memo): string {
  const line = noteBodyToText(memo.body)
    .split("\n")
    .find((l) => l.trim().length > 0);
  return line?.trim() ?? "";
}

function heading(memo: Memo): string {
  return memo.title.trim() || preview(memo) || "Untitled";
}

function NotesPageContent() {
  const ready = useStoreReady();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  /**
   * Which note is open.
   *
   * Seeded from `?note=` so a search result on the dashboard opens the note it
   * names rather than the list. Read once, as the initial value: it is a
   * request made on arrival, and re-reading it every render would drag you back
   * to that note each time you picked another.
   */
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const asked = Number(searchParams.get("note"));
    return Number.isInteger(asked) && asked > 0 ? asked : null;
  });
  const [doomed, setDoomed] = useState<Memo | null>(null);

  const memos = useStore(
    useCallback(
      (db: DbDoc) => selectMemosMatching(db, LOCAL_USER_ID, query),
      [query],
    ),
  );
  const selected = useStore(
    useCallback(
      (db: DbDoc) =>
        selectedId === null ? null : selectMemoById(db, selectedId, LOCAL_USER_ID),
      [selectedId],
    ),
  );

  async function handleNew() {
    const created = await addNoteAction({});
    if (created) setSelectedId(created.id);
  }

  async function handleDelete(memo: Memo) {
    setDoomed(null);
    await deleteNoteAction({ id: memo.id });
    if (selectedId === memo.id) setSelectedId(null);
  }

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="h-9 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link
        href="/dashboard"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Back to decks
      </Link>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Notes</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes"
              aria-label="Search notes"
              className="h-8 w-48 pl-7"
            />
          </div>
          <Button size="sm" onClick={handleNew}>
            <Plus className="size-3.5" />
            New note
          </Button>
        </div>
      </div>

      {/* One column on a phone, where the list and the note take turns; two
          side by side once there is room for both, which is how a note is
          actually worked on — reading one while glancing down the rest. */}
      <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <div className={selected ? "hidden md:block" : ""}>
          {memos.length === 0 ? (
            <p className="rounded-lg border border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
              {query
                ? "Nothing matches that."
                : "No notes yet. Start one with New note."}
            </p>
          ) : (
            // `grid-cols-1` rather than a bare `grid`: an implicit column is
            // sized `auto`, which is max-content, so one long unbroken line of
            // preview text made the whole list wider than its column and spilled
            // it over the editor. `minmax(0,1fr)` caps it at the column.
            <ul className="grid grid-cols-1 gap-1">
              {memos.map((memo) => (
                <li key={memo.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(memo.id)}
                    aria-current={memo.id === selectedId}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      memo.id === selectedId
                        ? "border-ring bg-muted"
                        : "border-border/60 hover:bg-muted/60"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {memo.pinned && (
                        <Pin className="size-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm font-medium">
                        {heading(memo)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-baseline justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {preview(memo) || "Empty"}
                      </span>
                      <span className="shrink-0 text-[0.7rem] text-muted-foreground">
                        {when(memo.updatedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected ? (
          <NoteEditor
            key={selected.id}
            memo={selected}
            onBack={() => setSelectedId(null)}
            onDelete={() => setDoomed(selected)}
          />
        ) : (
          <div className="hidden items-center justify-center rounded-lg border border-dashed border-border/60 p-10 text-sm text-muted-foreground md:flex">
            Pick a note, or start a new one.
          </div>
        )}
      </div>

      <AlertDialog
        open={doomed !== null}
        onOpenChange={(open) => !open && setDoomed(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              It goes from this device and, on the next sync, from your repo.
              A copy of your notes before this change stays in that repo&rsquo;s
              history.
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
    </div>
  );
}

/**
 * One note, open.
 *
 * Mounted with `key={memo.id}` by the page, so switching notes builds a fresh
 * editor rather than reusing this one — which is what keeps the draft below
 * from following you into the next note.
 */
function NoteEditor({
  memo,
  onBack,
  onDelete,
}: {
  memo: Memo;
  onBack: () => void;
  onDelete: () => void;
}) {
  /**
   * What is on screen, which leads what is stored.
   *
   * Held locally rather than driven from the document because saving restamps
   * the note and re-renders the page: typing straight into the stored value
   * would put the cursor back at the end of the text on every keystroke.
   */
  const [title, setTitle] = useState(memo.title);
  /**
   * The body as HTML, converted on the way in if it was typed as plain text.
   *
   * Compared against the same conversion below rather than against the stored
   * value, so simply opening a note written before the editor arrived does not
   * read as an edit and quietly rewrite it.
   */
  const [body, setBody] = useState(() => noteBodyToHtml(memo.body));
  const storedBody = noteBodyToHtml(memo.body);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Whether the screen is ahead of the document.
   *
   * Derived rather than tracked: once a save lands, the stored note comes back
   * through the store with the same words, and the comparison answers itself.
   * A `saved` flag would have been a second source of truth for something the
   * two values already say, and one more thing to get out of step.
   */
  const dirty = title !== memo.title || body !== storedBody;

  // Written after typing pauses rather than on every keystroke: each save
  // rewrites the whole document and schedules a push to GitHub, and a commit
  // per character is not a useful history of anything.
  useEffect(() => {
    if (!dirty) return;
    const handle = setTimeout(() => {
      void updateNoteAction({ id: memo.id, title, body });
    }, SAVE_AFTER_MS);
    timer.current = handle;
    // Also the unmount path, so closing a note mid-sentence does not leave a
    // save pending against an editor that has gone.
    return () => clearTimeout(handle);
  }, [dirty, title, body, memo.id]);

  /** Save now rather than in a moment — on blur, or on leaving the note. */
  function flush() {
    if (timer.current) clearTimeout(timer.current);
    if (!dirty) return;
    void updateNoteAction({ id: memo.id, title, body });
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Back to the list"
          className="md:hidden"
          onClick={() => {
            flush();
            onBack();
          }}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={flush}
          placeholder="Title"
          aria-label="Note title"
          className="h-8 flex-1 border-0 bg-transparent px-0 text-base font-medium shadow-none focus-visible:ring-0"
        />
        <span
          aria-live="polite"
          className="shrink-0 text-xs text-muted-foreground"
        >
          {dirty ? "Saving…" : "Saved"}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={memo.pinned ? "Unpin this note" : "Pin this note"}
          title={memo.pinned ? "Unpin this note" : "Pin this note"}
          onClick={() =>
            void updateNoteAction({ id: memo.id, pinned: !memo.pinned })
          }
        >
          {memo.pinned ? (
            <PinOff className="size-3.5" />
          ) : (
            <Pin className="size-3.5" />
          )}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Delete this note"
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            onDelete();
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {/* The same editor the cards use, so a note can carry headings, lists
          and code rather than being one block of plain text. Losing focus is
          the editor's own business, so saving on blur goes with it — the pause
          timer above is what commits now. */}
      <RichTextEditor
        content={body}
        onChange={setBody}
        placeholder="Write it down…"
      />
    </div>
  );
}

export default function NotesPage() {
  // `useSearchParams` suspends during prerender, so the boundary is required.
  return (
    <Suspense>
      <NotesPageContent />
    </Suspense>
  );
}
