"use client";

import { useLayoutEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { newWordBox, type OcclusionBox } from "@/lib/occlusion";

/**
 * The words of a typed set with no picture: each a word and, if wanted, a
 * clue to show while it is hidden.
 *
 * Laid out for typing a list straight in, as the parts editor is: Enter in a
 * word moves to its clue, Enter in a clue starts the next word. A list pasted
 * into a word box becomes one row per line, so a spelling list copied from
 * anywhere goes in at once.
 */
export function WordListEditor({
  boxes,
  onChange,
  disabled,
}: {
  boxes: OcclusionBox[];
  onChange: (boxes: OcclusionBox[]) => void;
  disabled?: boolean;
}) {
  /** A box to move to once React has drawn it. */
  const pending = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!pending.current) return;
    document.getElementById(pending.current)?.focus();
    pending.current = null;
  });

  function set(id: string, patch: Partial<OcclusionBox>) {
    onChange(boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function add(after?: number) {
    const box = newWordBox();
    const next = [...boxes];
    next.splice(after === undefined ? next.length : after + 1, 0, box);
    onChange(next);
    pending.current = `word-${box.id}`;
  }

  /** Lines pasted into a word: this row takes the first, new rows the rest. */
  function paste(index: number, text: string): boolean {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return false;
    const next = [...boxes];
    next[index] = { ...next[index], label: lines[0] };
    next.splice(index + 1, 0, ...lines.slice(1).map((l) => newWordBox(l)));
    onChange(next);
    return true;
  }

  return (
    <div className="grid gap-2">
      <ol className="grid gap-1.5">
        {boxes.map((box, index) => (
          <li key={box.id} className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <Input
              id={`word-${box.id}`}
              value={box.label}
              disabled={disabled}
              placeholder="thief"
              aria-label={`Word ${index + 1}`}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set(box.id, { label: e.target.value })}
              onPaste={(e) => {
                if (paste(index, e.clipboardData.getData("text"))) e.preventDefault();
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                // Never submits the card: the clue is where the typing goes.
                e.preventDefault();
                pending.current = `clue-${box.id}`;
                onChange([...boxes]);
              }}
              className="w-36 shrink-0"
            />
            <Input
              id={`clue-${box.id}`}
              value={box.clue ?? ""}
              disabled={disabled}
              placeholder="Clue (optional) — without one, a blank per letter"
              aria-label={`Clue for word ${index + 1}`}
              onChange={(e) => set(box.id, { clue: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (index === boxes.length - 1) add();
                else {
                  pending.current = `word-${boxes[index + 1].id}`;
                  onChange([...boxes]);
                }
              }}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled || boxes.length === 1}
              onClick={() => onChange(boxes.filter((b) => b.id !== box.id))}
            >
              <X className="size-4" />
              <span className="sr-only">Remove word {index + 1}</span>
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
          Add word
        </Button>
        <p className="text-xs text-muted-foreground">
          Enter moves to the next box; a pasted list fills a row per line.
        </p>
      </div>
    </div>
  );
}
