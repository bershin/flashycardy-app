"use client";

import { useRef, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { addDayTodoAction } from "@/app/calendar/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AddTodoProps {
  /** The day it lands on, `YYYY-MM-DD`. */
  date: string;
  /** What the closed control reads. Name the day: it is not always today. */
  label: string;
  placeholder: string;
  className?: string;
}

/**
 * A one-line way to put something on a day, from wherever you happen to be.
 *
 * Folded away until asked for. The thought worth writing down usually arrives
 * while you are looking at something else — a deck, the dashboard — and a field
 * sitting permanently open on those pages would be clutter for the ninety-nine
 * times out of a hundred that nothing is being added.
 */
export function AddTodo({ date, label, placeholder, className }: AddTodoProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, startWriting] = useTransition();
  const [saved, setSaved] = useState(0);
  const field = useRef<HTMLInputElement>(null);

  function add() {
    if (!draft.trim()) return;
    const text = draft;
    setDraft("");
    startWriting(async () => {
      await addDayTodoAction({ date, text });
      setSaved((n) => n + 1);
      // Focus is kept so a second thought can follow the first.
      field.current?.focus();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground ${className ?? ""}`}
      >
        <Plus className="size-3.5" />
        {label}
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Input
        ref={field}
        value={draft}
        autoFocus
        maxLength={500}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        // Folds away when left empty, rather than sitting open for the rest of
        // the session on a page that is not about to-do lists.
        onBlur={() => !draft.trim() && setOpen(false)}
        className="h-8 max-w-md text-sm"
      />
      <Button size="sm" className="h-8" disabled={pending || !draft.trim()} onClick={add}>
        <Plus className="size-3.5" />
        Add
      </Button>
      {/* Said out loud, because this control is nowhere near the list it
          writes to — without it the words simply vanish from the box. */}
      {saved > 0 && (
        <span role="status" className="text-xs text-muted-foreground">
          {saved === 1 ? "Added to your list" : `${saved} added to your list`}
        </span>
      )}
    </div>
  );
}
