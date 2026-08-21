"use client";

import { useState, useTransition } from "react";
import { NotebookPen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DayNoteEditorProps {
  /** The day this note belongs to, `YYYY-MM-DD`. */
  date: string;
  note: string | undefined;
  onSave: (text: string) => Promise<unknown>;
}

/**
 * The note written against one day.
 *
 * Closed until there is something to show or somebody asks for it: the panel's
 * job is the day's cards, and a permanently open text box would push them down
 * for the sake of a field that is usually empty.
 */
export function DayNoteEditor({ date, note, onSave }: DayNoteEditorProps) {
  const [open, setOpen] = useState(Boolean(note));
  const [text, setText] = useState(note ?? "");
  const [saving, startSaving] = useTransition();
  const [saved, setSaved] = useState(false);

  // A different day is a different note; the editor is remounted per day by its
  // key, so this only ever runs for the day it belongs to.
  function commit() {
    startSaving(async () => {
      await onSave(text);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <NotebookPen className="size-3.5" />
        Add a note for this day
      </button>
    );
  }

  return (
    <div className="mt-3 grid gap-2">
      <label htmlFor={`note-${date}`} className="sr-only">
        Note for this day
      </label>
      <textarea
        id={`note-${date}`}
        value={text}
        rows={2}
        maxLength={500}
        placeholder="Mock exam, away until Thursday, revise fractions…"
        onChange={(e) => setText(e.target.value)}
        // Saved on the way out rather than on every keystroke: each save is a
        // document write and a sync push.
        onBlur={() => text !== (note ?? "") && commit()}
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={commit} disabled={saving}>
          {saving ? "Saving…" : saved ? "Saved" : "Save note"}
        </Button>
        {note && (
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setText("");
              startSaving(async () => {
                await onSave("");
                setOpen(false);
              });
            }}
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {text.length}/500
        </span>
      </div>
    </div>
  );
}
