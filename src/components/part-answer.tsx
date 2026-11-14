"use client";

import { CardHtml } from "@/components/card-html";
import {
  answerHtml,
  isInlineAnswer,
  questionHtml,
  type Part,
} from "@/lib/parts";

/**
 * A part's question, formatting kept: in the line when it is a run of words,
 * as a block of its own when it is more — a table, a list, a picture.
 */
export function PartQuestionText({
  part,
  className,
}: {
  part: Pick<Part, "question">;
  className?: string;
}) {
  const html = questionHtml(part);
  const inline = isInlineAnswer(html);
  return (
    <CardHtml
      inline={inline}
      className={`rich-content [&_p]:m-0 ${inline ? "[&_p]:inline" : ""} ${className ?? ""}`}
      html={html}
    />
  );
}

/**
 * A part's answer where it fits on the question's line: a run of words after
 * the `=`, formatting kept. Null for an answer with more to it — a list of
 * steps, a picture — which the caller shows underneath instead.
 */
export function InlinePartAnswer({
  part,
  className,
}: {
  part: Pick<Part, "answer">;
  className?: string;
}) {
  const html = answerHtml(part);
  if (!isInlineAnswer(html)) return null;
  return (
    <CardHtml
      inline
      className={`rich-content [&_p]:m-0 [&_p]:inline ${className ?? ""}`}
      html={html}
    />
  );
}

/** Whether a part's answer goes underneath its question rather than after it. */
export function answerGoesBelow(part: Pick<Part, "answer">): boolean {
  return !isInlineAnswer(answerHtml(part));
}
