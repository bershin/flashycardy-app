"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import {
  CalendarArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
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
import { startTodoDrag } from "./todo-drag";
import {
  addDayTodoAction,
  deleteDayTodoAction,
  moveOpenTodosAction,
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
        {todos.map((todo) => (
          <li
            key={todo.id}
            // Dropped on a square in the grid above, which is the fastest way
            // to say "not today, Thursday". The buttons on the row do the same
            // job for touch and for the keyboard.
            draggable={!pending}
            onDragStart={(e) => startTodoDrag(e, todo.id)}
            className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60"
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
          Drag an item onto a day above to move it there.
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
