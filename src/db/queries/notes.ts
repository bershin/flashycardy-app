/**
 * Notes written against a day.
 *
 * Same shape as the card queries: pure reads off a snapshot, writes through a
 * single `mutate` so a half-written note is never persisted or synced.
 */

import { allocateNoteId, getSnapshot, mutate } from "@/lib/store/local-store";
import type { DayNote, DbDoc } from "@/lib/store/types";

export function selectNotesByUser(db: DbDoc, userId: string): DayNote[] {
  return db.notes.filter((n) => n.userId === userId);
}

export function selectNoteForDay(
  db: DbDoc,
  date: string,
  userId: string,
): DayNote | undefined {
  return db.notes.find((n) => n.date === date && n.userId === userId);
}

export async function getNotesByUser(userId: string) {
  return selectNotesByUser(getSnapshot(), userId);
}

/**
 * One note per day, replaced rather than appended.
 *
 * A day holds a single thought about itself — "mock exam", "away until
 * Thursday" — and a list of them would need managing. Writing an empty note
 * removes it, so clearing the box is how a note is deleted.
 */
export async function saveNoteForDay(
  date: string,
  userId: string,
  text: string,
) {
  return mutate((draft) => {
    const trimmed = text.trim();
    const index = draft.notes.findIndex(
      (n) => n.date === date && n.userId === userId,
    );
    const now = new Date();

    if (!trimmed) {
      if (index !== -1) draft.notes.splice(index, 1);
      return null;
    }

    if (index === -1) {
      const note: DayNote = {
        id: allocateNoteId(draft),
        userId,
        date,
        text: trimmed,
        createdAt: now,
        updatedAt: now,
      };
      draft.notes.push(note);
      return note;
    }

    const updated: DayNote = {
      ...draft.notes[index],
      text: trimmed,
      updatedAt: now,
    };
    draft.notes[index] = updated;
    return updated;
  });
}
