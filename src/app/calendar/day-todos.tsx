"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  CalendarArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  GripVertical,
  ListTodo,
  NotebookPen,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectTodosForDay } from "@/db/queries/todos";
import type { DayTodo, DbDoc } from "@/lib/store/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isTodoDrag, readTodoDrag, startTodoDrag } from "./todo-drag";
import { EnableNotifications } from "@/components/todo-reminders";
import { ConfirmDoneDialog } from "@/components/confirm-done-dialog";
import {
  addDayTodoAction,
  deleteDayTodoAction,
  duplicateDayTodoAction,
  moveOpenTodosAction,
  reorderDayTodosAction,
  updateDayTodoAction,
} from "./actions";

/** `YYYY-MM-DD` shifted by whole days, staying in the local calendar. */
export function shiftDay(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayLabel(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

interface DayTodosProps {
  /** The day this list belongs to, `YYYY-MM-DD`. */
  date: string;
  /** Names the day beside the heading, for when it isn't obvious which one. */
  label?: string;
  /**
   * Bumped by whoever wants the cursor put in the add field.
   *
   * A number rather than a boolean because the same day can be asked for
   * twice: a second `true` is indistinguishable from the first, but a second
   * number is not.
   */
  focusSignal?: number;
}

/**
 * The things to do on one day, alongside the cards due on it.
 *
 * Anything here can be carried to another day rather than only ticked off or
 * deleted: most of what doesn't happen on a Tuesday still needs doing, and a
 * list that can only be finished or abandoned gets abandoned.
 */
export function DayTodos({ date, label, focusSignal = 0 }: DayTodosProps) {
  const todos = useStore(
    useCallback(
      (db: DbDoc) => selectTodosForDay(db, date, LOCAL_USER_ID),
      [date],
    ),
  );
  const [draft, setDraft] = useState("");
  const [pending, startWriting] = useTransition();
  /** Which item is showing its date picker, if any. */
  const [movingId, setMovingId] = useState<number | null>(null);
  const [moveTo, setMoveTo] = useState(date);
  /** Which item is having a time set, if any. */
  const [timingId, setTimingId] = useState<number | null>(null);
  /** Which item's note is open, and what it currently says. */
  const [notingId, setNotingId] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  function openNote(id: number, note: string) {
    setNotingId(id);
    setNoteDraft(note);
  }

  function commitNote(id: number, original: string) {
    const note = noteDraft.trim();
    setNotingId(null);
    if (note === original) return;
    startWriting(async () => {
      await updateDayTodoAction({ id, note });
    });
  }

  /** Which item's words are being changed, and what they currently say. */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  function startEditing(id: number, text: string) {
    setEditingId(id);
    setEditText(text);
  }

  /**
   * Keeps the new wording, unless there is none.
   *
   * An emptied box cancels rather than deletes: the row has a delete button of
   * its own, and losing an item to a stray select-all would be a poor way to
   * find that out.
   */
  function commitEdit(id: number, original: string) {
    const text = editText.trim();
    setEditingId(null);
    if (!text || text === original) return;
    startWriting(async () => {
      await updateDayTodoAction({ id, text });
    });
  }
  /** The row a dragged item is over, and which side of it, for the insert line. */
  const [dropOn, setDropOn] = useState<{ id: number; below: boolean } | null>(
    null,
  );
  /** The item waiting on "Mark this as done?", or null. */
  const [confirming, setConfirming] = useState<DayTodo | null>(null);
  /** Set when the whole day's open items are being carried somewhere. */
  const [carrying, setCarrying] = useState(false);
  const [carryTo, setCarryTo] = useState(() => shiftDay(date, 1));
  const addRef = useRef<HTMLInputElement>(null);

  // Brought into view as well as focused: the list sits above the grid, so a
  // day picked from a square near the bottom would otherwise put the cursor
  // somewhere off the top of the screen.
  useEffect(() => {
    if (focusSignal === 0) return;
    addRef.current?.focus();
    addRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusSignal]);

  const open = todos.filter((t) => !t.done).length;

  function add() {
    if (!draft.trim()) return;
    const text = draft;
    setDraft("");
    startWriting(async () => {
      await addDayTodoAction({ date, text });
      // Focus is kept in the field so a list can be typed out in one go.
      addRef.current?.focus();
    });
  }

  function move(id: number, to: string) {
    setMovingId(null);
    startWriting(async () => {
      await updateDayTodoAction({ id, date: to });
    });
  }

  /**
   * Put `id` where `target` is, above or below it.
   *
   * The whole day's order is sent rather than the pair that changed: the list
   * on screen is already the order the day is in, so rebuilding it here is
   * exactly what the day should end up as.
   */
  function reorder(id: number, target: number, below: boolean) {
    setDropOn(null);
    if (id === target) return;
    const ids = todos.map((t) => t.id).filter((other) => other !== id);
    const at = ids.indexOf(target);
    if (at === -1) return;
    ids.splice(below ? at + 1 : at, 0, id);
    startWriting(async () => {
      await reorderDayTodosAction({ date, ids });
    });
  }

  /** Steps an item one place up or down its own list. */
  function nudge(id: number, delta: number) {
    const ids = todos.map((t) => t.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    startWriting(async () => {
      await reorderDayTodosAction({ date, ids });
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <ListTodo className="size-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          To do
        </h3>
        {label && (
          <span className="text-xs font-medium text-foreground">{label}</span>
        )}
        {todos.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {open === 0
              ? `all ${todos.length} done`
              : `${open} of ${todos.length} left`}
          </span>
        )}
      </div>

      <ul className="mt-2 grid gap-0.5">
        {todos.map((todo, index) => (
          <li
            key={todo.id}
            // One drag, two meanings, decided by where it is let go: a square in
            // the grid above moves the item to that day, another row moves it to
            // that place in this day. The buttons do both jobs for touch and for
            // the keyboard.
            draggable={!pending && editingId !== todo.id}
            onDragStart={(e) => startTodoDrag(e, todo.id)}
            onDragEnd={() => setDropOn(null)}
            onDragOver={(e) => {
              if (!isTodoDrag(e)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              // Which half of the row the pointer is in decides whether the
              // item lands above or below it.
              const box = e.currentTarget.getBoundingClientRect();
              const below = e.clientY > box.top + box.height / 2;
              if (dropOn?.id !== todo.id || dropOn.below !== below) {
                setDropOn({ id: todo.id, below });
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
                return;
              }
              setDropOn((current) =>
                current?.id === todo.id ? null : current,
              );
            }}
            onDrop={(e) => {
              const dragged = readTodoDrag(e);
              const below = dropOn?.id === todo.id ? dropOn.below : false;
              setDropOn(null);
              if (dragged === null) return;
              e.preventDefault();
              // Stops the square underneath from also claiming it as a move to
              // another day.
              e.stopPropagation();
              reorder(dragged, todo.id, below);
            }}
            className={`group rounded-md px-1.5 py-1 hover:bg-muted/60 ${
              dropOn?.id === todo.id
                ? dropOn.below
                  ? "border-b-2 border-amber-500"
                  : "border-t-2 border-amber-500"
                : "border-y-2 border-transparent"
            }`}
          >
            <div className="flex items-center gap-2">
              <GripVertical
                aria-hidden
                className="-ml-1 size-3.5 shrink-0 cursor-grab text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
              />
              <button
                type="button"
                role="checkbox"
                aria-checked={todo.done}
                aria-label={todo.done ? "Mark as not done" : "Mark as done"}
                disabled={pending}
                onClick={() => {
                  // Ticking asks first; un-ticking is the correction for a
                  // mis-hit and happens straight away.
                  if (!todo.done) {
                    setConfirming(todo);
                    return;
                  }
                  startWriting(async () => {
                    await updateDayTodoAction({ id: todo.id, done: false });
                  });
                }}
                className={`flex size-4 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors ${
                  todo.done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-input hover:border-emerald-500"
                }`}
              >
                {todo.done && <Check className="size-3" />}
              </button>

              {todo.important && (
                <Star
                  aria-label="Important"
                  className={`size-3.5 shrink-0 fill-current ${
                    todo.done ? "text-muted-foreground" : "text-amber-500"
                  }`}
                />
              )}

              {editingId === todo.id ? (
                <Input
                  value={editText}
                  autoFocus
                  maxLength={500}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitEdit(todo.id, todo.text);
                    }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => commitEdit(todo.id, todo.text)}
                  className="h-7 min-w-0 flex-1 px-2 py-0 text-sm"
                />
              ) : (
                <button
                  type="button"
                  // The words are the control: a copy exists to be changed into
                  // something else, and hunting for a pencil to do it would be
                  // the long way round.
                  title="Click to edit"
                  onClick={() => startEditing(todo.id, todo.text)}
                  className={`min-w-0 flex-1 cursor-text truncate text-left text-sm ${
                    todo.done
                      ? "text-muted-foreground line-through"
                      : todo.important
                        ? "font-medium"
                        : ""
                  }`}
                >
                  {todo.text}
                </button>
              )}

              {todo.remindAt !== null && timingId !== todo.id && (
                <button
                  type="button"
                  disabled={pending}
                  title="Change or clear this time"
                  onClick={() => setTimingId(todo.id)}
                  className={`flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${
                    todo.done
                      ? "text-muted-foreground"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  }`}
                >
                  <Clock className="size-3" />
                  {todo.remindAt}
                </button>
              )}

              {timingId === todo.id && (
                // The time is committed as it is picked rather than behind a
                // save: there is nothing else on the row to get out of step
                // with it.
                <span className="flex shrink-0 items-center gap-1">
                  <Input
                    type="time"
                    autoFocus
                    value={todo.remindAt ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      startWriting(async () => {
                        await updateDayTodoAction({
                          id: todo.id,
                          remindAt: value === "" ? null : value,
                        });
                      });
                    }}
                    className="h-7 w-[7.5rem] px-2 py-0 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-1.5"
                    onClick={() => setTimingId(null)}
                  >
                    <X className="size-3.5" />
                    <span className="sr-only">Done setting the time</span>
                  </Button>
                </span>
              )}

              {movingId === todo.id ? (
                // The picker replaces the row's controls rather than sitting
                // beside them: it is the only thing being decided.
                <span className="flex shrink-0 items-center gap-1">
                  <Input
                    type="date"
                    value={moveTo}
                    autoFocus
                    onChange={(e) => setMoveTo(e.target.value)}
                    className="h-7 w-[9.5rem] px-2 py-0 text-xs"
                  />
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={pending || moveTo === date}
                    onClick={() => move(todo.id, moveTo)}
                  >
                    Move
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-1.5"
                    onClick={() => setMovingId(null)}
                  >
                    <X className="size-3.5" />
                    <span className="sr-only">Cancel the move</span>
                  </Button>
                </span>
              ) : (
                // Hidden until the row is pointed at, but always reachable by
                // keyboard — focus-within keeps them visible while tabbing.
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  {todos.length > 1 && (
                    <>
                      <button
                        type="button"
                        disabled={pending || index === 0}
                        title="Move up the list"
                        aria-label={`Move "${todo.text}" up the list`}
                        onClick={() => nudge(todo.id, -1)}
                        className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-default disabled:opacity-30"
                      >
                        <ChevronUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={pending || index === todos.length - 1}
                        title="Move down the list"
                        aria-label={`Move "${todo.text}" down the list`}
                        onClick={() => nudge(todo.id, 1)}
                        className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-default disabled:opacity-30"
                      >
                        <ChevronDown className="size-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    title={todo.important ? "No longer important" : "Important"}
                    aria-pressed={todo.important}
                    aria-label={`Mark "${todo.text}" as important`}
                    onClick={() =>
                      startWriting(async () => {
                        await updateDayTodoAction({
                          id: todo.id,
                          important: !todo.important,
                        });
                      })
                    }
                    className={`cursor-pointer rounded p-0.5 hover:bg-background ${
                      todo.important
                        ? "text-amber-500"
                        : "text-muted-foreground hover:text-amber-500"
                    }`}
                  >
                    <Star
                      className={`size-3.5 ${todo.important ? "fill-current" : ""}`}
                    />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    title={todo.note ? "Edit the note" : "Add a note"}
                    aria-label={`${todo.note ? "Edit" : "Add"} a note on "${todo.text}"`}
                    onClick={() => openNote(todo.id, todo.note)}
                    className={`cursor-pointer rounded p-0.5 hover:bg-background hover:text-foreground ${
                      todo.note ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <NotebookPen className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    title="Make a copy below"
                    aria-label={`Make a copy of "${todo.text}"`}
                    onClick={() =>
                      startWriting(async () => {
                        await duplicateDayTodoAction({ id: todo.id });
                      })
                    }
                    className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <Copy className="size-3.5" />
                  </button>
                  {/* The two jobs look alike at a glance — everything left of
                    this line is the item and its place in the list, everything
                    right of it is the calendar. */}
                  <span aria-hidden className="mx-0.5 h-3.5 w-px bg-border" />
                  <button
                    type="button"
                    disabled={pending}
                    title={`Move to ${dayLabel(shiftDay(todo.date, -1))}`}
                    aria-label={`Move to ${dayLabel(shiftDay(todo.date, -1))}`}
                    onClick={() => move(todo.id, shiftDay(todo.date, -1))}
                    className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    title={`Move to ${dayLabel(shiftDay(todo.date, 1))}`}
                    aria-label={`Move to ${dayLabel(shiftDay(todo.date, 1))}`}
                    onClick={() => move(todo.id, shiftDay(todo.date, 1))}
                    className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                  {todo.remindAt === null && (
                    <button
                      type="button"
                      disabled={pending}
                      title="Remind me at a time…"
                      aria-label={`Set a time for "${todo.text}"`}
                      onClick={() => setTimingId(todo.id)}
                      className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <Clock className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    title="Move to a day…"
                    aria-label="Move to a particular day"
                    onClick={() => {
                      setMoveTo(todo.date);
                      setMovingId(todo.id);
                    }}
                    className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <CalendarArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    title="Delete"
                    aria-label={`Delete "${todo.text}"`}
                    onClick={() =>
                      startWriting(async () => {
                        await deleteDayTodoAction({ id: todo.id });
                      })
                    }
                    className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-background hover:text-red-600"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              )}
            </div>

            {(notingId === todo.id || todo.note) &&
              (notingId === todo.id ? (
                <textarea
                  value={noteDraft}
                  autoFocus
                  rows={3}
                  maxLength={2000}
                  placeholder="What it involves, a link, a room number…"
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter makes a new line here — a note is prose, not a
                    // label — so leaving is how it is kept.
                    if (e.key === "Escape") setNotingId(null);
                  }}
                  onBlur={() => commitNote(todo.id, todo.note)}
                  className="mt-1 ml-[3.4rem] block w-[calc(100%-3.9rem)] resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none"
                />
              ) : (
                <button
                  type="button"
                  title="Click to edit this note"
                  onClick={() => openNote(todo.id, todo.note)}
                  className="mt-0.5 ml-[3.4rem] block w-[calc(100%-3.9rem)] cursor-text text-left text-xs whitespace-pre-line text-muted-foreground"
                >
                  {todo.note}
                </button>
              ))}
          </li>
        ))}
      </ul>

      <div className="mt-2 flex items-center gap-2">
        <Input
          ref={addRef}
          value={draft}
          maxLength={500}
          placeholder="Mock exam, revise fractions, print the worksheet…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="h-8 text-sm"
        />
        <Button
          size="sm"
          className="h-8"
          disabled={pending || !draft.trim()}
          onClick={add}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>

      {todos.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground/80">
          Click an item to edit it. Drag one onto another to reorder it, or onto
          a day above to move it there.
        </p>
      )}

      {todos.some((t) => t.remindAt !== null) && (
        <p className="mt-1">
          <EnableNotifications />
        </p>
      )}

      {open > 0 &&
        (carrying ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Carry {open} unfinished item{open === 1 ? "" : "s"} to
            </span>
            <Input
              type="date"
              value={carryTo}
              onChange={(e) => setCarryTo(e.target.value)}
              className="h-7 w-[9.5rem] px-2 py-0 text-xs"
            />
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={pending || carryTo === date}
              onClick={() => {
                setCarrying(false);
                startWriting(async () => {
                  await moveOpenTodosAction({ from: date, to: carryTo });
                });
              }}
            >
              Carry them over
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setCarrying(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCarryTo(shiftDay(date, 1));
              setCarrying(true);
            }}
            className="mt-2 cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Carry what&rsquo;s left to another day…
          </button>
        ))}

      <ConfirmDoneDialog
        todo={confirming}
        onOpenChange={(open) => !open && setConfirming(null)}
        onConfirm={(todo) => {
          setConfirming(null);
          startWriting(async () => {
            await updateDayTodoAction({ id: todo.id, done: true });
          });
        }}
      />
    </div>
  );
}
