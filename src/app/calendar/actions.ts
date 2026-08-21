"use client";

/**
 * Calendar mutations. In the browser, like the card actions — see
 * `src/app/dashboard/actions.ts` for why.
 */

import { z } from "zod";
import { auth } from "@/lib/auth";
import { saveNoteForDay } from "@/db/queries/notes";

const noteSchema = z.object({
  /** `YYYY-MM-DD`, the day as the writer sees it. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  text: z.string().max(500),
});

type NoteInput = z.infer<typeof noteSchema>;

/** Writes the day's note, or removes it when the text is emptied. */
export async function saveDayNoteAction(data: NoteInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = noteSchema.parse(data);
  return saveNoteForDay(parsed.date, userId, parsed.text);
}
