"use client";

import { useLayoutEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/rich-text-editor";
import { newPartId, partLetter, type Part } from "@/lib/parts";

/**
 * A lettered question's parts: each a question and its answer.
 *
 * Both are formatted boxes with every tool: a question can be a fraction, a
 * power or a table, and an answer often carries the working — a list of
 * steps, a picture — as well as the result.
 */
export function PartsEditor({
  items,
  onChange,
  disabled,
}: {
  items: Part[];
  onChange: (items: Part[]) => void;
  disabled?: boolean;
}) {
  /** A part's question to move to once React has drawn it. */
  const pending = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!pending.current) return;
    const box = document.getElementById(pending.current);
    if (!box) return;
    box.focus();
    pending.current = null;
  });

  function set(id: string, patch: Partial<Part>) {
    onChange(items.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function add(after?: number) {
    const part = { id: newPartId(), question: "", answer: "" };
    const next = [...items];
    next.splice(after === undefined ? next.length : after + 1, 0, part);
    onChange(next);
    pending.current = `part-q-${part.id}`;
  }

  return (
    <div className="grid gap-2">
      {/* Question over answer, each the full width: answers are often
          worded, and side by side one or both ended up too narrow to read. */}
      <ol className="grid gap-4">
        {items.map((part, index) => (
          <li key={part.id} className="flex items-start gap-2">
            <span className="w-6 shrink-0 pt-1.5 text-right text-sm font-semibold text-muted-foreground">
              {partLetter(index)})
            </span>
            <div className="grid min-w-0 flex-1 gap-1">
              <RichTextEditor
                compact
                allTools
                id={`part-q-${part.id}`}
                content={part.question}
                disabled={disabled}
                placeholder="Question — 131 × 19"
                label={`Part ${partLetter(index)} question`}
                onChange={(html) => set(part.id, { question: html })}
              />
              <RichTextEditor
                compact
                allTools
                id={`part-a-${part.id}`}
                content={part.answer}
                disabled={disabled}
                placeholder="Answer — 2489, and the working if you like"
                label={`Part ${partLetter(index)} answer`}
                onChange={(html) => set(part.id, { answer: html })}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled || items.length === 1}
              onClick={() => onChange(items.filter((p) => p.id !== part.id))}
            >
              <X className="size-4" />
              <span className="sr-only">Remove part {partLetter(index)}</span>
            </Button>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => add()}
        >
          <Plus className="size-3.5" />
          Add part
        </Button>
        <p className="text-xs text-muted-foreground">
          {items.length === 1
            ? "Each part becomes its own card."
            : `Saving makes ${items.length} cards, one per part, shown together.`}
        </p>
      </div>
    </div>
  );
}
