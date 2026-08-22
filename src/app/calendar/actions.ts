"use client";

/**
 * Calendar mutations. In the browser, like the card actions — see
 * `src/app/dashboard/actions.ts` for why.
 */

import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  addTodo,
  deleteTodo,
  moveOpenTodos,
  reorderTodos,
  updateTodo,
} from "@/db/queries/todos";

/** `YYYY-MM-DD`, the day as the writer sees it. */
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const textSchema = z.string().trim().min(1).max(500);

const addSchema = z.object({ date: daySchema, text: textSchema });
/** 24-hour wall clock, as an `<input type="time">` reports it. */
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const updateSchema = z.object({
  id: z.number().int().positive(),
  text: textSchema.optional(),
  done: z.boolean().optional(),
  date: daySchema.optional(),
  remindAt: timeSchema.nullable().optional(),
});
const idSchema = z.object({ id: z.number().int().positive() });
const moveDaySchema = z.object({ from: daySchema, to: daySchema });
const reorderSchema = z.object({
  date: daySchema,
  ids: z.array(z.number().int().positive()).max(200),
});

export async function addDayTodoAction(data: z.infer<typeof addSchema>) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = addSchema.parse(data);
  return addTodo(parsed.date, userId, parsed.text);
}

/** Edits the text, ticks it off, or moves it to another day. */
export async function updateDayTodoAction(data: z.infer<typeof updateSchema>) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const { id, ...patch } = updateSchema.parse(data);
  return updateTodo(id, userId, patch);
}

export async function deleteDayTodoAction(data: z.infer<typeof idSchema>) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  return deleteTodo(idSchema.parse(data).id, userId);
}

/** Puts one day's list in the given order. */
export async function reorderDayTodosAction(
  data: z.infer<typeof reorderSchema>,
) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = reorderSchema.parse(data);
  return reorderTodos(parsed.date, userId, parsed.ids);
}

/** Carries everything still open on one day over to another. */
export async function moveOpenTodosAction(
  data: z.infer<typeof moveDaySchema>,
) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = moveDaySchema.parse(data);
  return moveOpenTodos(parsed.from, parsed.to, userId);
}
