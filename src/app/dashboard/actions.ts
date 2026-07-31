"use client";

/**
 * Deck mutations.
 *
 * These were Server Actions. They are now ordinary async functions running in
 * the browser — the app is a static export, so there is no server to run them
 * on. Their names, arguments and validation are unchanged, which is why the
 * components calling them did not need to be touched.
 *
 * There are no `revalidatePath` calls any more: the store notifies its
 * subscribers on every mutation, so mounted pages re-render on their own.
 */

import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  insertDeck,
  updateDeck,
  deleteDeck,
  getDeckByIdForUser,
  moveDeck,
  reorderDecks,
} from "@/db/queries/decks";
import { getCardsByDeckForUser } from "@/db/queries/cards";

const createDeckSchema = z.object({
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().max(1000).nullish(),
  parentId: z.number().nullish(),
});

type CreateDeckInput = z.infer<typeof createDeckSchema>;

export async function createDeckAction(data: CreateDeckInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = createDeckSchema.parse(data);

  if (parsed.parentId) {
    const parent = await getDeckByIdForUser(parsed.parentId, userId);
    if (!parent) throw new Error("Parent deck not found");
    if (parent.parentId !== null) {
      throw new Error("Cannot nest more than one level deep.");
    }
    const parentCards = await getCardsByDeckForUser(parsed.parentId, userId);
    if (parentCards.length > 0) {
      throw new Error("Cannot add sub-decks to a deck that already has cards.");
    }
  }

  return insertDeck({
    title: parsed.title,
    description: parsed.description ?? undefined,
    parentId: parsed.parentId ?? undefined,
    userId,
  });
}

const updateDeckSchema = z.object({
  deckId: z.number(),
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().max(1000).nullish(),
});

type UpdateDeckInput = z.infer<typeof updateDeckSchema>;

export async function updateDeckAction(data: UpdateDeckInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = updateDeckSchema.parse(data);

  const deck = await updateDeck(parsed.deckId, userId, {
    title: parsed.title,
    description: parsed.description ?? undefined,
  });

  if (!deck) throw new Error("Deck not found");
  return deck;
}

const deleteDeckSchema = z.object({
  deckId: z.number(),
});

type DeleteDeckInput = z.infer<typeof deleteDeckSchema>;

export async function deleteDeckAction(data: DeleteDeckInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = deleteDeckSchema.parse(data);

  const deck = await deleteDeck(parsed.deckId, userId);

  if (!deck) throw new Error("Deck not found");
  return deck;
}

const moveDeckSchema = z.object({
  deckId: z.number(),
  /** `null` moves the deck back out to the top level. */
  targetParentId: z.number().nullable(),
});

type MoveDeckInput = z.infer<typeof moveDeckSchema>;

export async function moveDeckAction(data: MoveDeckInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = moveDeckSchema.parse(data);

  const moved = await moveDeck(parsed.deckId, userId, parsed.targetParentId);
  if (!moved) throw new Error("That deck can't be moved there.");
  return moved;
}

const reorderDecksSchema = z.object({
  orderedIds: z.array(z.number()).min(1),
  parentId: z.number().nullish(),
});

type ReorderDecksInput = z.infer<typeof reorderDecksSchema>;

export async function reorderDecksAction(data: ReorderDecksInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = reorderDecksSchema.parse(data);
  await reorderDecks(userId, parsed.orderedIds);
}
