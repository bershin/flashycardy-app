"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";

interface DeckSearchControlProps {
  query: string;
  onChange: (query: string) => void;
}

/**
 * Search, collapsed to an icon until you want it.
 *
 * A permanent full-width field made searching look like the main thing you do
 * here, when mostly you just open a deck. It expands on click and collapses
 * again when left empty, so it costs one icon's worth of space at rest.
 */
export function DeckSearchControl({ query, onChange }: DeckSearchControlProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A non-empty query has to keep it open, otherwise restoring a search would
  // filter the list with no visible reason why.
  const expanded = open || query.length > 0;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!expanded) {
    return (
      <button
        type="button"
        aria-label="Search decks and cards"
        onClick={() => setOpen(true)}
        className={buttonVariants({ variant: "outline", size: "icon" })}
      >
        <Search className="size-4" />
      </button>
    );
  }

  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="Search decks and cards…"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (query.length === 0) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            setOpen(false);
          }
        }}
        className="h-9 pr-9 pl-9"
      />
      {query.length > 0 && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
