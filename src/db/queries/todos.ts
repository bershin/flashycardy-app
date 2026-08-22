/**
 * Things to do on a day, as opposed to cards due on it.
 *
 * Same shape as the card queries: pure reads off a snapshot, writes through a
 * single `mutate` so a half-written item is never persisted or synced.
 */

import { allocateTodoId, getSnapshot, mutate } from "@/lib/store/local-store";
import type { DayTodo, DbDoc } from "@/lib/store/types";

/**
 * Open items first, each group in the order it has been put in.
 *
 * What is still to do is the reason the list is being looked at; what is done
 * settles underneath it as a record of the day rather than a demand on it.
 * Within each group the order is the one the list was arranged into, which for
 * a list nobody has rearranged is the order it was written in.
 */
function inReadingOrder(todos: DayTodo[]): DayTodo[] {
  return [...todos].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) || a.position - b.position || a.id - b.id,
  );
}

/** One past the end of a day's list, so a new arrival lands at the bottom. */
function nextPosition(db: DbDoc, date: string, userId: string): number {
  let max = -1;
  for (const todo of db.todos) {
    if (todo.userId === userId && todo.date === date && todo.position > max) {
      max = todo.position;
    }
  }
  return max + 1;
}

export function selectTodosByUser(db: DbDoc, userId: string): DayTodo[] {
  return inReadingOrder(db.todos.filter((t) => t.userId === userId));
}

export function selectTodosForDay(
  db: DbDoc,
  date: string,
  userId: string,
): DayTodo[] {
  return inReadingOrder(
    db.todos.filter((t) => t.date === date && t.userId === userId),
  );
}

/** How many days carry an item, and whether any of them are still open. */
export function selectTodoDays(
  db: DbDoc,
  userId: string,
): Map<string, { total: number; open: number }> {
  const byDay = new Map<string, { total: number; open: number }>();
  for (const todo of db.todos) {
    if (todo.userId !== userId) continue;
    const entry = byDay.get(todo.date) ?? { total: 0, open: 0 };
    entry.total += 1;
    if (!todo.done) entry.open += 1;
    byDay.set(todo.date, entry);
  }
  return byDay;
}

export async function getTodosByUser(userId: string) {
  return selectTodosByUser(getSnapshot(), userId);
}

export async function addTodo(date: string, userId: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  return mutate((draft) => {
    const now = new Date();
    const todo: DayTodo = {
      id: allocateTodoId(draft),
      userId,
      date,
      text: trimmed,
      position: nextPosition(draft, date, userId),
      remindAt: null,
      important: false,
      note: "",
      done: false,
      doneAt: null,
      createdAt: now,
      updatedAt: now,
    };
    draft.todos.push(todo);
    return todo;
  });
}

type TodoPatch = {
  text?: string;
  done?: boolean;
  /** `YYYY-MM-DD` — the day it moves to. */
  date?: string;
  /** `HH:MM`, or null to take the time off. */
  remindAt?: string | null;
  important?: boolean;
  /** The longer version; an empty string takes it off. */
  note?: string;
};

/**
 * Edit, tick off, or move one item.
 *
 * Moving is the same operation as any other edit: the date is a field, so
 * carrying something to tomorrow is a write rather than a delete and a re-add,
 * and the item keeps its id, its text, and whether it was already done.
 */
export async function updateTodo(id: number, userId: string, patch: TodoPatch) {
  return mutate((draft) => {
    const index = draft.todos.findIndex(
      (t) => t.id === id && t.userId === userId,
    );
    if (index === -1) return null;

    const current = draft.todos[index];
    const text = patch.text?.trim();
    // An emptied item is a deleted one: clearing the text is how the box is
    // cleared, and keeping a blank row would leave the day looking occupied.
    if (patch.text !== undefined && !text) {
      draft.todos.splice(index, 1);
      return null;
    }

    const updated: DayTodo = {
      ...current,
      text: text ?? current.text,
      done: patch.done ?? current.done,
      date: patch.date ?? current.date,
      // Undefined leaves the time alone; null is how it is taken off.
      remindAt:
        patch.remindAt === undefined ? current.remindAt : patch.remindAt,
      important: patch.important ?? current.important,
      note: patch.note === undefined ? current.note : patch.note.trim(),
      updatedAt: new Date(),
    };
    // Something arriving from another day joins the end of the list it lands
    // in: its old position was only ever meaningful beside its old neighbours.
    if (patch.date !== undefined && patch.date !== current.date) {
      updated.position = nextPosition(draft, patch.date, userId);
    }
    // Stamped only when it changes state, so re-editing the text of something
    // already done doesn't rewrite when it was finished.
    if (patch.done !== undefined && patch.done !== current.done) {
      updated.doneAt = patch.done ? new Date() : null;
    }
    draft.todos[index] = updated;
    return updated;
  });
}

/**
 * Copy an item, directly under the one it came from.
 *
 * For the thing that needs doing again — the same words, the same time, the
 * same weight — without typing it twice. The copy starts open however the
 * original ended up: a finished thing copied is a thing to do again, which is
 * the only reason to copy a finished one.
 */
export async function duplicateTodo(id: number, userId: string) {
  return mutate((draft) => {
    const source = draft.todos.find((t) => t.id === id && t.userId === userId);
    if (!source) return null;

    const now = new Date();
    const clone: DayTodo = {
      ...source,
      id: allocateTodoId(draft),
      done: false,
      doneAt: null,
      createdAt: now,
      updatedAt: now,
    };
    draft.todos.push(clone);

    // Renumber the day so the copy sits directly under its original rather
    // than at the end, where the pair would be separated by everything else.
    const ordered = inReadingOrder(
      draft.todos.filter((t) => t.userId === userId && t.date === source.date),
    ).filter((t) => t.id !== clone.id);
    ordered.splice(ordered.findIndex((t) => t.id === source.id) + 1, 0, clone);
    const places = new Map(ordered.map((t, index) => [t.id, index]));
    draft.todos = draft.todos.map((t) =>
      places.has(t.id) ? { ...t, position: places.get(t.id)! } : t,
    );

    return clone.id;
  });
}

export async function deleteTodo(id: number, userId: string) {
  return mutate((draft) => {
    const index = draft.todos.findIndex(
      (t) => t.id === id && t.userId === userId,
    );
    if (index === -1) return null;
    const [removed] = draft.todos.splice(index, 1);
    return removed;
  });
}

/**
 * Carry every open item on a day to another one.
 *
 * The reason a day's list survives the day: nothing done on Tuesday moves to
 * Wednesday in one go, and what was finished stays where it happened.
 */
export async function moveOpenTodos(
  from: string,
  to: string,
  userId: string,
): Promise<number> {
  const moved = await mutate((draft) => {
    const now = new Date();
    const next = nextPosition(draft, to, userId);
    let count = 0;
    // Sorted first so they keep their order relative to each other as they land
    // at the end of the day they are carried to.
    const carried = new Set(
      inReadingOrder(
        draft.todos.filter(
          (t) => t.userId === userId && t.date === from && !t.done,
        ),
      ).map((t) => t.id),
    );
    const order = [...carried];
    draft.todos = draft.todos.map((t) => {
      if (!carried.has(t.id)) return t;
      count += 1;
      return {
        ...t,
        date: to,
        position: next + order.indexOf(t.id),
        updatedAt: now,
      };
    });
    return count;
  });
  return moved ?? 0;
}

/**
 * Put a day's list in the given order.
 *
 * Takes the whole day rather than a pair to swap: the list is short, the write
 * is one document mutation either way, and a full ordering can't leave two
 * items claiming the same place. Ids that aren't on the day are ignored, and
 * anything on the day that isn't named keeps its place at the end.
 */
export async function reorderTodos(
  date: string,
  userId: string,
  orderedIds: number[],
): Promise<number> {
  const reordered = await mutate((draft) => {
    const onDay = new Set(
      draft.todos
        .filter((t) => t.userId === userId && t.date === date)
        .map((t) => t.id),
    );
    const named = orderedIds.filter((id) => onDay.has(id));
    if (named.length === 0) return 0;

    const now = new Date();
    draft.todos = draft.todos.map((t) => {
      const index = named.indexOf(t.id);
      if (index === -1) return t;
      return { ...t, position: index, updatedAt: now };
    });
    // Anything on the day the caller didn't name — added by another tab
    // mid-drag — goes after the arrangement rather than fighting it for a slot.
    let tail = named.length;
    draft.todos = draft.todos.map((t) =>
      onDay.has(t.id) && !named.includes(t.id)
        ? { ...t, position: tail++ }
        : t,
    );
    return named.length;
  });
  return reordered ?? 0;
}
