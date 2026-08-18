"use client";

import { useRef, useState } from "react";
import { Dices, Check, X, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  proposeGeneratedCardAction,
  updateCardAction,
} from "@/app/deck/actions";
import type { CardRow } from "@/lib/store/types";

type Outcome =
  | { kind: "converted"; card: CardRow; summary: string }
  | { kind: "needs-reading"; card: CardRow; summary: string }
  | { kind: "declined"; card: CardRow; summary: string };

interface VaryDeckDialogProps {
  cards: CardRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Cards are read one at a time so the run can be watched, and stopped. */
const BATCH_PAUSE_MS = 250;

/**
 * Template a whole deck, a card at a time.
 *
 * Only templates that pass the arithmetic check are saved: fed the card's own
 * numbers, the formula must produce the card's own answer. That catches the
 * failure this feature is most exposed to — a plausible but inverted formula,
 * which would otherwise generate convincing questions with wrong answers
 * forever.
 *
 * Everything else is left exactly as it was, and listed. A template that could
 * not be checked is not wrong, but nothing unread gets saved on a card's behalf
 * at this scale.
 */
export function VaryDeckDialog({ cards, open, onOpenChange }: VaryDeckDialogProps) {
  const fixed = cards.filter((c) => c.type !== "generated");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const stopped = useRef(false);

  async function run() {
    stopped.current = false;
    setRunning(true);
    setOutcomes([]);
    setDone(0);

    for (const card of fixed) {
      if (stopped.current) break;
      try {
        const { payload, verified } = await proposeGeneratedCardAction(card.id);
        if (verified === true) {
          await updateCardAction({
            cardId: card.id,
            type: "generated",
            front: card.front,
            back: card.back,
            schedule: card.schedule,
            generated: payload,
          });
          setOutcomes((list) => [
            ...list,
            { kind: "converted", card, summary: payload.template },
          ]);
        } else {
          setOutcomes((list) => [
            ...list,
            {
              kind: "needs-reading",
              card,
              summary:
                verified === false
                  ? "the formula disagreed with the card's own answer"
                  : "nothing to check the formula against",
            },
          ]);
        }
      } catch (error) {
        setOutcomes((list) => [
          ...list,
          {
            kind: "declined",
            card,
            summary:
              error instanceof Error ? error.message : "couldn't be templated",
          },
        ]);
      }
      setDone((n) => n + 1);
      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    }

    setRunning(false);
  }

  const converted = outcomes.filter((o) => o.kind === "converted").length;
  const needsReading = outcomes.filter((o) => o.kind === "needs-reading").length;
  const declined = outcomes.filter((o) => o.kind === "declined").length;

  return (
    <Dialog open={open} onOpenChange={running ? () => {} : onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Make the whole deck vary</DialogTitle>
          <DialogDescription>
            {fixed.length} card{fixed.length === 1 ? "" : "s"} to read, one model
            call each. Only templates that reproduce the card&rsquo;s own answer
            are saved; anything else is left alone and listed for you to look at.
          </DialogDescription>
        </DialogHeader>

        {(running || outcomes.length > 0) && (
          <div className="mt-2 grid gap-3">
            <div className="flex items-center gap-3 text-sm">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${(done / Math.max(1, fixed.length)) * 100}%` }}
                />
              </div>
              <span className="tabular-nums text-muted-foreground">
                {done} / {fixed.length}
              </span>
            </div>

            <div className="flex flex-wrap gap-3 text-xs">
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                <Check className="size-3.5" /> {converted} converted
              </span>
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <CircleAlert className="size-3.5" /> {needsReading} need reading
              </span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <X className="size-3.5" /> {declined} declined
              </span>
            </div>

            <ul className="grid max-h-72 gap-1 overflow-y-auto text-xs">
              {[...outcomes].reverse().map((outcome, index) => (
                <li
                  key={index}
                  className="flex gap-2 rounded-md border px-2 py-1.5"
                >
                  <span className="shrink-0">
                    {outcome.kind === "converted" && (
                      <Check className="size-3.5 text-emerald-600" />
                    )}
                    {outcome.kind === "needs-reading" && (
                      <CircleAlert className="size-3.5 text-amber-600" />
                    )}
                    {outcome.kind === "declined" && (
                      <X className="size-3.5 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {outcome.summary}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="mt-4">
          {running ? (
            <Button
              variant="outline"
              onClick={() => {
                stopped.current = true;
              }}
            >
              Stop after this card
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {outcomes.length > 0 ? "Close" : "Cancel"}
              </Button>
              <Button onClick={run} disabled={fixed.length === 0}>
                <Dices className="size-4" />
                {outcomes.length > 0 ? "Run again" : `Read ${fixed.length} cards`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
