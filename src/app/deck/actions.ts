"use client";

/**
 * Card mutations. Formerly Server Actions; see `src/app/dashboard/actions.ts`
 * for why they now run in the browser.
 */

import { z } from "zod";
import { auth } from "@/lib/auth";
import { getOpenAIKey, getOpenAIModel } from "@/lib/settings";
import { getDeckByIdForUser } from "@/db/queries/decks";
import {
  insertCard,
  getCardByIdForUser,
  updateCard,
  deleteCard,
  moveCard,
  bulkInsertCards,
} from "@/db/queries/cards";

const addCardSchema = z.object({
  deckId: z.number(),
  front: z.string().min(1, "Front is required").max(500_000),
  back: z.string().min(1, "Back is required").max(500_000),
});

type AddCardInput = z.infer<typeof addCardSchema>;

export async function addCardAction(data: AddCardInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = addCardSchema.parse(data);

  const deck = await getDeckByIdForUser(parsed.deckId, userId);
  if (!deck) throw new Error("Deck not found");

  return insertCard({
    deckId: parsed.deckId,
    front: parsed.front,
    back: parsed.back,
  });
}

const updateCardSchema = z.object({
  cardId: z.number(),
  front: z.string().min(1, "Front is required").max(500_000),
  back: z.string().min(1, "Back is required").max(500_000),
});

type UpdateCardInput = z.infer<typeof updateCardSchema>;

export async function updateCardAction(data: UpdateCardInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = updateCardSchema.parse(data);

  const existingCard = await getCardByIdForUser(parsed.cardId, userId);
  if (!existingCard) throw new Error("Card not found");

  return updateCard(parsed.cardId, userId, {
    front: parsed.front,
    back: parsed.back,
  });
}

const deleteCardSchema = z.object({
  cardId: z.number(),
});

type DeleteCardInput = z.infer<typeof deleteCardSchema>;

export async function deleteCardAction(data: DeleteCardInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = deleteCardSchema.parse(data);

  const existingCard = await getCardByIdForUser(parsed.cardId, userId);
  if (!existingCard) throw new Error("Card not found");

  await deleteCard(parsed.cardId, userId);
}

const cloneCardSchema = z.object({
  cardId: z.number(),
});

type CloneCardInput = z.infer<typeof cloneCardSchema>;

export async function cloneCardAction(data: CloneCardInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = cloneCardSchema.parse(data);

  const existingCard = await getCardByIdForUser(parsed.cardId, userId);
  if (!existingCard) throw new Error("Card not found");

  return insertCard({
    deckId: existingCard.deckId,
    front: existingCard.front,
    back: existingCard.back,
  });
}

const moveCardSchema = z.object({
  cardId: z.number(),
  targetDeckId: z.number(),
});

type MoveCardInput = z.infer<typeof moveCardSchema>;

export async function moveCardAction(data: MoveCardInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = moveCardSchema.parse(data);

  const existingCard = await getCardByIdForUser(parsed.cardId, userId);
  if (!existingCard) throw new Error("Card not found");

  const moved = await moveCard(parsed.cardId, userId, parsed.targetDeckId);
  if (!moved) throw new Error("That deck can't hold cards.");
  return moved;
}

const AI_CARD_COUNT = 20;

const aiResponseSchema = z.object({
  cards: z
    .array(z.object({ front: z.string(), back: z.string() }))
    .min(1)
    .max(AI_CARD_COUNT),
});

/**
 * Generate cards from the deck's title and description.
 *
 * This used to run server-side through the Vercel AI SDK against a shared
 * OpenAI key, gated behind a Pro plan. It now calls OpenAI directly from the
 * browser with a key the user supplies in Settings, so the feature costs
 * nothing unless it is used. Calling from the browser is acceptable precisely
 * because the key belongs to the person typing it in — it is never transmitted
 * anywhere except OpenAI.
 */
export async function generateCardsWithAIAction(deckId: number) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const apiKey = getOpenAIKey();
  if (!apiKey) {
    throw new Error("Add an OpenAI API key in Settings to generate cards.");
  }

  const deck = await getDeckByIdForUser(deckId, userId);
  if (!deck) throw new Error("Deck not found");

  const topic = deck.description
    ? `${deck.title} — ${deck.description}`
    : deck.title;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getOpenAIModel(),
      messages: [
        {
          role: "user",
          content: `Generate ${AI_CARD_COUNT} flashcards about the following topic: ${topic}. Each card should have a concise question or term on the front and a clear, informative answer on the back.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "flashcards",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["cards"],
            properties: {
              cards: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["front", "back"],
                  properties: {
                    front: { type: "string" },
                    back: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message ? `: ${body.error.message}` : "";
    } catch {
      /* non-JSON error body */
    }
    if (response.status === 401) {
      throw new Error(`OpenAI rejected the API key${detail}`);
    }
    throw new Error(`OpenAI returned ${response.status}${detail}`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI failed to generate cards. Please try again.");
  }

  const parsed = aiResponseSchema.safeParse(JSON.parse(content));
  if (!parsed.success || parsed.data.cards.length === 0) {
    throw new Error("AI returned cards in an unexpected shape. Please retry.");
  }

  await bulkInsertCards(
    parsed.data.cards.map((c) => ({ deckId, front: c.front, back: c.back })),
  );
}
