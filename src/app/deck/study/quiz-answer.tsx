"use client";

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CardRow } from "@/lib/store/types";
import { CardHtml } from "@/components/card-html";

interface QuizAnswerProps {
  card: CardRow;
  /**
   * Options for a generated card, rolled by the session that owns the roll.
   * Passed in rather than derived here so the question above and the options
   * below are always the same instance of the card.
   */
  rolled?: { options: string[]; correctIndex: number; explanation: string | null };
  /** Called once the user has seen the outcome and is ready to move on. */
  onResolved: (rating: "got_it" | "missed") => void;
  /**
   * Called the instant an option is picked — the moment the answer is on
   * screen, which is where the card's timer stops. Separate from `onResolved`
   * because a wrong answer then sits there for as long as it takes to read the
   * explanation, and that reading isn't part of the recall.
   */
  onRevealed: () => void;
}

/**
 * A user-authored multiple-choice card.
 *
 * No AI and no network: the correct answer was written by hand, so grading is a
 * comparison. Getting it right moves straight on; getting it wrong holds still
 * and shows which one was right, because being wrong without seeing the answer
 * teaches nothing.
 */
export function QuizAnswer({
  card,
  rolled,
  onResolved,
  onRevealed,
}: QuizAnswerProps) {
  const options = rolled?.options ?? card.quiz?.options ?? [];
  const correctIndex = rolled?.correctIndex ?? card.quiz?.correctIndex ?? 0;

  // Shuffled once per card so the answer is learned rather than its position.
  // Keyed on the card id: re-shuffling on every render would move options out
  // from under the pointer.
  const order = useMemo(() => {
    const indices = options.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, rolled]);

  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const wasCorrect = picked === correctIndex;

  function choose(index: number) {
    if (answered) return;
    setPicked(index);
    onRevealed();
    if (index === correctIndex) {
      // Right: a beat to register the tick, then straight on.
      setTimeout(() => onResolved("got_it"), 550);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid gap-2 overflow-y-auto">
        {order.map((optionIndex) => {
          const isCorrect = optionIndex === correctIndex;
          const isPicked = optionIndex === picked;

          const tone = !answered
            ? "border-border hover:-translate-y-0.5 hover:border-[var(--deck-accent-line)] hover:bg-muted"
            : isCorrect
              ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : isPicked
                ? "border-red-500 bg-red-500/10 text-red-600 dark:text-red-400"
                : "border-border opacity-50";

          return (
            <button
              key={optionIndex}
              type="button"
              disabled={answered}
              onClick={() => choose(optionIndex)}
              className={`flex items-center gap-3 rounded-xl border p-4 text-left text-base transition-all disabled:cursor-default ${tone}`}
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                {answered && isCorrect && <Check className="size-5" />}
                {answered && isPicked && !isCorrect && <X className="size-5" />}
              </span>
              <span className="min-w-0 flex-1">{options[optionIndex]}</span>
            </button>
          );
        })}
      </div>

      {answered && !wasCorrect && (
        <div className="shrink-0 space-y-3">
          {/* A generated card explains this roll's numbers; a hand-written one
              shows whatever was typed on the back. */}
          {rolled?.explanation ? (
            <p className="rounded-lg border bg-muted/50 p-3 text-sm">
              {rolled.explanation}
            </p>
          ) : (
            card.back.replace(/<[^>]*>/g, "").trim().length > 0 && (
              <CardHtml
                className="rich-content rounded-lg border bg-muted/50 p-3 text-sm"
                html={card.back}
              />
            )
          )}
          <div className="flex justify-center">
            <Button size="lg" onClick={() => onResolved("missed")}>
              Continue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
