"use client";

import { useCallback, useState, useTransition } from "react";
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
import { parseSpellingSheet, spellingBackHtml } from "@/lib/spelling-sheet";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectCardsByDeckForUser } from "@/lib/store/selectors";
import { updateCardAction } from "@/app/deck/actions";
import type { CardRow, DbDoc } from "@/lib/store/types";
import { NEW_CARD_SCHEDULE } from "@/lib/store/types";

type Draft = {
  word: string;
  options: string[];
  correctIndex: number;
  back: string;
  /** Set when this deck already has a spelling card for the word. */
  existing?: CardRow;
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
  /**
   * Spelling cards already here, by the word they ask about.
   *
   * A card's answer is the word, so that is the key. Pasting the sheet a second
   * time should improve the cards that exist rather than making a second copy
   * of every one of them.
   */
  const existing = useStore(
    useCallback(
      (db: DbDoc) => {
        const byWord = new Map<string, CardRow>();
        for (const card of selectCardsByDeckForUser(
          db,
          deckId,
          LOCAL_USER_ID,
        )) {
          const answer = card.quiz?.options[card.quiz.correctIndex];
          if (card.type === "quiz" && answer) {
            byWord.set(answer.trim().toLowerCase(), card);
          }
        }
        return byWord;
      },
      [deckId],
    ),
  );
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [saving, startSaving] = useTransition();
  const [saved, setSaved] = useState<number | null>(null);

  function build() {
    const entries = parseSpellingSheet(words);
    const seen = new Set<string>();
    const made: Draft[] = [];
    const failed: string[] = [];

    for (const entry of entries) {
      const key = entry.word.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const already = existing.get(key);
      const back = spellingBackHtml(entry);

      // A card already here only needs its answer rewritten — its options are
      // already in use and re-rolling them would throw away a history of which
      // misspelling actually catches you out.
      if (already) {
        made.push({
          word: entry.word,
          // Kept as they are: the options are already in use, and re-rolling
          // them would discard a record of which misspelling actually catches
          // this person out.
          options: already.quiz!.options,
          correctIndex: already.quiz!.correctIndex,
          back,
          existing: already,
        });
        continue;
      }

      const result = spellingOptions(entry.word);
      // Fewer than two options is not a question. Short or very regular words
      // simply have no convincing misspelling, and saying so beats inventing
      // one that gives the answer away.
      if (!result || result.options.length < 2) failed.push(entry.word);
      else made.push({ word: entry.word, ...result, back });
    }
    setDrafts(made);
    setRejected(failed);
  }

  function reroll(index: number) {
    setDrafts((current) => {
      if (!current) return current;
      const next = [...current];
      const result = spellingOptions(next[index].word);
      if (result) next[index] = { ...next[index], ...result };
      return next;
    });
  }

  function save() {
    if (!drafts?.length) return;
    startSaving(async () => {
      for (const draft of drafts) {
        if (draft.existing) {
          await updateCardAction({
            cardId: draft.existing.id,
            type: "quiz",
            front: draft.existing.front,
            back: draft.back,
            schedule: draft.existing.schedule,
            quiz: {
              options: draft.existing.quiz!.options,
              correctIndex: draft.existing.quiz!.correctIndex,
            },
          });
          continue;
        }
        await addCardAction({
          deckId,
          type: "quiz",
          front: "<p>Which spelling is correct?</p>",
          back: draft.back,
          schedule: NEW_CARD_SCHEDULE,
          quiz: { options: draft.options, correctIndex: draft.correctIndex },
        });
      }
      setSaved(drafts.length);
      setDrafts(null);
      setWords("");
    });
  }

  /**
   * Closing puts it back to an empty sheet.
   *
   * Without this it reopened still showing "Added 2 cards" with no way back to
   * the box — the component is mounted by its parent and never unmounts, so
   * nothing else clears what the last run left behind.
   */
  function change(next: boolean) {
    if (!next) {
      setWords("");
      setDrafts(null);
      setRejected([]);
      setSaved(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Spelling cards</DialogTitle>
          <DialogDescription>
            A word per line, or paste a sheet with meaning, sentence and tip
            columns. New words become multiple-choice questions; words already
            here keep their options and have their answer rewritten.
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
                value={words}
                rows={5}
                placeholder={
                  "necessary\nseparate\n\nor paste the sheet:\nWord\tMeaning\tSentence\tTip"
                }
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
                      <span className="flex items-center gap-2">
                        <strong className="text-sm">{draft.word}</strong>
                        {draft.existing && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[0.7rem] text-muted-foreground">
                            updating — options kept
                          </span>
                        )}
                      </span>
                      {!draft.existing && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reroll(index)}
                        >
                          <RefreshCw className="size-3.5" />
                          Again
                        </Button>
                      )}
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
              <Button
                variant="outline"
                onClick={build}
                disabled={!words.trim()}
              >
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
