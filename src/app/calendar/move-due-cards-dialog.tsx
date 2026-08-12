"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rescheduleCardsAction } from "@/app/deck/actions";

/** A card as this dialog needs it: an id, and how settled it is. */
export type MovableCard = {
  id: number;
  streak: number;
};

interface MoveDueCardsDialogProps {
  /** What the cards are, for the dialog's own description. */
  deckLabel: string;
  /** The day they are being moved off, `YYYY-MM-DD`. */
  fromKey: string;
  fromLabel: string;
  cards: MovableCard[];
  /** Pre-filled destination — the lightest day soon after `fromKey`. */
  suggestedKey: string;
  /** How many cards a day already holds, for the before/after line. */
  countOn: (key: string) => number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved?: () => void;
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function label(key: string): string {
  return parseKey(key).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function shift(key: string, days: number): string {
  const date = parseKey(key);
  date.setDate(date.getDate() + days);
  return ymd(date);
}

export function MoveDueCardsDialog({
  deckLabel,
  fromKey,
  fromLabel,
  cards,
  suggestedKey,
  countOn,
  open,
  onOpenChange,
  onMoved,
}: MoveDueCardsDialogProps) {
  const total = cards.length;
  // Half is the useful default: this is load-levelling, and moving everything
  // just relocates the spike rather than flattening it.
  const [count, setCount] = useState(Math.ceil(total / 2));
  const [target, setTarget] = useState(suggestedKey);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const clamped = Math.min(Math.max(count, 1), total);
  const movingToItself = target === fromKey;
  const before = countOn(target);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (movingToItself) {
      setError("Pick a different day.");
      return;
    }

    // The most settled cards travel first: a card answered correctly many times
    // is the safest one to see later, while a card still being learned is the
    // one that most needs its date kept.
    const ids = [...cards]
      .sort((a, b) => b.streak - a.streak || a.id - b.id)
      .slice(0, clamped)
      .map((c) => c.id);

    startTransition(async () => {
      try {
        await rescheduleCardsAction({ cardIds: ids, date: target });
        onMoved?.();
        onOpenChange(false);
      } catch {
        setError("Couldn't move those cards. Please try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Move cards to another day</DialogTitle>
            <DialogDescription>
              {deckLabel} — {total} card{total === 1 ? "" : "s"} due {fromLabel}.
              Their streaks and decks stay as they are; only the review date
              changes.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="move-count">How many</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="move-count"
                  type="number"
                  min={1}
                  max={total}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  disabled={isPending}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  of {total}, most settled first
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="move-date">Move to</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="move-date"
                  type="date"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={isPending}
                  className="w-44"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setTarget((t) => shift(t, 1))}
                >
                  +1d
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setTarget((t) => shift(t, 7))}
                >
                  +1w
                </Button>
              </div>
            </div>

            {/* The whole point of the move is the resulting shape of the two
                days, so it is stated rather than left to be discovered. */}
            {!movingToItself && target && (
              <p className="text-sm text-muted-foreground">
                {label(fromKey)}: {countOn(fromKey)} →{" "}
                <strong className="text-foreground">
                  {countOn(fromKey) - clamped}
                </strong>
                {" · "}
                {label(target)}: {before} →{" "}
                <strong className="text-foreground">{before + clamped}</strong>
              </p>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || movingToItself}>
              {isPending
                ? "Moving…"
                : `Move ${clamped} card${clamped === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
