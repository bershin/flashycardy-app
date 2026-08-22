"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import {
  CalendarArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GripVertical,
  ListTodo,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectTodosForDay } from "@/db/queries/todos";
import type { DbDoc } from "@/lib/store/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isTodoDrag, readTodoDrag, startTodoDrag } from "./todo-drag";
import {
  addDayTodoAction,
  deleteDayTodoAction,
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
}

/**
 * The things to do on one day, alongside the cards due on it.
 *
 * Anything here can be carried to another day rather than only ticked off or
 * deleted: most of what doesn't happen on a Tuesday still needs doing, and a
 * list that can only be finished or abandoned gets abandoned.
 */
export function DayTodos({ date }: DayTodosProps) {
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
  /** The row a dragged item is over, and which side of it, for the insert line. */
  const [dropOn, setDropOn] = useState<{ id: number; below: boolean } | null>(
    null,
  );
  /** Set when the whole day's open items are being carried somewhere. */
  const [carrying, setCarrying] = useState(false);
  const [carryTo, setCarryTo] = useState(() => shiftDay(date, 1));
  const addRef = useRef<HTMLInputElement>(null);

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
    <div className="mt-4 border-t border-border/60 pt-3">
      <div className="flex items-center gap-2">
        <ListTodo className="size-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          To do
        </h3>
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
            draggable={!pending}
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
            className={`group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60 ${
              dropOn?.id === todo.id
                ? dropOn.below
                  ? "border-b-2 border-amber-500"
                  : "border-t-2 border-amber-500"
                : "border-y-2 border-transparent"
            }`}
          >
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
              onClick={() =>
                startWriting(async () => {
                  await updateDayTodoAction({ id: todo.id, done: !todo.done });
                })
              }
              className={`flex size-4 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors ${
                todo.done
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : "border-input hover:border-emerald-500"
              }`}
            >
              {todo.done && <Check className="size-3" />}
            </button>

            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                todo.done ? "text-muted-foreground line-through" : ""
              }`}
              title={todo.text}
            >
              {todo.text}
            </span>

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
                    {/* The two jobs look alike at a glance — up and down are
                        this list, left and right are the calendar. */}
                    <span
                      aria-hidden
                      className="mx-0.5 h-3.5 w-px bg-border"
                    />
                  </>
                )}
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
          Drag an item onto another to reorder it, or onto a day above to move
          it there.
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
    </div>
  );
}
