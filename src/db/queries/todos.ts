/**
 * Things to do on a day, as opposed to cards due on it.
 *
 * Same shape as the card queries: pure reads off a snapshot, writes through a
 * single `mutate` so a half-written item is never persisted or synced.
 */

import { allocateTodoId, getSnapshot, mutate } from "@/lib/store/local-store";
import type { DayTodo, DbDoc } from "@/lib/store/types";

/**
 * Open items first, each group oldest first.
 *
 * What is still to do is the reason the list is being looked at; what is done
 * settles underneath it as a record of the day rather than a demand on it.
 */
function inReadingOrder(todos: DayTodo[]): DayTodo[] {
  return [...todos].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id - b.id,
  );
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
      updatedAt: new Date(),
    };
    // Stamped only when it changes state, so re-editing the text of something
    // already done doesn't rewrite when it was finished.
    if (patch.done !== undefined && patch.done !== current.done) {
      updated.doneAt = patch.done ? new Date() : null;
    }
    draft.todos[index] = updated;
    return updated;
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
    let count = 0;
    draft.todos = draft.todos.map((t) => {
      if (t.userId !== userId || t.date !== from || t.done) return t;
      count += 1;
      return { ...t, date: to, updatedAt: now };
    });
    return count;
  });
  return moved ?? 0;
}
