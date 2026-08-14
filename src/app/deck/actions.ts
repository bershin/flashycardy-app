"use client";

/**
 * Card mutations. Formerly Server Actions; see `src/app/dashboard/actions.ts`
 * for why they now run in the browser.
 */

import { z } from "zod";
import { auth } from "@/lib/auth";
import { getOpenAIKey, getOpenAIModel } from "@/lib/settings";
import { getDeckByIdForUser } from "@/db/queries/decks";
import { NEW_CARD_SCHEDULE } from "@/lib/store/types";
import {
  insertCard,
  getCardByIdForUser,
  updateCard,
  deleteCard,
  moveCards,
  rescheduleCards,
  restoreCardDates,
  bulkInsertCards,
} from "@/db/queries/cards";

/**
 * Ceiling on one side of a card, in characters of HTML.
 *
 * Images live inline as base64, so this is really an image budget. It was
 * 500,000, which a single pasted screenshot could exceed on its own — the save
 * then failed with nothing to explain why. The editor now targets 400,000 per
 * image, so this leaves room for several on one side while still keeping
 * `data.json` a sane size to sync.
 */
const MAX_FIELD = 2_000_000;
const TOO_LARGE =
  "This side of the card is too large. Try fewer or smaller images.";

const cardTypeSchema = z.enum(["basic", "quiz"]);
const scheduleSchema = z.enum(["incremental", "weekly"]);

const quizSchema = z.object({
  options: z.array(z.string().min(1).max(500)).min(2).max(6),
  correctIndex: z.number().int().min(0),
});

/**
 * `back` is required for a basic card, where it is the answer, but optional for
 * a quiz card, where it is just an explanation shown after answering.
 */
const cardContentSchema = z
  .object({
    front: z.string().min(1, "Front is required").max(MAX_FIELD, TOO_LARGE),
    back: z.string().max(MAX_FIELD, TOO_LARGE),
    type: cardTypeSchema.default("basic"),
    schedule: scheduleSchema.default(NEW_CARD_SCHEDULE),
    quiz: quizSchema.optional(),
  })
  .refine((v) => v.type !== "basic" || v.back.trim().length > 0, {
    message: "Back is required",
    path: ["back"],
  })
  .refine((v) => v.type !== "quiz" || v.quiz !== undefined, {
    message: "Quiz cards need options",
    path: ["quiz"],
  })
  .refine((v) => !v.quiz || v.quiz.correctIndex < v.quiz.options.length, {
    message: "The correct answer must be one of the options",
    path: ["quiz"],
  });

const addCardSchema = z.intersection(
  z.object({ deckId: z.number() }),
  cardContentSchema,
);

type AddCardInput = z.infer<typeof addCardSchema>;

export async function addCardAction(data: AddCardInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = addCardSchema.parse(data);

  const deck = await getDeckByIdForUser(parsed.deckId, userId);
  if (!deck) throw new Error("Deck not found");

  return insertCard({
    deckId: parsed.deckId,
    type: parsed.type,
    front: parsed.front,
    back: parsed.back,
    schedule: parsed.schedule,
    quiz: parsed.quiz,
  });
}

const updateCardSchema = z.intersection(
  z.object({ cardId: z.number() }),
  cardContentSchema,
);

type UpdateCardInput = z.infer<typeof updateCardSchema>;

export async function updateCardAction(data: UpdateCardInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = updateCardSchema.parse(data);

  const existingCard = await getCardByIdForUser(parsed.cardId, userId);
  if (!existingCard) throw new Error("Card not found");

  return updateCard(parsed.cardId, userId, {
    type: parsed.type,
    front: parsed.front,
    back: parsed.back,
    schedule: parsed.schedule,
    quiz: parsed.quiz,
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

  // Carry the type and its payload across: a cloned quiz card that came back
  // as a basic one with no options would look like the clone had failed.
  return insertCard({
    deckId: existingCard.deckId,
    type: existingCard.type,
    front: existingCard.front,
    back: existingCard.back,
    schedule: existingCard.schedule,
    quiz: existingCard.quiz,
  });
}

const moveCardsSchema = z.object({
  cardIds: z.array(z.number()).min(1),
  targetDeckId: z.number(),
});

type MoveCardsInput = z.infer<typeof moveCardsSchema>;

export async function moveCardsAction(data: MoveCardsInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = moveCardsSchema.parse(data);

  const moved = await moveCards(parsed.cardIds, userId, parsed.targetDeckId);
  if (moved.length === 0) throw new Error("That deck can't hold cards.");
  return moved;
}

const rescheduleCardsSchema = z.object({
  cardIds: z.array(z.number()).min(1),
  /** `YYYY-MM-DD`, read as a local day rather than a UTC instant. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type RescheduleCardsInput = z.infer<typeof rescheduleCardsSchema>;

/**
 * Push a batch of cards onto a different review day.
 *
 * The date arrives as `YYYY-MM-DD` and is built with the local-time `Date`
 * constructor: `new Date("2026-08-21")` parses as midnight UTC, which lands on
 * the 20th for anyone behind it, silently moving cards to the wrong day.
 */
export async function rescheduleCardsAction(data: RescheduleCardsInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = rescheduleCardsSchema.parse(data);
  const [year, month, day] = parsed.date.split("-").map(Number);
  const target = new Date(year, month - 1, day);

  const moved = await rescheduleCards(parsed.cardIds, userId, target);
  if (moved.length === 0) throw new Error("Those cards couldn't be moved.");

  // Serialised for the caller to hold onto: the undo payload crosses back
  // through this boundary later, and dates travel as ISO strings everywhere
  // else in this layer.
  return moved.map((m) => ({
    cardId: m.cardId,
    previousReviewAt: m.previousReviewAt.toISOString(),
  }));
}

const undoRescheduleSchema = z.object({
  entries: z
    .array(
      z.object({
        cardId: z.number(),
        previousReviewAt: z.string().datetime(),
      }),
    )
    .min(1),
  /**
   * The day the move put the cards on, `YYYY-MM-DD`. Cards that have since
   * been studied onto a different day are left alone.
   */
  stillOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type UndoRescheduleInput = z.infer<typeof undoRescheduleSchema>;

/**
 * Put the cards from the last move back on the dates they came off.
 *
 * Returns how many were restored against how many were asked for, so a stale
 * undo can say what it managed rather than claiming a clean reversal.
 */
export async function undoRescheduleAction(data: UndoRescheduleInput) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = undoRescheduleSchema.parse(data);
  const [year, month, day] = parsed.stillOn.split("-").map(Number);

  const restored = await restoreCardDates(
    parsed.entries.map((e) => ({
      cardId: e.cardId,
      previousReviewAt: new Date(e.previousReviewAt),
    })),
    userId,
    new Date(year, month - 1, day),
  );

  return { restored: restored.length, requested: parsed.entries.length };
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

/**
 * Read the words out of a picture of words.
 *
 * For the images that are only text — a screenshot of a question, a photograph
 * of a page — where the picture is carrying prose that the card could hold
 * directly and be searchable, editable and a great deal smaller for it.
 *
 * Deliberately transcription and nothing more: no summarising, no answering,
 * no describing. A diagram put through this comes back as whatever text is
 * printed on it, which is the honest answer — an NVR shape sequence has no
 * text, and the model is told to say so rather than narrate the picture.
 *
 * Runs in the browser against the user's own key, like the card generator; see
 * the note there for why that is acceptable.
 */
export async function transcribeImageAction(dataUrl: string) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  if (!dataUrl.startsWith("data:image/")) {
    throw new Error("That doesn't look like an image.");
  }

  const apiKey = getOpenAIKey();
  if (!apiKey) {
    throw new Error("Add an OpenAI API key in Settings to read images.");
  }

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
          role: "system",
          content:
            "You transcribe images for a flashcard app. Return exactly the text " +
            "that appears in the image, preserving line breaks, lists and " +
            "numbering. Do not summarise, translate, answer questions, or " +
            "describe anything that is not written text. If the image contains " +
            "no readable text, reply with exactly: NO_TEXT",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this image." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
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
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("No reply from OpenAI. Please try again.");
  // The sentinel is the model reporting a picture with nothing to read, which
  // is a real answer rather than a failure — the caller says so and leaves the
  // image alone.
  if (text === "NO_TEXT") return null;
  return text;
}
