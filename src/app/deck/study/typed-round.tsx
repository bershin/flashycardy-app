"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OcclusionPicture } from "@/components/occlusion-picture";
import { checkTyped, type OcclusionPayload } from "@/lib/occlusion";

/**
 * A typed picture's round: every due word hidden at once, typed in any order.
 *
 * A right word opens its box; anything else says so and stays on the list of
 * tries, since on a spelling sheet the near miss is the thing worth seeing.
 * The round ends when every word is found or on "I'm done", and then each
 * word's card is graded — found is got it, not found is missed. Wrong tries
 * cost nothing in themselves: what is scored is whether the word turned up.
 */
export function TypedRound({
  html,
  occlusion,
  asked,
  previous,
  onFinished,
  onContinue,
}: {
  html: string;
  /** Any card's payload from the picture; the boxes are what matter. */
  occlusion: OcclusionPayload;
  /** The boxes whose cards are in this round. */
  asked: ReadonlySet<string>;
  /** The boxes found last time, when stepping back to a round already done. */
  previous?: ReadonlySet<string>;
  /** Called once, as the round ends, with the boxes that were found. */
  onFinished: (found: ReadonlySet<string>) => void;
  onContinue: () => void;
}) {
  const [found, setFound] = useState<ReadonlySet<string>>(
    () => previous ?? new Set(),
  );
  const [done, setDone] = useState(previous !== undefined);
  const [guess, setGuess] = useState("");
  const [tries, setTries] = useState<string[]>([]);
  const [said, setSaid] = useState<
    { tone: "right" | "wrong" | "again"; text: string; n: number } | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  const words = occlusion.boxes.filter((b) => asked.has(b.id));
  const missing = words.filter((b) => !found.has(b.id));

  // Straight into the box so typing can start at once, and onto Continue when
  // the round is over so Enter carries on to the next card.
  useEffect(() => {
    (done ? continueRef : inputRef).current?.focus({ preventScroll: true });
  }, [done]);

  function finish(next: ReadonlySet<string>) {
    setDone(true);
    onFinished(next);
  }

  function submit() {
    const text = guess.trim();
    if (!text || done) return;
    const result = checkTyped(occlusion.boxes, asked, found, text);
    setGuess("");
    const n = (said?.n ?? 0) + 1;
    if (result.kind === "found") {
      const next = new Set(found).add(result.boxId);
      setFound(next);
      setSaid({ tone: "right", text: `${text} — right!`, n });
      if (next.size === words.length) finish(next);
    } else if (result.kind === "again") {
      setSaid({ tone: "again", text: `${text} — already found`, n });
    } else if (result.kind === "showing") {
      // Right word, but not one being asked: its card is not due.
      setSaid({ tone: "again", text: `${text} — that one is showing`, n });
    } else {
      setTries((t) => [...t, text]);
      setSaid({ tone: "wrong", text: `${text} — wrong`, n });
    }
  }

  return (
    <div className="grid gap-3">
      <OcclusionPicture
        className="rich-content w-full text-left text-lg leading-relaxed md:text-xl"
        html={html}
        occlusion={occlusion}
        state="question"
        typed={{ asked, found, done }}
      />

      <p className="text-center text-sm text-muted-foreground">
        Found{" "}
        <span className="font-semibold text-foreground tabular-nums">
          {found.size} of {words.length}
        </span>
      </p>

      {!done ? (
        <form
          className="mx-auto flex w-full max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            ref={inputRef}
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            placeholder="Type a hidden word…"
            aria-label="Type a hidden word"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-10 text-base"
          />
          <Button type="submit" className="h-10" disabled={!guess.trim()}>
            Check
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={() => finish(found)}
          >
            I&apos;m done
          </Button>
        </form>
      ) : (
        <div className="mx-auto grid w-full max-w-md justify-items-center gap-2 text-center">
          {missing.length === 0 ? (
            <p className="font-semibold text-emerald-600 dark:text-emerald-400">
              Every word found!
            </p>
          ) : (
            <div className="grid gap-1">
              <p className="text-sm text-muted-foreground">
                Not found — {missing.length === 1 ? "this one comes" : "these come"}{" "}
                back sooner:
              </p>
              <p className="flex flex-wrap justify-center gap-1.5">
                {missing.map((b) => (
                  <span
                    key={b.id}
                    className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-0.5 font-semibold text-red-600 dark:text-red-400"
                  >
                    <X className="size-3.5" />
                    {b.label}
                  </span>
                ))}
              </p>
            </div>
          )}
          <Button ref={continueRef} onClick={onContinue} className="mt-1">
            Continue
          </Button>
        </div>
      )}

      {/* Keyed on each try so the same message twice still reads as new. */}
      {said && !done && (
        <p
          key={said.n}
          role="status"
          className={`animate-in fade-in text-center font-semibold duration-200 ${
            said.tone === "right"
              ? "text-emerald-600 dark:text-emerald-400"
              : said.tone === "wrong"
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground"
          }`}
        >
          {said.tone === "right" ? (
            <Check className="mr-1 inline size-4" />
          ) : said.tone === "wrong" ? (
            <X className="mr-1 inline size-4" />
          ) : null}
          {said.text}
        </p>
      )}

      {tries.length > 0 && (
        <p className="flex flex-wrap justify-center gap-1.5 text-sm">
          <span className="text-muted-foreground">Tried:</span>
          {tries.map((t, i) => (
            <span key={i} className="text-red-600 line-through dark:text-red-400">
              {t}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
