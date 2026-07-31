"use client";

import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { hasOpenAIKey } from "@/lib/settings";
import { gradeVocab, NoKeyError, type VocabVerdict } from "@/lib/grade-vocab";
import type { CardRow } from "@/lib/store/types";

interface VocabAnswerProps {
  card: CardRow;
  onResolved: (rating: "got_it" | "missed") => void;
}

/**
 * A vocabulary card: give synonyms and use the word in a sentence, and the AI
 * judges both.
 *
 * The verdict is applied but never final — the Got it / Missed buttons stay
 * live underneath the feedback so a wrong call can be corrected. If there is no
 * key or no connection, this degrades to plain self-rating rather than blocking
 * the session.
 */
export function VocabAnswer({ card, onResolved }: VocabAnswerProps) {
  const [synonyms, setSynonyms] = useState("");
  const [sentence, setSentence] = useState("");
  const [verdict, setVerdict] = useState<VocabVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);
  const [canGrade] = useState(() => hasOpenAIKey());

  async function submit() {
    setError(null);
    setGrading(true);
    try {
      setVerdict(
        await gradeVocab({
          word: card.front,
          senseHint: card.vocab?.senseHint,
          synonyms,
          sentence,
        }),
      );
    } catch (e) {
      setError(
        e instanceof NoKeyError
          ? "Add an OpenAI key in Settings to have this graded for you."
          : e instanceof Error
            ? e.message
            : "Grading failed.",
      );
    }
    setGrading(false);
  }

  const answered = verdict !== null;
  const canSubmit =
    !grading && !answered && (synonyms.trim() !== "" || sentence.trim() !== "");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <div className="grid gap-2">
        <Label htmlFor="synonyms">Synonyms</Label>
        <Textarea
          id="synonyms"
          rows={2}
          value={synonyms}
          disabled={answered || grading}
          placeholder="Words that mean roughly the same…"
          onChange={(e) => setSynonyms(e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="sentence">Use it in a sentence</Label>
        <Textarea
          id="sentence"
          rows={3}
          value={sentence}
          disabled={answered || grading}
          placeholder="Write a sentence using the word…"
          onChange={(e) => setSentence(e.target.value)}
        />
      </div>

      {!answered && canGrade && (
        <div className="flex justify-center">
          <Button size="lg" onClick={submit} disabled={!canSubmit}>
            <Sparkles className="size-4" />
            {grading ? "Checking…" : "Check my answer"}
          </Button>
        </div>
      )}

      {!canGrade && (
        <p className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
          No OpenAI key set, so this can&rsquo;t be graded automatically. Add one
          in Settings, or rate yourself below.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          {error} You can still rate yourself below.
        </p>
      )}

      {verdict && (
        <div
          className={`rounded-xl border p-4 ${
            verdict.correct
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-red-500/40 bg-red-500/10"
          }`}
        >
          <p
            className={`flex items-center gap-2 font-medium ${
              verdict.correct
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {verdict.correct ? (
              <Check className="size-4" />
            ) : (
              <X className="size-4" />
            )}
            {verdict.correct ? "Got it" : "Not quite"}
          </p>
          <p className="mt-2 text-sm">{verdict.feedback}</p>
          {verdict.suggestion && (
            <p className="mt-2 text-sm text-muted-foreground">
              Better: {verdict.suggestion}
            </p>
          )}
          <div className="mt-4 flex justify-center">
            <Button
              size="lg"
              onClick={() => onResolved(verdict.correct ? "got_it" : "missed")}
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {card.back.replace(/<[^>]*>/g, "").trim().length > 0 && answered && (
        <div
          className="rich-content rounded-lg border bg-muted/50 p-3 text-sm"
          dangerouslySetInnerHTML={{ __html: card.back }}
        />
      )}
    </div>
  );
}
