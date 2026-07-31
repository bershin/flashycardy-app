"use client";

/**
 * Study-session mutations. Formerly Server Actions; see
 * `src/app/dashboard/actions.ts` for why they now run in the browser.
 */

import { z } from "zod";
import { auth } from "@/lib/auth";
import { recordStudyResult } from "@/db/queries/cards";
import { markDeckStudied } from "@/db/queries/decks";

const rateCardSchema = z.object({
  cardId: z.number(),
  deckId: z.number(),
  rating: z.enum(["got_it", "missed"]),
});

type RateCardInput = z.infer<typeof rateCardSchema>;

export async function rateCardAction(data: RateCardInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = rateCardSchema.parse(data);
  return recordStudyResult(parsed.cardId, userId, parsed.rating);
}

export async function markDeckStudiedAction(deckId: number) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  await markDeckStudied(deckId, userId);
}
