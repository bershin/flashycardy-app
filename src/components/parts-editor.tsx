"use client";

import { useLayoutEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/rich-text-editor";
import { newPartId, partLetter, type Part } from "@/lib/parts";

/** Signs with no key of their own, typed into whichever question was last used. */
const SIGNS = ["×", "÷", "²", "³", "√", "½"];

/**
 * A lettered question's parts: each a question and its answer.
 *
 * The question is a line, typed with the sign buttons; Enter in it moves to
 * the answer. The answer is a formatted box with every tool, since it often
 * carries the working — a list of steps, a fraction, a picture — as well as
 * the result.
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
  /** The question a sign button types into: the last one that had focus. */
  const last = useRef<HTMLInputElement | null>(null);
  /**
   * A box to move to once React has drawn it — a question, or an answer's
   * editor — and where a question's caret goes.
   */
  const pending = useRef<{ id: string; at?: number } | null>(null);

  useLayoutEffect(() => {
    if (!pending.current) return;
    const box = document.getElementById(pending.current.id) as HTMLInputElement | null;
    if (!box) return;
    box.focus();
    if (pending.current.at !== undefined) {
      box.setSelectionRange(pending.current.at, pending.current.at);
    }
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
    pending.current = { id: `part-q-${part.id}` };
  }

  function sign(text: string) {
    const box = last.current;
    if (!box) return;
    const id = box.id.slice("part-q-".length);
    const start = box.selectionStart ?? box.value.length;
    const end = box.selectionEnd ?? start;
    set(id, { question: box.value.slice(0, start) + text + box.value.slice(end) });
    pending.current = { id: box.id, at: start + text.length };
  }

  const question = (part: Part, index: number) => (
    <Input
      id={`part-q-${part.id}`}
      value={part.question}
      disabled={disabled}
      placeholder="Question — 131 × 19"
      aria-label={`Part ${partLetter(index)} question`}
      onFocus={(e) => (last.current = e.currentTarget)}
      // A star is how a keyboard writes times; it reads as ×, as it does in
      // a fraction.
      onChange={(e) => set(part.id, { question: e.target.value.replace(/\*/g, "×") })}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        // Never submits the card: the answer is where the typing goes.
        e.preventDefault();
        pending.current = { id: `part-a-${part.id}` };
        // Moving focus changes no part, so nothing would re-render to run the
        // move; a fresh array asks for one.
        onChange([...items]);
      }}
    />
  );

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {SIGNS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            title={`Type ${s}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => sign(s)}
            className="inline-flex h-7 min-w-7 items-center justify-center rounded border border-border bg-background px-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            {s}
          </button>
        ))}
        <span className="ml-1 text-xs text-muted-foreground">
          Enter moves to the answer.
        </span>
      </div>

      {/* Question over answer, each the full width: answers are often
          worded, and side by side one or both ended up too narrow to read. */}
      <ol className="grid gap-4">
        {items.map((part, index) => (
          <li key={part.id} className="flex items-start gap-2">
            <span className="w-6 shrink-0 pt-1.5 text-right text-sm font-semibold text-muted-foreground">
              {partLetter(index)})
            </span>
            <div className="grid min-w-0 flex-1 gap-1">
              {question(part, index)}
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
