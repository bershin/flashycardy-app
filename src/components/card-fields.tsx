"use client";

import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/rich-text-editor";
import type { CardRow, CardType } from "@/lib/store/types";

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

/**
 * The editable shape of a card, flat rather than discriminated.
 *
 * Keeping every type's fields on one object means switching type in the picker
 * doesn't discard what you already typed — you can start a basic card, realise
 * it wants options, and switch without losing the question.
 */
export type CardDraft = {
  type: CardType;
  front: string;
  back: string;
  options: string[];
  correctIndex: number;
};

export function emptyDraft(): CardDraft {
  return {
    type: "basic",
    front: "",
    back: "",
    options: ["", "", "", ""],
    correctIndex: 0,
  };
}

export function draftFromCard(card: CardRow): CardDraft {
  return {
    type: card.type,
    front: card.front,
    back: card.back,
    options: card.quiz?.options ?? ["", "", "", ""],
    correctIndex: card.quiz?.correctIndex ?? 0,
  };
}

export function isBlank(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").trim().length === 0;
}

/** Returns an error message, or null when the draft can be saved. */
export function validateDraft(draft: CardDraft): string | null {
  if (isBlank(draft.front)) {
    return "The question is required.";
  }

  if (draft.type === "basic" && isBlank(draft.back)) {
    return "The answer is required.";
  }

  if (draft.type === "quiz") {
    const filled = draft.options.filter((o) => o.trim().length > 0);
    if (filled.length < MIN_OPTIONS) {
      return `Give at least ${MIN_OPTIONS} options.`;
    }
    if (!draft.options[draft.correctIndex]?.trim()) {
      return "Mark which option is the correct answer.";
    }
  }

  return null;
}

/** The draft in the shape the card actions expect. */
export function draftToInput(draft: CardDraft) {
  // Blank options are dropped, so the correct index has to be remapped onto the
  // surviving list rather than carried across as-is.
  const kept = draft.options
    .map((text, index) => ({ text: text.trim(), index }))
    .filter((o) => o.text.length > 0);

  return {
    type: draft.type,
    front: draft.front,
    back: draft.back,
    quiz:
      draft.type === "quiz"
        ? {
            options: kept.map((o) => o.text),
            correctIndex: Math.max(
              0,
              kept.findIndex((o) => o.index === draft.correctIndex),
            ),
          }
        : undefined,
  };
}

const TYPES: Array<{ value: CardType; label: string; hint: string }> = [
  { value: "basic", label: "Basic", hint: "Question and answer, self-rated" },
  { value: "quiz", label: "Quiz", hint: "Multiple choice, graded instantly" },
];

interface CardFieldsProps {
  draft: CardDraft;
  onChange: (draft: CardDraft) => void;
  disabled?: boolean;
}

export function CardFields({ draft, onChange, disabled }: CardFieldsProps) {
  const set = (patch: Partial<CardDraft>) => onChange({ ...draft, ...patch });

  const setOption = (index: number, text: string) => {
    const options = [...draft.options];
    options[index] = text;
    set({ options });
  };

  const removeOption = (index: number) => {
    const options = draft.options.filter((_, i) => i !== index);
    // Keep the same option marked correct as the list shifts under it.
    const correctIndex =
      draft.correctIndex === index
        ? 0
        : draft.correctIndex > index
          ? draft.correctIndex - 1
          : draft.correctIndex;
    set({ options, correctIndex });
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Card type</Label>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => set({ type: option.value })}
              className={`rounded-lg border p-2 text-left transition-colors disabled:opacity-50 ${
                draft.type === option.value
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-muted"
              }`}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs text-muted-foreground">
                {option.hint}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Question</Label>
        <RichTextEditor
          content={draft.front}
          onChange={(front) => set({ front })}
          placeholder="Question or term…"
          disabled={disabled}
        />
      </div>

      {draft.type === "quiz" && (
        <div className="grid gap-2">
          <Label>Options</Label>
          <p className="-mt-1 text-xs text-muted-foreground">
            Tick the correct one. Order is shuffled when you study.
          </p>
          <div className="grid gap-2">
            {draft.options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => set({ correctIndex: index })}
                  aria-label={`Mark option ${index + 1} correct`}
                  aria-pressed={draft.correctIndex === index}
                  className={`flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    draft.correctIndex === index
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-input hover:bg-muted"
                  }`}
                >
                  {draft.correctIndex === index && <Check className="size-4" />}
                </button>
                <Input
                  value={option}
                  disabled={disabled}
                  placeholder={`Option ${index + 1}`}
                  onChange={(e) => setOption(index, e.target.value)}
                />
                {draft.options.length > MIN_OPTIONS && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    onClick={() => removeOption(index)}
                  >
                    <X className="size-4" />
                    <span className="sr-only">Remove option {index + 1}</span>
                  </Button>
                )}
              </div>
            ))}
          </div>
          {draft.options.length < MAX_OPTIONS && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => set({ options: [...draft.options, ""] })}
              >
                <Plus className="size-3.5" />
                Add option
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-2">
        <Label>
          {draft.type === "basic" ? "Answer" : "Explanation (optional)"}
        </Label>
        <RichTextEditor
          content={draft.back}
          onChange={(back) => set({ back })}
          placeholder={
            draft.type === "basic"
              ? "Answer or definition…"
              : "Shown after you answer…"
          }
          disabled={disabled}
        />
      </div>
    </div>
  );
}
