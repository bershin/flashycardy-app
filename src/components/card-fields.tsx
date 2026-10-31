"use client";

import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/rich-text-editor";
import { OcclusionEditor } from "@/components/occlusion-editor";
import {
  firstImageSrc,
  newWordBox,
  type OcclusionBox,
} from "@/lib/occlusion";
import { WordListEditor } from "@/components/word-list-editor";
import { PartsEditor } from "@/components/parts-editor";
import { newPartId, type Part } from "@/lib/parts";
import {
  NEW_CARD_SCHEDULE,
  type CardRow,
  type CardType,
  type ReviewSchedule,
} from "@/lib/store/types";

export const MIN_OPTIONS = 2;

/**
 * The row an empty word list shows. One shared object rather than a fresh
 * one per render, so its id — and the focus on it — holds while it is typed
 * into; the first keystroke turns it into a box of the draft's own.
 */
const EMPTY_ROW = newWordBox();
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
  /** A picture card's boxes, one card each. */
  boxes: OcclusionBox[];
  /** A picture card answered by typing its hidden words. */
  typed: boolean;
  /** A question's parts, one card each. */
  items: Part[];
  schedule: ReviewSchedule;
};

export function emptyDraft(): CardDraft {
  return {
    type: "basic",
    front: "",
    back: "",
    options: ["", "", "", ""],
    correctIndex: 0,
    boxes: [],
    typed: false,
    items: blankParts(),
    schedule: NEW_CARD_SCHEDULE,
  };
}

export function draftFromCard(card: CardRow): CardDraft {
  return {
    type: card.type,
    front: card.front,
    back: card.back,
    options: card.quiz?.options ?? ["", "", "", ""],
    correctIndex: card.quiz?.correctIndex ?? 0,
    boxes: card.occlusion?.boxes ?? [],
    typed: card.occlusion?.typed ?? false,
    items: card.parts?.items ?? blankParts(),
    schedule: card.schedule,
  };
}

/** Two empty rows, so a) and b) show what the form is for. */
function blankParts(): Part[] {
  return [
    { id: newPartId(), question: "", answer: "" },
    { id: newPartId(), question: "", answer: "" },
  ];
}

/** The parts worth saving: rows left wholly empty are dropped, not refused. */
export function filledParts(draft: CardDraft): Part[] {
  return draft.items
    .map((p) => ({
      ...p,
      // Pasted text can still carry a keyboard's star for times.
      question: p.question.replace(/\*/g, "×").trim(),
      answer: p.answer.replace(/\*/g, "×").trim(),
    }))
    .filter((p) => p.question || p.answer);
}

export function isBlank(html: string): boolean {
  // Embedded media counts as content even though it carries no text. A question
  // that is nothing but a screenshot is perfectly valid — most of a maths deck
  // looks like that — and rejecting it as empty made picture cards unaddable.
  if (/<(?:img|video|audio)\b/i.test(html)) return false;
  return html.replace(/<[^>]*>/g, "").trim().length === 0;
}

/**
 * A row left empty in the word list: no word, no clue, and still the
 * whole-picture box a typed word starts as (a box drawn on a picture never is).
 */
function isEmptyWordRow(box: OcclusionBox): boolean {
  return (
    !box.label.trim() &&
    !box.clue?.trim() &&
    box.x === 0 &&
    box.y === 0 &&
    box.w === 1 &&
    box.h === 1
  );
}

/** The boxes worth saving: rows left wholly empty are dropped, not refused. */
export function boxesToSave(draft: CardDraft): OcclusionBox[] {
  return draft.boxes.filter((b) => !isEmptyWordRow(b));
}

/** Returns an error message, or null when the draft can be saved. */
export function validateDraft(draft: CardDraft): string | null {
  if (draft.type === "parts") {
    const parts = filledParts(draft);
    if (parts.length === 0) return "Add at least one part.";
    const gap = parts.findIndex((p) => !p.question || !p.answer);
    if (gap !== -1) {
      return `Part ${String.fromCharCode(97 + gap)} needs ${
        parts[gap].question ? "an answer" : "a question"
      }.`;
    }
    return null;
  }

  // A typed list of words is the question itself; the picture is optional.
  if (draft.type === "occlusion" && draft.typed && !firstImageSrc(draft.front)) {
    const words = boxesToSave(draft);
    if (words.length === 0) return "Type at least one word, or add a picture.";
    const blank = words.findIndex((b) => !b.label.trim());
    if (blank !== -1) return `Word ${blank + 1} needs the word as well as its clue.`;
    return null;
  }

  if (isBlank(draft.front)) {
    return "The question is required.";
  }

  if (draft.type === "basic" && isBlank(draft.back)) {
    return "The answer is required.";
  }

  if (draft.type === "occlusion") {
    if (!firstImageSrc(draft.front)) {
      return "Add the picture to the question first.";
    }
    if (draft.boxes.length === 0) {
      return "Drag across at least one label on the picture to hide it.";
    }
    const blank = draft.boxes.findIndex((b) => !b.label.trim());
    if (blank !== -1) return `Box ${blank + 1} needs a label.`;
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
    schedule: draft.schedule,
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

/**
 * The choices the picker offers, which are not quite the card types.
 *
 * A picture's labels and a question's parts are one choice — both make a card
 * per item, each self-rated — with a switch underneath for which; a typed
 * set is its own choice though it is a picture card underneath.
 */
type Choice = "basic" | "quiz" | "set" | "typed";

const TYPES: Array<{ choice: Choice; label: string; hint: string }> = [
  { choice: "basic", label: "Basic", hint: "Question and answer, self-rated" },
  { choice: "quiz", label: "Quiz", hint: "Multiple choice, graded instantly" },
  {
    choice: "set",
    label: "Labels or parts",
    hint: "One card each — labels on a picture, or a) b) c) parts",
  },
  {
    choice: "typed",
    label: "Type the words",
    hint: "Hidden words — on a picture or a list — typed to reveal",
  },
];

/** Which picker choice a draft is. A generated card is none of them. */
function choiceOf(draft: CardDraft): Choice | null {
  if (draft.type === "basic" || draft.type === "quiz") return draft.type;
  if (draft.type === "parts") return "set";
  if (draft.type === "occlusion") return draft.typed ? "typed" : "set";
  return null;
}

/** The draft as a choice makes it. Labels-or-parts keeps whichever it was. */
function choose(draft: CardDraft, choice: Choice): Partial<CardDraft> {
  switch (choice) {
    case "basic":
    case "quiz":
      return { type: choice, typed: false };
    case "set":
      return { type: draft.type === "parts" ? "parts" : "occlusion", typed: false };
    case "typed":
      return { type: "occlusion", typed: true };
  }
}

const SET_MODES: Array<{ type: "occlusion" | "parts"; label: string }> = [
  { type: "occlusion", label: "Labels on a picture" },
  { type: "parts", label: "Parts a) b) c)" },
];

interface CardFieldsProps {
  draft: CardDraft;
  onChange: (draft: CardDraft) => void;
  disabled?: boolean;
  /**
   * Set when editing one card of a picture's labels or a question's parts.
   * Those are edited as a set, so turning one of them into a basic card would
   * leave a hole in it.
   */
  cardSet?: { kind: "occlusion" | "parts"; size: number };
}

export function CardFields({
  draft,
  onChange,
  disabled,
  cardSet,
}: CardFieldsProps) {
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
      {cardSet !== undefined ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {cardSet.kind === "occlusion" && draft.typed && !firstImageSrc(draft.front)
            ? `This card is one of ${cardSet.size} words in the same list. Changes here apply to all of them; removing a word deletes that word's card.`
            : cardSet.kind === "occlusion"
            ? `This card is one of ${cardSet.size} made from the same picture. Changes here apply to all of them; removing a box deletes that box's card.`
            : `This card is one of ${cardSet.size} parts of the same question. Changes here apply to all of them; removing a part deletes that part's card.`}
        </p>
      ) : (
      <div className="grid gap-2">
        <Label>Card type</Label>
        <div className="grid grid-cols-2 gap-2">
          {/* A generated card matches neither button, which reads as a bug
              rather than a state. Saying what it is — and what picking one of
              these would cost — is the difference. */}
          {draft.type === "generated" && (
            <p className="col-span-full text-xs text-muted-foreground">
              This card varies: its numbers are rolled from a template. Choosing
              Basic or Quiz below drops the template and returns the card to the
              question it was written with.
            </p>
          )}
          {TYPES.map((option) => (
            <button
              key={option.choice}
              type="button"
              disabled={disabled}
              onClick={() => set(choose(draft, option.choice))}
              className={`rounded-lg border p-2 text-left transition-colors disabled:opacity-50 ${
                choiceOf(draft) === option.choice
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
          {/* Chosen rather than guessed from whether there is a picture, as
              Type the words does: a question in parts may well have a diagram
              in its instructions, and that should not turn it into labels. */}
          {choiceOf(draft) === "set" && (
            <div
              role="radiogroup"
              aria-label="Labels or parts"
              className="col-span-full inline-flex w-fit gap-1 rounded-lg bg-muted p-1"
            >
              {SET_MODES.map((mode) => (
                <button
                  key={mode.type}
                  type="button"
                  role="radio"
                  aria-checked={draft.type === mode.type}
                  disabled={disabled}
                  onClick={() => set({ type: mode.type, typed: false })}
                  className={`rounded-md px-3 py-1 text-sm transition-colors disabled:opacity-50 ${
                    draft.type === mode.type
                      ? "bg-background font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      <div className="grid gap-2">
        <Label>
          {draft.type === "occlusion"
            ? draft.typed
              ? "Picture (optional)"
              : "Picture"
            : draft.type === "parts"
              ? "Instructions (optional)"
              : "Question"}
        </Label>
        <RichTextEditor
          content={draft.front}
          onChange={(front) => set({ front })}
          placeholder={
            draft.type === "occlusion"
              ? draft.typed
                ? "Add a picture to hide words on it — or leave this for instructions and type the words below…"
                : "Paste or add the picture, and a question above it if you like…"
              : draft.type === "parts"
                ? "Work out:"
                : "Question or term…"
          }
          disabled={disabled}
        />
      </div>

      {draft.type === "parts" && (
        <div className="grid gap-2">
          <Label>Parts</Label>
          <PartsEditor
            items={draft.items}
            onChange={(items) => set({ items })}
            disabled={disabled}
          />
        </div>
      )}

      {draft.type === "occlusion" && (
        <div className="grid gap-2">
          <Label>{draft.typed ? "Words to hide" : "Labels to hide"}</Label>
          {/* Here as well as in the picker, because the picker is not shown
              when editing a set: this is how an existing picture switches. */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.typed}
              disabled={disabled}
              onChange={(e) => set({ typed: e.target.checked })}
              className="size-4 accent-[var(--color-primary)]"
            />
            Study by typing the words — all hidden at once, each one found opens
          </label>
          {firstImageSrc(draft.front) ? (
            <OcclusionEditor
              src={firstImageSrc(draft.front)!}
              // Empty rows from the word list are not boxes to draw.
              boxes={draft.boxes.filter((b) => !isEmptyWordRow(b))}
              onChange={(boxes) => set({ boxes })}
              disabled={disabled}
            />
          ) : draft.typed ? (
            <WordListEditor
              // Never an empty list: one row says what the form is for.
              boxes={draft.boxes.length > 0 ? draft.boxes : [EMPTY_ROW]}
              onChange={(boxes) => set({ boxes })}
              disabled={disabled}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Add the picture above, then cover each label you want to learn.
            </p>
          )}
        </div>
      )}

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
          {draft.type === "basic"
            ? "Answer"
            : draft.type === "occlusion" || draft.type === "parts"
              ? "Notes (optional)"
              : "Explanation (optional)"}
        </Label>
        <RichTextEditor
          content={draft.back}
          onChange={(back) => set({ back })}
          placeholder={
            draft.type === "basic"
              ? "Answer or definition…"
              : draft.type === "occlusion"
                ? "Shown with every label's answer…"
                : "Shown after you answer…"
          }
          disabled={disabled}
        />
      </div>
    </div>
  );
}
