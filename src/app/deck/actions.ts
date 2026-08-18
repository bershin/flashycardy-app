"use client";

/**
 * Card mutations. Formerly Server Actions; see `src/app/dashboard/actions.ts`
 * for why they now run in the browser.
 */

import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAIConfig } from "@/lib/settings";
import {
  checkAgainstOriginal,
  describeFailure,
  diagnoseGenerated,
  validateGenerated,
} from "@/lib/generated-card";
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

const cardTypeSchema = z.enum(["basic", "quiz", "generated"]);

/**
 * A card that rolls its own numbers.
 *
 * Ranges and formulas only — the expressions are read by the parser in
 * `generated-card.ts`, never by the JavaScript engine, so what arrives here is
 * arithmetic or it is nothing.
 */
const generatedSchema = z.object({
  template: z.string().min(1).max(2000),
  variables: z
    .array(
      z.object({
        name: z.string().regex(/^\w+$/),
        min: z.number(),
        max: z.number(),
        step: z.number().positive().optional(),
      }),
    )
    .min(1)
    .max(6),
  constraint: z.string().max(400).optional(),
  answer: z.string().min(1).max(400),
  distractors: z.array(z.string().min(1).max(400)).min(2).max(6),
  explanation: z.string().max(2000).optional(),
  unit: z.string().max(40).optional(),
  check: z
    .object({
      values: z.record(z.string(), z.number()),
      answer: z.number(),
    })
    .optional(),
});
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
    generated: generatedSchema.optional(),
  })
  .refine((v) => v.type !== "basic" || v.back.trim().length > 0, {
    message: "Back is required",
    path: ["back"],
  })
  .refine((v) => v.type !== "quiz" || v.quiz !== undefined, {
    message: "Quiz cards need options",
    path: ["quiz"],
  })
  .refine((v) => v.type !== "generated" || v.generated !== undefined, {
    message: "A generated card needs a template",
    path: ["generated"],
  })
  // Checked here rather than only in the editor: a template that cannot
  // produce a question is a card that cannot be studied, and it should never
  // reach the document.
  .refine(
    (v) =>
      v.type !== "generated" ||
      !v.generated ||
      validateGenerated(v.generated) === null,
    { message: "This template can't produce a question", path: ["generated"] },
  )
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
    generated: parsed.generated,
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
    generated: parsed.generated,
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

  const ai = getAIConfig();
  if (!ai) {
    throw new Error("Add an API key in Settings to generate cards.");
  }

  const deck = await getDeckByIdForUser(deckId, userId);
  if (!deck) throw new Error("Deck not found");

  const topic = deck.description
    ? `${deck.title} — ${deck.description}`
    : deck.title;

  const response = await fetch(`${ai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ai.key}`,
    },
    body: JSON.stringify({
      model: ai.model,
      messages: [
        {
          role: "user",
          content: `Generate ${AI_CARD_COUNT} flashcards about the following topic: ${topic}. Each card should have a concise question or term on the front and a clear, informative answer on the back.${ai.strictJsonSchema ? "" : ' Reply with JSON of the form {"cards":[{"front":"…","back":"…"}]} and nothing else.'}`,
        },
      ],
      // A strict schema where the provider honours one, plain JSON where it
      // does not. The reply is validated against the same zod schema either
      // way, so the difference is how early a bad shape is caught, not
      // whether it is.
      response_format: ai.strictJsonSchema
        ? {
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
          }
        : { type: "json_object" },
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
      throw new Error(`${ai.label} rejected the API key${detail}`);
    }
    throw new Error(`${ai.label} returned ${response.status}${detail}`);
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

  const ai = getAIConfig();
  if (!ai) {
    throw new Error("Add an API key in Settings to read images.");
  }

  const response = await fetch(`${ai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ai.key}`,
    },
    body: JSON.stringify({
      model: ai.model,
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
      throw new Error(`${ai.label} rejected the API key${detail}`);
    }
    throw new Error(`${ai.label} returned ${response.status}${detail}`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`No reply from ${ai.label}. Please try again.`);
  // The sentinel is the model reporting a picture with nothing to read, which
  // is a real answer rather than a failure — the caller says so and leaves the
  // image alone.
  if (text === "NO_TEXT") return null;
  return text;
}


/**
 * Ask the model to turn a fixed question into the shape of one.
 *
 * The card is sent as it stands — its text and any scan of it — and what comes
 * back is a template: the sentence with its numbers pulled out, ranges for
 * them, a formula for the answer, and formulas for the wrong options. Nothing
 * is saved here. The proposal is shown with sample rolls first, because a
 * template that is subtly wrong produces plausible questions with wrong answers
 * forever, which is worse than no template at all.
 */
export async function proposeGeneratedCardAction(cardId: number) {
  const { userId } = auth();
  if (!userId) throw new Error("Unauthorized");

  const ai = getAIConfig();
  if (!ai) throw new Error("Add an API key in Settings to build a template.");

  const card = await getCardByIdForUser(cardId, userId);
  if (!card) throw new Error("Card not found");

  const text = `${card.front}\n\n${card.back}`
    .replace(/<img[^>]*>/g, " [image] ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const images = [...`${card.front}${card.back}`.matchAll(
    /<img[^>]+src="(data:image\/[a-z]+;base64,[^"]+)"/g,
  )].map((m) => m[1]);

  const instructions = [
    "You turn a single maths question into a template that generates endless",
    "variants of it. Reply with JSON only, of this shape:",
    '{"template":"sentence with {name} placeholders","variables":[{"name":"m","min":3,"max":12}],',
    '"constraint":"expression that must be true","answer":"expression","distractors":["expression","expression","expression"],',
    '"explanation":"worked answer using the same {name} placeholders","unit":"days",',
    '"check":{"values":{"m":9,"d":12,"n":4},"answer":27}}',
    "",
    "`check` is the card exactly as it was written: the original numbers as",
    "values, and the answer the card itself gives. It is how the template is",
    "verified — your formula, fed those numbers, must produce that answer — so",
    "take both straight from the card and do not invent them.",
    "",
    "Rules:",
    "- Expressions may use the variable names, numbers, + - * / % **, brackets,",
    "  a ? b : c, and the functions floor, ceil, round, abs, sqrt, min, max, gcd.",
    "  Nothing else.",
    "- Every expression must work out to a single number. A card whose answer is",
    "  a ratio like 3:4, a fraction in its lowest terms, an algebraic expression",
    "  or a word cannot be templated — say so by replying",
    '  {"unsuitable":"why"} instead of a template.',
    "- The constraint must guarantee a whole-number answer for every allowed",
    "  combination, e.g. (m*d) % n == 0.",
    "- Each distractor must be a mistake a student would actually make — an",
    "  inverted ratio, a forgotten division, an off-by-one — never a random number.",
    "- Keep the sentence's wording and units as they are; only the numbers vary.",
    "- Ranges should keep the arithmetic doable in the head or on paper.",
    "- Constraints should not be so tight that few combinations fit.",
    "- In the explanation, every value must be written as a {name} placeholder.",
    "  Never write a bare variable name or a formula there: the explanation is",
    "  read by a student as a sentence, so '{l} x {w} x {h}' is right and",
    "  '(l * w * h)' is not.",
  ].join("\n");

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: instructions },
    {
      role: "user",
      content: [
        { type: "text", text: `Here is the card:\n\n${text}` },
        ...images.slice(0, 2).map((url) => ({
          type: "image_url" as const,
          image_url: { url },
        })),
      ],
    },
  ];

  /**
   * Two attempts, the second told what was wrong with the first.
   *
   * The usual failure is a constraint so tight that nothing satisfies it —
   * which the model cannot see, because it never runs what it writes. Handing
   * back the diagnosis fixes it far more often than asking again blind, and
   * costs one more call on the cards that need it.
   */
  let shape: ReturnType<typeof generatedSchema.safeParse> | null = null;
  let lastComplaint = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ai.key}`,
      },
      body: JSON.stringify({
        model: ai.model,
        messages,
        response_format: { type: "json_object" },
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
      throw new Error(`${ai.label} returned ${response.status}${detail}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error(`No reply from ${ai.label}. Please try again.`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(content.replace(/^```json\s*|```$/g, "").trim());
    } catch {
      lastComplaint = "that wasn't JSON";
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: "That was not valid JSON. Reply with the JSON object only.",
      });
      continue;
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      "unsuitable" in parsed &&
      typeof (parsed as { unsuitable: unknown }).unsuitable === "string"
    ) {
      throw new Error(
        `This card isn't one where only the numbers change: ${(parsed as { unsuitable: string }).unsuitable}`,
      );
    }

    const candidate = generatedSchema.safeParse(parsed);
    if (!candidate.success) {
      lastComplaint = "the fields were not the ones asked for";
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content:
          "That JSON did not have the required fields. Reply again with exactly the shape described.",
      });
      continue;
    }

    // Rolled here, not just parsed: a template can be well-formed and still
    // incapable of producing a single question.
    const failure = diagnoseGenerated(candidate.data);
    if (!failure) {
      // The strongest check available without a person: the template, fed the
      // card's own numbers, must give the card's own answer.
      const against = checkAgainstOriginal(candidate.data);
      if (against && !against.ok) {
        lastComplaint = `fed the card's own numbers it answered ${against.got}, but the card says ${against.want}`;
        messages.push({ role: "assistant", content });
        messages.push({
          role: "user",
          content: `That template is wrong: ${lastComplaint}. The formula does not match the question. Correct it and reply with the JSON only.`,
        });
        continue;
      }
      shape = candidate;
      break;
    }

    lastComplaint = describeFailure(failure);
    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content: [
        `That template cannot produce a question: ${lastComplaint}.`,
        "Fix it and reply with the corrected JSON only.",
        "Widen the ranges, loosen or drop the constraint, and make sure the",
        "answer is a whole number for every combination the ranges allow.",
      ].join(" "),
    });
  }

  if (!shape || !shape.success) {
    throw new Error(
      `Couldn't build a workable template for this card — ${lastComplaint || "the reply didn't hold up"}. This card may not be one where only the numbers change.`,
    );
  }

  // Models reliably slip formulas into the explanation — "(l * w * h)" where
  // "{l} x {w} x {h}" was asked for — which reaches the student as algebra in
  // the middle of a worked answer. A bare variable name there can only have
  // meant its value, so it is repaired rather than sent back.
  if (shape.data.explanation) {
    let explanation = shape.data.explanation;
    for (const variable of shape.data.variables) {
      explanation = explanation.replace(
        new RegExp(`(?<![{\\w])${variable.name}(?![}\\w])`, "g"),
        `{${variable.name}}`,
      );
    }
    shape.data.explanation = explanation;
  }
  const problem = validateGenerated(shape.data);
  if (problem) throw new Error(problem);

  return {
    payload: shape.data,
    /**
     * Whether the template reproduced the card's own answer. A template that
     * could not be checked is not wrong — it simply has to be read by a person,
     * and a batch run should say which is which rather than treat them alike.
     */
    verified: checkAgainstOriginal(shape.data)?.ok ?? null,
  };
}
