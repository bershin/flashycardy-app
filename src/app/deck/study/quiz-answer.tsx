"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  rolled?: {
    options: string[];
    correctIndex: number;
    explanation: string | null;
  };
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

  /**
   * A keyboard cursor over the options.
   *
   * Held as a position in `order` — where the option sits on screen — not as an
   * option index, so up and down move down the list as it reads rather than
   * through the order the card was written in. Null until an arrow is pressed:
   * highlighting an option the moment the card appears would look like a choice
   * has already been made, and moving focus on mount would drag the page.
   */
  const [cursor, setCursor] = useState<number | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Focus follows the cursor, so Enter and Space keep working through the
  // browser rather than through a second set of shortcuts, and a screen reader
  // reads each option as it is reached.
  useEffect(() => {
    if (cursor !== null) optionRefs.current[cursor]?.focus();
  }, [cursor]);

  /**
   * Up and down walk the options; right takes the highlighted one, and once an
   * answer is in, right moves on to the next card.
   *
   * Right means "got it, onwards" on a self-rated card, which is the habit this
   * borrows — on a quiz there is nothing to rate, so it carries the only
   * meaning left over.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        /^(INPUT|TEXTAREA)$/.test(target?.tagName ?? "")
      ) {
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (answered) {
          onResolved(wasCorrect ? "got_it" : "missed");
        } else if (cursor !== null) {
          choose(order[cursor]);
        }
        return;
      }

      // Nothing to pick once the answer is showing: the options are spent and
      // the only move left is the one right already makes.
      if (answered) return;

      // The numbers on screen are the shortcut. Read as a position in the list
      // as it reads, which is what the number in front of each option counts,
      // so 2 always takes the second one down.
      if (/^[1-9]$/.test(e.key)) {
        const position = Number(e.key) - 1;
        if (position >= order.length) return;
        e.preventDefault();
        setCursor(position);
        choose(order[position]);
        return;
      }

      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setCursor((prev) => {
        // The first press enters the list from the end it came from, rather
        // than always at the top.
        if (prev === null) return step === 1 ? 0 : order.length - 1;
        return (prev + step + order.length) % order.length;
      });
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, wasCorrect, cursor, order, onResolved]);

  function choose(index: number) {
    if (answered) return;
    setPicked(index);
    onRevealed();
    // Right or wrong, the card stays until it is dismissed. Being right is
    // often the moment the explanation is worth reading — a guess between two
    // spellings that happened to land on the correct one teaches nothing if the
    // screen moves on before you see why.
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid gap-2 overflow-y-auto">
        {order.map((optionIndex, position) => {
          const isCorrect = optionIndex === correctIndex;
          const isPicked = optionIndex === picked;

          // Drawn from the cursor rather than from :focus-visible, so the
          // highlight is the same whether focus arrived by key or by tab.
          const onCursor = !answered && position === cursor;

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
              ref={(node) => {
                optionRefs.current[position] = node;
              }}
              type="button"
              disabled={answered}
              onClick={() => choose(optionIndex)}
              className={`flex items-center gap-3 rounded-xl border p-4 text-left text-base transition-all outline-none disabled:cursor-default ${tone} ${
                onCursor
                  ? "-translate-y-0.5 border-[var(--deck-accent-line)] bg-muted ring-2 ring-[var(--deck-accent-line)]"
                  : ""
              }`}
            >
              {/* The number and the mark share one slot, so the text starts at
                  the same place before and after answering — a column that
                  shifts when the marks appear is the thing you notice instead
                  of the answer. */}
              <span className="flex size-6 shrink-0 items-center justify-center">
                {answered && isCorrect ? (
                  <Check className="size-5" />
                ) : answered && isPicked ? (
                  <X className="size-5" />
                ) : (
                  <span className="text-sm font-medium text-muted-foreground tabular-nums">
                    {position + 1}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">{options[optionIndex]}</span>
            </button>
          );
        })}
      </div>

      {answered && (
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
            <Button
              size="lg"
              autoFocus
              onClick={() => onResolved(wasCorrect ? "got_it" : "missed")}
            >
              Continue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
