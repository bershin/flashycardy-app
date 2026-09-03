"use client";

/**
 * Note mutations. In the browser, like the card and calendar actions — see
 * `src/app/dashboard/actions.ts` for why.
 */

import { z } from "zod";
import { auth } from "@/lib/auth";
import { addMemo, deleteMemo, updateMemo } from "@/db/queries/memos";

/**
 * Generous, and capped rather than trimmed.
 *
 * A note is somewhere to put a paragraph of something, so the body has room to
 * be one; the ceiling exists because every note rides in the same JSON file
 * that syncs to GitHub, and one runaway paste should not make that file
 * unpushable.
 */
const titleSchema = z.string().max(200);
const bodySchema = z.string().max(50_000);

const addSchema = z.object({
  title: titleSchema.optional(),
  body: bodySchema.optional(),
});
const updateSchema = z.object({
  id: z.number().int().positive(),
  title: titleSchema.optional(),
  body: bodySchema.optional(),
  pinned: z.boolean().optional(),
});
const idSchema = z.object({ id: z.number().int().positive() });

export async function addNoteAction(data: z.infer<typeof addSchema> = {}) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = addSchema.parse(data);
  return addMemo(userId, parsed.title ?? "", parsed.body ?? "");
}

/** Edits the words, or pins it to the top of the list. */
export async function updateNoteAction(data: z.infer<typeof updateSchema>) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const { id, ...patch } = updateSchema.parse(data);
  return updateMemo(id, userId, patch);
}

export async function deleteNoteAction(data: z.infer<typeof idSchema>) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const { id } = idSchema.parse(data);
  return deleteMemo(id, userId);
}
