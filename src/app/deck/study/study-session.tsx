"use client";

import { useState, useCallback, useEffect, useMemo, useTransition } from "react";
import {
  ArrowLeft,
  RotateCcw,
  Shuffle,
  Check,
  X,
  Trophy,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { clearSession, saveSession } from "@/lib/study-session-store";
import { rateCardAction, markDeckStudiedAction } from "./actions";

interface StudyCard {
  id: number;
  front: string;
  back: string;
}

interface StudySessionProps {
  /** The full set this session started from — drives "review missed cards". */
  cards: StudyCard[];
  deckId: number;
  /** Working order when resuming; defaults to `cards`. */
  initialOrder?: StudyCard[];
  initialIndex?: number;
  initialRatings?: Array<[number, Rating]>;
  initialRound?: number;
}

type Rating = "got_it" | "missed";

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function StudySession({
  cards,
  deckId,
  initialOrder,
  initialIndex = 0,
  initialRatings,
  initialRound = 1,
}: StudySessionProps) {
  const [studyCards, setStudyCards] = useState(initialOrder ?? cards);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [flipped, setFlipped] = useState(false);
  const [finished, setFinished] = useState(false);
  const [ratings, setRatings] = useState<Map<number, Rating>>(
    () => new Map(initialRatings ?? []),
  );
  const [round, setRound] = useState(initialRound);
  const [isPending, startTransition] = useTransition();

  const current = studyCards[currentIndex];
  const total = studyCards.length;

  const gotItCount = useMemo(
    () => [...ratings.values()].filter((r) => r === "got_it").length,
    [ratings],
  );
  const missedCount = useMemo(
    () => [...ratings.values()].filter((r) => r === "missed").length,
    [ratings],
  );
  const missedCards = useMemo(
    () => cards.filter((c) => ratings.get(c.id) === "missed"),
    [cards, ratings],
  );

  const flip = useCallback(() => setFlipped((f) => !f), []);

  const rate = useCallback(
    (rating: Rating) => {
      setRatings((prev) => {
        const next = new Map(prev);
        next.set(current.id, rating);
        return next;
      });

      startTransition(async () => {
        await rateCardAction({ cardId: current.id, deckId, rating });
      });

      if (currentIndex < total - 1) {
        setFlipped(false);
        setCurrentIndex((i) => i + 1);
      } else {
        setFinished(true);
      }
    },
    [current, currentIndex, total, deckId],
  );

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setFlipped(false);
    }
  }, [currentIndex]);

  const restart = useCallback(() => {
    setStudyCards(cards);
    setCurrentIndex(0);
    setFlipped(false);
    setFinished(false);
    setRatings(new Map());
    setRound(1);
  }, [cards]);

  const shuffleAndRestart = useCallback(() => {
    setStudyCards(shuffleArray(cards));
    setCurrentIndex(0);
    setFlipped(false);
    setFinished(false);
    setRatings(new Map());
    setRound(1);
  }, [cards]);

  const reviewMissed = useCallback(() => {
    setStudyCards(shuffleArray(missedCards));
    setCurrentIndex(0);
    setFlipped(false);
    setFinished(false);
    setRatings(new Map());
    setRound((r) => r + 1);
  }, [missedCards]);

  const shuffleCurrent = useCallback(() => {
    const unrated = studyCards.slice(currentIndex);
    const rated = studyCards.slice(0, currentIndex);
    setStudyCards([...rated, ...shuffleArray(unrated)]);
  }, [studyCards, currentIndex]);

  useEffect(() => {
    if (finished && round === 1) {
      markDeckStudiedAction(deckId);
    }
  }, [finished, round, deckId]);

  /**
   * Mirror the session position so a crash or a closed tab can pick it back up.
   *
   * Nothing is written until there is something worth restoring, otherwise
   * merely opening a deck and walking away would leave a resume prompt behind
   * for a session with no progress in it.
   */
  const hasProgress = currentIndex > 0 || ratings.size > 0 || round > 1;
  useEffect(() => {
    if (finished) {
      clearSession(deckId);
      return;
    }
    if (!hasProgress) return;

    saveSession({
      deckId,
      sourceCardIds: cards.map((c) => c.id),
      cardIds: studyCards.map((c) => c.id),
      currentIndex,
      ratings: [...ratings.entries()],
      round,
      savedAt: new Date().toISOString(),
    });
  }, [
    finished,
    hasProgress,
    deckId,
    cards,
    studyCards,
    currentIndex,
    ratings,
    round,
  ]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (!finished && !flipped) flip();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (!finished && !flipped) goPrev();
          break;
        case "1":
          if (!finished && flipped) {
            e.preventDefault();
            rate("missed");
          }
          break;
        case "2":
          if (!finished && flipped) {
            e.preventDefault();
            rate("got_it");
          }
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flip, goPrev, rate, finished, flipped]);

  if (finished) {
    const scorePercent =
      total > 0 ? Math.round((gotItCount / total) * 100) : 0;

    return (
      <div className="mt-10 flex flex-col items-center gap-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <Trophy className="size-8 text-primary" />
        </div>

        <div>
          <h2 className="text-xl font-semibold">
            {round > 1 ? `Round ${round} Complete` : "Session Complete"}
          </h2>
          <p className="mt-1 text-muted-foreground">
            You reviewed {total} card{total === 1 ? "" : "s"}.
          </p>
        </div>

        {/* Score breakdown */}
        <div className="flex w-full max-w-xs gap-4">
          <div className="flex flex-1 flex-col items-center gap-1 rounded-xl bg-emerald-500/10 p-4">
            <Check className="size-5 text-emerald-500" />
            <span className="text-2xl font-bold text-emerald-500">
              {gotItCount}
            </span>
            <span className="text-xs text-muted-foreground">Got it</span>
          </div>
          <div className="flex flex-1 flex-col items-center gap-1 rounded-xl bg-red-500/10 p-4">
            <X className="size-5 text-red-500" />
            <span className="text-2xl font-bold text-red-500">
              {missedCount}
            </span>
            <span className="text-xs text-muted-foreground">Missed</span>
          </div>
        </div>

        {/* Score bar */}
        <div className="w-full max-w-xs">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Score</span>
            <span className="font-medium">{scorePercent}%</span>
          </div>
          <div className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            {gotItCount > 0 && (
              <div
                className="h-full bg-emerald-500 transition-all duration-500"
                style={{
                  width: `${scorePercent}%`,
                }}
              />
            )}
            {missedCount > 0 && (
              <div
                className="h-full bg-red-500 transition-all duration-500"
                style={{
                  width: `${100 - scorePercent}%`,
                }}
              />
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap justify-center gap-3">
          {missedCards.length > 0 && (
            <Button onClick={reviewMissed}>
              <BookOpen className="size-4" />
              Review {missedCards.length} Missed Card
              {missedCards.length === 1 ? "" : "s"}
            </Button>
          )}
          <Button variant="outline" onClick={restart}>
            <RotateCcw className="size-4" />
            Start Over
          </Button>
          <Button variant="outline" onClick={shuffleAndRestart}>
            <Shuffle className="size-4" />
            Shuffle &amp; Restart
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
      {/* Progress header */}
      <div className="flex w-full items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Card {currentIndex + 1} of {total}
          {round > 1 && (
            <span className="ml-2 text-xs">(Round {round})</span>
          )}
        </p>
        <div className="flex items-center gap-3">
          {gotItCount + missedCount > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-0.5 text-emerald-500">
                <Check className="size-3" />
                {gotItCount}
              </span>
              <span className="flex items-center gap-0.5 text-red-500">
                <X className="size-3" />
                {missedCount}
              </span>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={shuffleCurrent}>
            <Shuffle className="size-3.5" />
            Shuffle
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{
            width: `${Math.round(((currentIndex + 1) / total) * 100)}%`,
          }}
        />
      </div>

      {/* Flashcard */}
      <div
        className={`grid min-h-0 w-full flex-1 gap-3 ${flipped ? "md:grid-cols-2" : ""}`}
      >
        {/* Question */}
        <Card
          role={flipped ? undefined : "button"}
          tabIndex={flipped ? undefined : 0}
          onClick={flipped ? undefined : flip}
          onKeyDown={
            flipped
              ? undefined
              : (e) => {
                  if (e.key === "Enter") flip();
                }
          }
          className={`min-h-0 ${flipped ? "" : "cursor-pointer"}`}
        >
          <CardContent className="flex h-full flex-col items-center justify-center overflow-y-auto p-6">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Question
            </p>
            <div
              className="rich-content w-full text-left text-lg leading-relaxed md:text-xl"
              dangerouslySetInnerHTML={{ __html: current.front }}
            />
            {!flipped && (
              <p className="mt-4 text-xs text-muted-foreground">
                Click or press{" "}
                <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[0.7rem]">
                  Space
                </kbd>{" "}
                to reveal answer
              </p>
            )}
          </CardContent>
        </Card>

        {/* Answer */}
        {flipped && (
          <Card className="min-h-0 border-primary/30 bg-primary/5">
            <CardContent className="flex h-full flex-col items-center justify-center overflow-y-auto p-6">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Answer
              </p>
              <div
                className="rich-content w-full text-left text-lg leading-relaxed md:text-xl"
                dangerouslySetInnerHTML={{ __html: current.back }}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Rating / Navigation */}
      {flipped ? (
        <div className="flex shrink-0 flex-col items-center gap-2">
          <p className="text-sm text-muted-foreground">How did you do?</p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => rate("missed")}
              disabled={isPending}
              className="border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-500"
            >
              <X className="size-4" />
              Missed
            </Button>
            <Button
              variant="outline"
              onClick={() => rate("got_it")}
              disabled={isPending}
              className="border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-500"
            >
              <Check className="size-4" />
              Got it
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Press{" "}
            <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[0.7rem]">
              1
            </kbd>{" "}
            for Missed or{" "}
            <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[0.7rem]">
              2
            </kbd>{" "}
            for Got it
          </p>
        </div>
      ) : (
        <div className="flex shrink-0 flex-col items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={currentIndex === 0}
          >
            <ArrowLeft className="size-4" />
            Previous
          </Button>
          <p className="text-xs text-muted-foreground">
            Use{" "}
            <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[0.7rem]">
              &larr;
            </kbd>{" "}
            to go back
          </p>
        </div>
      )}
    </div>
  );
}
