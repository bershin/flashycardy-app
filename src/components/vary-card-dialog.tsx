"use client";

import { useState, useTransition } from "react";
import { Wand2 } from "lucide-react";
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
  rollGenerated,
  type GeneratedInstance,
  type GeneratedPayload,
} from "@/lib/generated-card";
import {
  proposeGeneratedCardAction,
  updateCardAction,
} from "@/app/deck/actions";
import type { CardRow } from "@/lib/store/types";

/**
 * A message a person can read.
 *
 * A schema rejection arrives as its own JSON — `[{"code":"custom","path":…}]` —
 * which is a debugging artefact, not an explanation, and it was being printed
 * into the dialog verbatim.
 */
function readable(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.trim().startsWith("[") || raw.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Array<{ message?: string }>;
      const first = Array.isArray(parsed) ? parsed[0]?.message : undefined;
      if (first) return first;
    } catch {
      /* not a schema error after all */
    }
    return fallback;
  }
  return raw || fallback;
}

interface VaryCardDialogProps {
  card: CardRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Turn one fixed question into a question that rolls its own numbers.
 *
 * The proposal is always shown before it is saved, with three rolls of it. A
 * template that is subtly wrong produces plausible questions with wrong answers
 * forever — far worse than the card it replaced — and three worked examples is
 * the cheapest way to catch that.
 */
export function VaryCardDialog({ card, open, onOpenChange }: VaryCardDialogProps) {
  const [payload, setPayload] = useState<GeneratedPayload | null>(null);
  const [samples, setSamples] = useState<GeneratedInstance[]>([]);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [saving, startSaving] = useTransition();

  function propose() {
    setError(null);
    startTransition(async () => {
      try {
        const proposed = await proposeGeneratedCardAction(card.id);
        setPayload(proposed.payload);
        setVerified(proposed.verified);
        setSamples(reroll(proposed.payload));
      } catch (e) {
        setError(readable(e, "Couldn't build a template."));
      }
    });
  }

  function reroll(source: GeneratedPayload): GeneratedInstance[] {
    const rolls: GeneratedInstance[] = [];
    for (let i = 0; i < 3; i++) {
      try {
        rolls.push(rollGenerated(source));
      } catch {
        /* a template that runs dry after one roll shows what it managed */
      }
    }
    return rolls;
  }

  function save() {
    if (!payload) return;
    setError(null);
    startSaving(async () => {
      try {
        await updateCardAction({
          cardId: card.id,
          type: "generated",
          front: card.front,
          back: card.back,
          schedule: card.schedule,
          generated: payload,
        });
        onOpenChange(false);
      } catch (e) {
        setError(readable(e, "Couldn't save the card."));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Make this card vary</DialogTitle>
          <DialogDescription>
            The numbers change every time the card comes up, so it has to be
            worked out rather than remembered. Check the examples before saving —
            a template is used forever, mistakes included.
          </DialogDescription>
        </DialogHeader>

        {!payload && (
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={propose} disabled={isPending}>
              <Wand2 className="size-4" />
              {isPending
                ? "Reading the card…"
                : error
                  ? "Try again"
                  : "Build a template"}
            </Button>
          </div>
        )}

        {payload && (
          <div className="mt-2 grid gap-4">
            <div className="grid gap-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{payload.template}</p>
              <p className="text-xs text-muted-foreground">
                {payload.variables
                  .map((v) => `${v.name} = ${v.min}–${v.max}`)
                  .join(" · ")}
                {payload.constraint ? ` · where ${payload.constraint}` : ""}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                answer = {payload.answer}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                wrong = {payload.distractors.join(" , ")}
              </p>
            </div>

            {verified === true && (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-800 dark:text-emerald-300">
                Checked: fed this card&rsquo;s own numbers, the template gives
                this card&rsquo;s own answer.
              </p>
            )}
            {verified === null && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
                Not checked against the original card — read the examples
                carefully.
              </p>
            )}

            <div className="grid gap-3">
              {samples.map((sample, index) => (
                <div key={index} className="rounded-lg border p-3 text-sm">
                  <p>{sample.question}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {sample.options.map((option, i) => (
                      <span
                        key={i}
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          i === sample.correctIndex
                            ? "bg-emerald-500/15 font-medium text-emerald-700 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {option}
                      </span>
                    ))}
                  </div>
                  {sample.explanation && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {sample.explanation}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSamples(reroll(payload))}
              >
                Show three more
              </Button>
            </div>
          </div>
        )}

        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!payload || saving}>
            {saving ? "Saving…" : "Use this template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
