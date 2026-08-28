"use client";

import { useState, useTransition } from "react";
import { RefreshCw, SpellCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { addCardAction } from "@/app/deck/actions";
import { spellingOptions } from "@/lib/spelling-distractors";
import { NEW_CARD_SCHEDULE } from "@/lib/store/types";

type Draft = {
  word: string;
  options: string[];
  correctIndex: number;
};

/**
 * Spelling questions from a list of words.
 *
 * A word by itself is not a question — what makes one is three wrong spellings
 * close enough to hesitate over. Those are generated here (see
 * `spelling-distractors.ts`) rather than typed, because inventing convincing
 * misspellings for ninety words by hand is the reason nobody does it.
 *
 * Every draft is shown before anything is saved, and any of them can be rolled
 * again: the generator is good but not always right, and the wrong answers are
 * the whole substance of the card.
 */
export function SpellingCardDialog({
  deckId,
  open,
  onOpenChange,
}: {
  deckId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [words, setWords] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [saving, startSaving] = useTransition();
  const [saved, setSaved] = useState<number | null>(null);

  function build() {
    const list = [...new Set(
      words.split(/[\n,]/).map((w) => w.trim()).filter(Boolean),
    )];

    const made: Draft[] = [];
    const failed: string[] = [];
    for (const word of list) {
      const result = spellingOptions(word);
      // Fewer than two options is not a question. Short or very regular words
      // simply have no convincing misspelling, and saying so beats inventing
      // one that gives the answer away.
      if (!result || result.options.length < 2) failed.push(word);
      else made.push({ word, ...result });
    }
    setDrafts(made);
    setRejected(failed);
  }

  function reroll(index: number) {
    setDrafts((current) => {
      if (!current) return current;
      const next = [...current];
      const result = spellingOptions(next[index].word);
      if (result) next[index] = { word: next[index].word, ...result };
      return next;
    });
  }

  function save() {
    if (!drafts?.length) return;
    startSaving(async () => {
      for (const draft of drafts) {
        await addCardAction({
          deckId,
          type: "quiz",
          front: "<p>Which spelling is correct?</p>",
          back: `<p><strong>${draft.word}</strong></p>`,
          schedule: NEW_CARD_SCHEDULE,
          quiz: { options: draft.options, correctIndex: draft.correctIndex },
        });
      }
      setSaved(drafts.length);
      setDrafts(null);
      setWords("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Spelling cards</DialogTitle>
          <DialogDescription>
            A word per line. Each becomes a multiple-choice question with three
            plausible misspellings.
          </DialogDescription>
        </DialogHeader>

        {saved !== null ? (
          <p className="py-4 text-sm">
            Added {saved} card{saved === 1 ? "" : "s"}.
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="spelling-words">Words</Label>
              <textarea
                id="spelling-words"
                rows={4}
                value={words}
                placeholder={"necessary\nseparate\ndefinitely"}
                onChange={(e) => setWords(e.target.value)}
                className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none"
              />
            </div>

            {drafts && drafts.length > 0 && (
              <ul className="grid gap-2">
                {drafts.map((draft, index) => (
                  <li
                    key={draft.word}
                    className="rounded-lg border border-border/60 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-sm">{draft.word}</strong>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => reroll(index)}
                      >
                        <RefreshCw className="size-3.5" />
                        Again
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {draft.options.map((option, i) => (
                        <span
                          key={option}
                          className={`rounded px-2 py-0.5 text-xs ${
                            i === draft.correctIndex
                              ? "bg-emerald-500/15 font-medium text-emerald-700 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {option}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {rejected.length > 0 && (
              <p className="text-xs text-muted-foreground">
                No convincing misspelling for: {rejected.join(", ")}. Those are
                better written by hand.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {saved === null && (
            <>
              <Button variant="outline" onClick={build} disabled={!words.trim()}>
                <SpellCheck className="size-4" />
                {drafts ? "Rebuild" : "Generate"}
              </Button>
              <Button onClick={save} disabled={saving || !drafts?.length}>
                Add {drafts?.length ?? 0} card
                {drafts?.length === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
