"use client";

import { Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  CornerDownRight,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore, useStoreReady } from "@/lib/store/use-store";
import {
  selectMemoById,
  selectMemosMatching,
  selectMemoTree,
} from "@/db/queries/memos";
import type { DbDoc, Memo } from "@/lib/store/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/rich-text-editor";
import {
  DndContext,
  closestCenter,
  pointerWithin,
  useDroppable,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  reorderNotesAction,
  setNoteParentAction,
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

  const searching = query.trim().length > 0;
  /**
   * The notes as written: top-level ones, each with whatever sits under it.
   *
   * Only while not searching. A search is a question about every note, and
   * hiding a match inside a collapsed parent would answer it with "nothing" —
   * so results are a flat list and the nesting steps out of the way.
   */
  const tree = useStore(
    useCallback((db: DbDoc) => selectMemoTree(db, LOCAL_USER_ID), []),
  );
  const matches = useStore(
    useCallback(
      (db: DbDoc) =>
        searching ? selectMemosMatching(db, LOCAL_USER_ID, query) : [],
      [query, searching],
    ),
  );
  const memos = searching ? matches : tree.map((node) => node.memo);
  /** Which parents are open. Collapsed by default: the point is a shorter list. */
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const dndId = useId();
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const sensors = useSensors(
    // A short distance before a drag starts, so tapping a note still opens it.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * A nest zone wins only when the pointer is genuinely inside one; everything
   * else falls through to ordinary sorting.
   */
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const nest = pointerWithin(args).find((c) =>
        String(c.id).startsWith(NEST_PREFIX),
      );
      return nest ? [nest] : closestCenter(args);
    },
    [],
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setDraggingId(null);
    if (!over || active.id === over.id) return;
    const noteId = Number(active.id);
    const overId = String(over.id);

    if (overId.startsWith(NEST_PREFIX)) {
      const parentId = Number(overId.slice(NEST_PREFIX.length));
      setExpanded((prev) => new Set(prev).add(parentId));
      void setNoteParentAction({ id: noteId, parentId });
      return;
    }

    // Reordering happens within one level: the siblings of whatever was picked
    // up. Dragging between levels is what the nest zone and the move-out button
    // are for, and letting a sort do it as well would make two ways to say the
    // same thing, each with its own edge cases.
    const moved = [...tree.flatMap((n) => [n.memo, ...n.children])].find(
      (m) => m.id === noteId,
    );
    const siblings = (moved?.parentId ?? null) === null
      ? tree.map((n) => n.memo)
      : (tree.find((n) => n.memo.id === moved?.parentId)?.children ?? []);
    const oldIndex = siblings.findIndex((m) => m.id === noteId);
    const newIndex = siblings.findIndex((m) => m.id === Number(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const next = [...siblings];
    const [row] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, row);
    void reorderNotesAction({ orderedIds: next.map((m) => m.id) });
  }

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  const selected = useStore(
    useCallback(
      (db: DbDoc) =>
        selectedId === null ? null : selectMemoById(db, selectedId, LOCAL_USER_ID),
      [selectedId],
    ),
  );

  async function handleNew(parentId: number | null = null) {
    const created = await addNoteAction(parentId ? { parentId } : {});
    if (created) {
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      setSelectedId(created.id);
    }
  }

  /** The note open in the editor, and whether it is somebody's child. */
  const selectedParentId = selected?.parentId ?? null;
  const selectedHasChildren = tree.some(
    (node) => node.memo.id === selected?.id && node.children.length > 0,
  );

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
          <Button size="sm" onClick={() => handleNew()}>
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
            <DndContext
              id={dndId}
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={(e: DragStartEvent) =>
                setDraggingId(Number(e.active.id))
              }
              onDragEnd={handleDragEnd}
              onDragCancel={() => setDraggingId(null)}
            >
              <SortableContext
                items={memos.map((m) => m.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="grid grid-cols-1 gap-1">
                  {memos.map((memo) => {
                    const children = searching
                      ? []
                      : (tree.find((n) => n.memo.id === memo.id)?.children ??
                        []);
                    const open = expanded.has(memo.id);
                    const dragged = draggingId;
                    // Offered only while something is being dragged, and never
                    // over the note doing the dragging or one that is already a
                    // child — nesting stops at one level.
                    const canTakeChild =
                      !searching &&
                      dragged !== null &&
                      dragged !== memo.id &&
                      memo.parentId === null &&
                      !tree.some(
                        (n) => n.memo.id === dragged && n.children.length > 0,
                      );
                    return (
                      <li key={memo.id} className="grid grid-cols-1 gap-1">
                        <SortableNote
                          memo={memo}
                          nestZone={
                            canTakeChild ? <NestZone noteId={memo.id} /> : null
                          }
                        >
                          <NoteRow
                            memo={memo}
                            selected={memo.id === selectedId}
                            onOpen={() => setSelectedId(memo.id)}
                            disclosure={
                              children.length > 0 ? (
                                <button
                                  type="button"
                                  aria-label={`${open ? "Collapse" : "Expand"} ${heading(memo)}`}
                                  aria-expanded={open}
                                  // Stops the row's drag listeners from
                                  // swallowing the click that folds it.
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={() => toggle(memo.id)}
                                  className="-ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                >
                                  <ChevronRight
                                    className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`}
                                  />
                                </button>
                              ) : null
                            }
                            count={children.length}
                          />
                        </SortableNote>
                        {open && children.length > 0 && (
                          <SortableContext
                            items={children.map((c) => c.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {children.map((child) => (
                              <div
                                key={child.id}
                                className="ml-3 border-l border-border/60 pl-2"
                              >
                                <SortableNote memo={child}>
                                  <NoteRow
                                    memo={child}
                                    selected={child.id === selectedId}
                                    onOpen={() => setSelectedId(child.id)}
                                  />
                                </SortableNote>
                              </div>
                            ))}
                          </SortableContext>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {selected ? (
          <NoteEditor
            key={selected.id}
            memo={selected}
            onBack={() => setSelectedId(null)}
            onDelete={() => setDoomed(selected)}
            // A note can take sub-notes only if it is not one itself, and can
            // be moved out only if it is. The two are never both offered.
            onAddSubNote={
              selectedParentId === null
                ? () => void handleNew(selected.id)
                : undefined
            }
            onMoveOut={
              selectedParentId !== null
                ? () => void setNoteParentAction({ id: selected.id, parentId: null })
                : undefined
            }
            childCount={selectedHasChildren ? 1 : 0}
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

/** Droppable id prefix for the "file this under that note" zones. */
const NEST_PREFIX = "nest-";

/**
 * The drop target that files one note under another.
 *
 * Only rendered mid-drag, and only over notes that can actually take a child —
 * a top-level note, and not the one being dragged. It says what it does,
 * because filing a note away is a different and more surprising outcome than
 * nudging it up a place, and it should never happen by accident.
 */
function NestZone({ noteId }: { noteId: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${NEST_PREFIX}${noteId}` });
  return (
    <div
      ref={setNodeRef}
      // The right half of the row only. The decks version can afford the middle
      // of a big card, but a note row is about fifty pixels tall — a zone over
      // all of it caught every reordering drag as a nesting one, so there was
      // no way left to simply move a note up. Left half sorts, right half files.
      className={`absolute inset-y-1 right-1 z-20 flex w-[45%] items-center justify-center gap-1.5 rounded-md border-2 border-dashed text-[0.7rem] font-medium transition-colors ${
        isOver
          ? "border-violet-400 bg-violet-500/25 text-violet-900 dark:text-violet-100"
          : "border-violet-400/40 bg-violet-500/10 text-violet-700/80 dark:text-violet-300/80"
      }`}
    >
      <CornerDownRight className="size-3" />
      File under this
    </div>
  );
}

/**
 * A row that can be picked up.
 *
 * The whole row is the handle rather than a separate grip: there is no room for
 * one beside a title and a date, and an 8px activation distance means a click
 * still opens the note it lands on.
 */
function SortableNote({
  memo,
  children,
  nestZone,
}: {
  memo: Memo;
  children: React.ReactNode;
  nestZone?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: memo.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative touch-none ${isDragging ? "z-30 opacity-60" : ""}`}
      {...attributes}
      {...listeners}
    >
      {children}
      {nestZone}
    </div>
  );
}

/**
 * A row in the list: one note, with room for a disclosure triangle.
 *
 * Shared by parents and children so the two read identically — a sub-note is
 * the same kind of thing as a note, just filed under one, and giving it its own
 * smaller styling would suggest otherwise.
 */
function NoteRow({
  memo,
  selected,
  onOpen,
  disclosure,
  count = 0,
}: {
  memo: Memo;
  selected: boolean;
  onOpen: () => void;
  disclosure?: React.ReactNode;
  count?: number;
}) {
  return (
    <div
      className={`flex items-start gap-1 rounded-lg border px-2 py-2 transition-colors ${
        selected ? "border-ring bg-muted" : "border-border/60 hover:bg-muted/60"
      }`}
    >
      {disclosure ?? <span className="w-0" />}
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {memo.pinned && (
            <Pin className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-medium">{heading(memo)}</span>
          {count > 0 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 text-[0.65rem] text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
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
  onAddSubNote,
  onMoveOut,
}: {
  memo: Memo;
  onBack: () => void;
  onDelete: () => void;
  /** Present on a top-level note: start another one filed under it. */
  onAddSubNote?: () => void;
  /** Present on a sub-note: lift it back out to the top level. */
  onMoveOut?: () => void;
  childCount?: number;
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
        {onAddSubNote && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Add a note under this one"
            title="Add a note under this one"
            onClick={onAddSubNote}
          >
            <Plus className="size-3.5" />
          </Button>
        )}
        {onMoveOut && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Move this note out on its own"
            title="Move this note out on its own"
            onClick={onMoveOut}
          >
            <CornerDownRight className="size-3.5 rotate-180" />
          </Button>
        )}
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
