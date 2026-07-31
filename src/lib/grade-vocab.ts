"use client";

import { z } from "zod";
import { getOpenAIKey, getOpenAIModel } from "@/lib/settings";

export type VocabVerdict = {
  correct: boolean;
  /** One or two sentences the learner reads. */
  feedback: string;
  /** Optional better-phrasing suggestion for the sentence. */
  suggestion?: string;
};

const verdictSchema = z.object({
  correct: z.boolean(),
  feedback: z.string().min(1).max(600),
  suggestion: z.string().max(600).optional(),
});

export class NoKeyError extends Error {
  constructor() {
    super("No OpenAI key set");
    this.name = "NoKeyError";
  }
}

/**
 * Ask the model whether the learner understood a word.
 *
 * This is the one thing in the app that genuinely needs an LLM: judging whether
 * free-text synonyms fit and whether a sentence uses the word correctly is not
 * something that can be precomputed or pattern-matched.
 *
 * The verdict is advisory. The study screen shows it and applies it, but leaves
 * the manual Got it / Missed buttons live, because a grader that is confidently
 * wrong should never be the last word on your own review history.
 */
export async function gradeVocab(input: {
  word: string;
  senseHint?: string;
  synonyms: string;
  sentence: string;
}): Promise<VocabVerdict> {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new NoKeyError();

  const plainWord = input.word.replace(/<[^>]*>/g, "").trim();

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
            "You grade vocabulary practice. Be encouraging but honest. Mark correct only if the synonyms are genuinely close in meaning AND the sentence uses the word correctly and naturally. Keep feedback to one or two short sentences addressed to the learner.",
        },
        {
          role: "user",
          content: [
            `Word: ${plainWord}`,
            input.senseHint ? `Intended sense: ${input.senseHint}` : null,
            `Learner's synonyms: ${input.synonyms || "(none given)"}`,
            `Learner's sentence: ${input.sentence || "(none given)"}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "vocab_verdict",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["correct", "feedback", "suggestion"],
            properties: {
              correct: { type: "boolean" },
              feedback: { type: "string" },
              suggestion: {
                type: ["string", "null"],
                description: "A better version of the sentence, or null.",
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
  if (!content) throw new Error("The grader returned nothing. Try again.");

  const raw = JSON.parse(content) as Record<string, unknown>;
  const parsed = verdictSchema.safeParse({
    ...raw,
    // The schema requires the key, so an absent suggestion arrives as null.
    suggestion: raw.suggestion ?? undefined,
  });
  if (!parsed.success) {
    throw new Error("The grader replied in an unexpected shape. Try again.");
  }
  return parsed.data;
}
