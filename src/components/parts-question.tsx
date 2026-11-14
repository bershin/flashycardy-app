"use client";

import { CardHtml } from "@/components/card-html";
import { isBlank } from "@/components/card-fields";
import { ownPart, partLetter, type PartsPayload } from "@/lib/parts";
import {
  InlinePartAnswer,
  PartQuestionText,
  answerGoesBelow,
} from "@/components/part-answer";

/**
 * A lettered question as it is studied: every part listed, this card's part
 * picked out, and every answer hidden but the one being revealed.
 *
 * The other parts stay in view because they are the context a worksheet gives
 * — the question reads as it was set — but their answers stay hidden, since
 * each is a card of its own still to come.
 */
export function PartsQuestion({
  html,
  parts,
  state,
  className,
}: {
  html: string;
  parts: PartsPayload;
  state: "question" | "answer";
  className?: string;
}) {
  const own = ownPart(parts);
  return (
    <div className={className}>
      {!isBlank(html) && <CardHtml className="rich-content mb-2" html={html} />}
      <ol className="grid gap-1">
        {parts.items.map((part, index) => {
          const mine = part.id === own?.id;
          return (
            <li
              key={part.id}
              className={`flex flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1 ${
                mine ? "bg-violet-500/10 ring-2 ring-violet-500" : "text-muted-foreground"
              }`}
            >
              <span className="font-semibold">{partLetter(index)})</span>
              <PartQuestionText part={part} />
              <span>=</span>
              {mine ? (
                state === "answer" ? (
                  answerGoesBelow(part) ? (
                    // Working and all, it reads better in the answer's own
                    // space than squeezed onto this line.
                    <span className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
                      in the answer
                    </span>
                  ) : (
                    <InlinePartAnswer
                      part={part}
                      className="font-bold text-emerald-600 dark:text-emerald-400"
                    />
                  )
                ) : (
                  <span className="rounded bg-violet-600 px-2 text-sm font-bold text-white">
                    ?
                  </span>
                )
              ) : (
                <span
                  aria-label="Hidden"
                  className="inline-block h-4 w-10 rounded bg-muted-foreground/25"
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
