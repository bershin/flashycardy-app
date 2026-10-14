"use client";

import { InlineMath } from "@tiptap/extension-mathematics";
import type { Editor } from "@tiptap/react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fractionLatex } from "@/lib/math";

/**
 * The editor's maths node, carrying what was typed as well as the LaTeX.
 *
 * The stock node stores only LaTeX. Keeping the top, the bottom and the
 * brackets beside it means a fraction reopens with exactly what was typed, and
 * the text-only views can spell it out without parsing LaTeX back.
 */
export const Fraction = InlineMath.extend({
  addAttributes() {
    const stored = (name: string) => ({
      default: null as string | null,
      parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`),
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs[name] == null ? {} : { [`data-${name}`]: attrs[name] },
    });
    return {
      ...this.parent?.(),
      top: stored("top"),
      bottom: stored("bottom"),
      brackets: stored("brackets"),
    };
  },
});

export type FractionDraft = {
  /** Where the fraction being edited sits; absent for a new one. */
  pos?: number;
  top: string;
  bottom: string;
  brackets: boolean;
};

/** Signs with no key of their own, typed into whichever box was last used. */
const SIGNS = [
  { insert: "×", label: "×", title: "Times (or type *)" },
  { insert: "÷", label: "÷", title: "Divide" },
  { insert: "^", label: "xⁿ", title: "Power: 5^2 is 5²" },
  { insert: "√", label: "√", title: "Square root: √81, or √(9+16)" },
];

/**
 * Where a fraction's top and bottom are typed.
 *
 * Sits under the toolbar rather than in a popup: the card editor is already in
 * a dialog, and a second layer on top of it is one more thing to dismiss.
 */
export function FractionPanel({
  editor,
  draft,
  onClose,
}: {
  editor: Editor;
  draft: FractionDraft;
  onClose: () => void;
}) {
  const [top, setTop] = useState(draft.top);
  const [bottom, setBottom] = useState(draft.bottom);
  const [brackets, setBrackets] = useState(draft.brackets);
  const topRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLInputElement>(null);
  /** The box a sign button types into: the last one that had focus. */
  const lastBox = useRef<"top" | "bottom">("top");

  /** Where the caret goes once a sign button's text has been rendered. */
  const caret = useRef<{ box: HTMLInputElement; at: number } | null>(null);

  useEffect(() => {
    topRef.current?.focus();
  }, []);

  // Before paint, so the next keystroke lands after the sign and not wherever
  // React's re-render left the caret.
  useLayoutEffect(() => {
    if (!caret.current) return;
    caret.current.box.setSelectionRange(caret.current.at, caret.current.at);
    caret.current = null;
  });

  const latex = fractionLatex(top, bottom, brackets);
  const preview = useMemo(
    () => katex.renderToString(latex, { throwOnError: false }),
    [latex],
  );
  const ready = top.trim() !== "" && bottom.trim() !== "";

  function save() {
    if (!ready) return;
    const attrs = { latex, top, bottom, brackets: brackets ? "true" : null };
    const chain = editor.chain().focus();
    if (draft.pos === undefined) {
      chain.insertContent({ type: "inlineMath", attrs }).run();
    } else {
      const pos = draft.pos;
      chain
        .command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, attrs);
          return true;
        })
        .run();
    }
    onClose();
    // `focus()` in the chain waits a frame; this panel's input is about to
    // unmount, and typing in that frame would go nowhere.
    editor.view.focus();
  }

  function addSign(sign: string) {
    const box = lastBox.current === "top" ? topRef.current : bottomRef.current;
    const set = lastBox.current === "top" ? setTop : setBottom;
    if (!box) return;
    const start = box.selectionStart ?? box.value.length;
    const end = box.selectionEnd ?? start;
    caret.current = { box, at: start + sign.length };
    set(box.value.slice(0, start) + sign + box.value.slice(end));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // The editor usually sits in a form or a dialog: Enter must not submit the
    // card and Escape must not close the dialog with the card unsaved.
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  const box =
    "h-8 w-full rounded-md border border-input bg-background px-2 text-center font-mono text-sm outline-none focus:border-ring";

  return (
    <div
      className="flex flex-wrap items-center gap-4 border-b border-border bg-muted/40 px-3 py-3"
      onKeyDown={onKeyDown}
    >
      <div className="flex w-44 flex-col gap-1">
        <input
          ref={topRef}
          value={top}
          onChange={(e) => setTop(e.target.value)}
          onFocus={() => (lastBox.current = "top")}
          placeholder="top"
          aria-label="Top of the fraction"
          className={box}
        />
        <div className="h-px bg-foreground/60" />
        <input
          ref={bottomRef}
          value={bottom}
          onChange={(e) => setBottom(e.target.value)}
          onFocus={() => (lastBox.current = "bottom")}
          placeholder="bottom"
          aria-label="Bottom of the fraction"
          className={box}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-1">
          {SIGNS.map((s) => (
            <button
              key={s.insert}
              type="button"
              title={s.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addSign(s.insert)}
              className="inline-flex h-7 min-w-7 items-center justify-center rounded border border-border bg-background px-1.5 text-sm hover:bg-muted"
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={brackets}
            onChange={(e) => setBrackets(e.target.checked)}
          />
          Brackets round it
        </label>
      </div>

      <div
        className="min-w-16 text-lg"
        aria-label="Preview"
        dangerouslySetInnerHTML={{ __html: ready ? preview : "" }}
      />

      <div className="ml-auto flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!ready}
          className="h-7 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {draft.pos === undefined ? "Insert" : "Update"}
        </button>
      </div>
    </div>
  );
}
