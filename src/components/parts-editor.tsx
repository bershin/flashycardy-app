"use client";

import { useLayoutEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { newPartId, partLetter, type Part } from "@/lib/parts";

/** Signs with no key of their own, typed into whichever box was last used. */
const SIGNS = ["×", "÷", "²", "³", "√", "½"];

/**
 * A lettered question's parts: each a question and its answer.
 *
 * Made for typing a worksheet in quickly — Enter in a question moves to its
 * answer, Enter in an answer starts the next part — so a whole sheet goes in
 * without reaching for the mouse.
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
  /** The box a sign button types into: the last one that had focus. */
  const last = useRef<HTMLInputElement | null>(null);
  /** A box to move to once React has drawn it, and where its caret goes. */
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
    const [kind, id] = [box.id.startsWith("part-q-") ? "question" : "answer", box.id.slice(7)];
    const start = box.selectionStart ?? box.value.length;
    const end = box.selectionEnd ?? start;
    set(id, { [kind]: box.value.slice(0, start) + text + box.value.slice(end) });
    pending.current = { id: box.id, at: start + text.length };
  }

  const field = (part: Part, kind: "question" | "answer", index: number) => (
    <Input
      id={`part-${kind === "question" ? "q" : "a"}-${part.id}`}
      value={part[kind]}
      disabled={disabled}
      placeholder={kind === "question" ? "131 × 19" : "2489"}
      aria-label={`Part ${partLetter(index)} ${kind}`}
      onFocus={(e) => (last.current = e.currentTarget)}
      // A star is how a keyboard writes times; it reads as ×, as it does in
      // a fraction.
      onChange={(e) => set(part.id, { [kind]: e.target.value.replace(/\*/g, "×") })}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        // Never submits the card: the next box is where the typing goes.
        e.preventDefault();
        if (kind === "answer" && index === items.length - 1) {
          add();
          return;
        }
        pending.current = {
          id:
            kind === "question"
              ? `part-a-${part.id}`
              : `part-q-${items[index + 1].id}`,
        };
        // Moving focus changes no part, so nothing would re-render to run the
        // move; a fresh array asks for one.
        onChange([...items]);
      }}
      className={kind === "answer" ? "w-28 shrink-0" : "min-w-0 flex-1"}
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
          Enter moves to the next box.
        </span>
      </div>

      <ol className="grid gap-1.5">
        {items.map((part, index) => (
          <li key={part.id} className="grid gap-1">
            <div className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right text-sm font-semibold text-muted-foreground">
                {partLetter(index)})
              </span>
              {field(part, "question", index)}
              <span className="text-muted-foreground">=</span>
              {field(part, "answer", index)}
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
            </div>
            {/* Left out of the Enter chain: a worksheet goes in question,
                answer, question, and the explanations are added after. */}
            <Textarea
              value={part.note ?? ""}
              disabled={disabled}
              rows={1}
              placeholder="Explanation, shown with the answer (optional)"
              aria-label={`Part ${partLetter(index)} explanation`}
              onChange={(e) => set(part.id, { note: e.target.value })}
              className="ml-8 min-h-8 w-auto py-1 text-xs md:text-xs"
            />
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
