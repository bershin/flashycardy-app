"use client";

import { useState } from "react";
import { CardHistory } from "@/components/card-history";
import { CardHtml } from "@/components/card-html";
import { isBlank } from "@/components/card-fields";
import { labelStatus } from "@/components/occlusion-picture";
import { partLetter } from "@/lib/parts";
import type { CardRow } from "@/lib/store/types";
import { CardSetTile } from "./card-set-tile";
import { StatusKey } from "./picture-card";

const ANSWER_TONE = {
  new: "bg-amber-300",
  missed: "bg-red-300",
  known: "bg-emerald-300",
};

/**
 * A lettered question's parts as one tile in the deck.
 *
 * Each part is its own card underneath, but the question reads as it was set:
 * the parts listed together, each answer hidden behind a patch coloured by how
 * that part is going. Click a patch to see the answer and that part's record.
 */
export function PartsCard({
  cards,
  selecting = false,
  selected = false,
  onToggleSelected,
}: {
  /** The question's cards, all sharing one `parts.group`. */
  cards: CardRow[];
  selecting?: boolean;
  selected?: boolean;
  onToggleSelected?: (ids: number[]) => void;
}) {
  const first = cards[0];
  const items = first.parts!.items;
  const byPart = new Map(cards.map((c) => [c.parts!.partId, c]));
  const [shown, setShown] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <CardSetTile
      cards={cards}
      heading={isBlank(first.front) ? undefined : first.front}
      noun="part"
      selecting={selecting}
      selected={selected}
      onToggleSelected={onToggleSelected}
    >
      <div className="grid gap-3">
        <ol className="grid gap-1.5 text-base">
          {items.map((part, index) => {
            const card = byPart.get(part.id);
            const open = shown.has(part.id);
            return (
              <li key={part.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold">{partLetter(index)})</span>
                <span>{part.question}</span>
                <span className="text-muted-foreground">=</span>
                <button
                  type="button"
                  disabled={selecting}
                  onClick={() => toggle(part.id)}
                  title={open ? "Hide the answer" : "Show the answer"}
                  className={`min-w-12 rounded px-2 text-left font-semibold disabled:cursor-default ${
                    open
                      ? "text-emerald-600 dark:text-emerald-400"
                      : `${ANSWER_TONE[labelStatus(card)]} text-transparent select-none`
                  }`}
                >
                  {/* The answer is always the content, hidden by colour when
                      covered, so the patch is as wide as what it hides. */}
                  {part.answer}
                </button>
                {open && card && (
                  <CardHistory
                    compact
                    timesMissed={card.timesMissed}
                    streak={card.consecutiveCorrect}
                  />
                )}
                {open && part.note?.trim() && (
                  <p className="basis-full whitespace-pre-line pl-5 text-sm text-muted-foreground">
                    {part.note.trim()}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        {!isBlank(first.back) && (
          <CardHtml
            className="rich-content text-sm text-muted-foreground"
            html={first.back}
          />
        )}
        {!selecting && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <p className="text-xs text-muted-foreground">
              Click a patch to see the answer.
            </p>
            <StatusKey />
          </div>
        )}
      </div>
    </CardSetTile>
  );
}
