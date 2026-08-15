"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  ArrowLeft,
  RotateCcw,
  Shuffle,
  Check,
  X,
  Trophy,
  BookOpen,
  Volume2,
  VolumeX,
  Pencil,
  Flame,
  XCircle,
} from "lucide-react";
import { EditCardDialog } from "@/components/edit-card-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { accentStyle } from "@/lib/deck-accent";
import { useStore } from "@/lib/store/use-store";
import type { CardRow, DbDoc } from "@/lib/store/types";
import { QuizAnswer } from "./quiz-answer";
import { clearSession, saveSession } from "@/lib/study-session-store";
import {
  isStudySoundEnabled,
  setStudySoundEnabled,
  studySoundServerSnapshot,
  subscribeStudySound,
} from "@/lib/settings";
import { previewStageChime } from "@/lib/study-chime";
import {
  STAGE_TEXT,
  formatDuration,
  stageForMs,
  spokenDuration,
} from "@/lib/study-timer";
import { CardTimer } from "./card-timer";
import { useCardTimer } from "./use-card-timer";
import { rateCardAction, markDeckStudiedAction } from "./actions";

/** Study needs the whole card now, since behaviour branches on its type. */
type StudyCard = CardRow;

/**
 * This card's history, in the corner of the card it belongs to.
 *
 * Two numbers rather than one because they answer different questions: the
 * streak is how it is going, the misses are how hard it has been. A card on a
 * streak of two that has been missed nine times is not the same card as one on
 * a streak of two that has never been missed, and only the pair says so.
 *
 * Both are shown even at zero. A number that appears once it is interesting
 * would make its absence ambiguous — nothing yet, or nothing to report?
 */
function CardHistory({
  timesMissed,
  streak,
}: {
  timesMissed: number;
  streak: number;
}) {
  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
      <span
        title={`Missed ${timesMissed} time${timesMissed === 1 ? "" : "s"} in total`}
        className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-500/20 ring-inset tabular-nums dark:bg-red-400/10 dark:text-red-300 dark:ring-red-300/20"
      >
        <XCircle aria-hidden className="size-3" />
        <span className="sr-only">Missed </span>
        {timesMissed}
      </span>
      <span
        title={`Answered correctly ${streak} time${streak === 1 ? "" : "s"} in a row`}
        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-500/20 ring-inset tabular-nums dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-300/20"
      >
        <Flame aria-hidden className="size-3" />
        <span className="sr-only">Streak </span>
        {streak}
      </span>
    </div>
  );
}

interface StudySessionProps {
  /** The full set this session started from — drives "review missed cards". */
  cards: StudyCard[];
  deckId: number;
  /** Working order when resuming; defaults to `cards`. */
  initialOrder?: StudyCard[];
  initialIndex?: number;
  initialRatings?: Array<[number, Rating]>;
  /** Time already spent per card, when resuming. */
  initialDurations?: Array<[number, number]>;
  initialRound?: number;
  /**
   * Told whenever an answer joins the question on screen, so the page can give
   * the pair the width two columns need and take it back for a lone question.
   */
  onAnswerShowing?: (showing: boolean) => void;
}

type Rating = "got_it" | "missed";

/** Card fronts are rich text; the summary list wants one plain line of it. */
function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

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
  initialDurations,
  initialRound = 1,
  onAnswerShowing,
}: StudySessionProps) {
  const [studyCards, setStudyCards] = useState(initialOrder ?? cards);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [revealed, setRevealed] = useState(false);
  /** What the clock read when the answer went up. Only meaningful while revealed. */
  const [revealedMs, setRevealedMs] = useState(0);
  const [finished, setFinished] = useState(false);
  const [ratings, setRatings] = useState<Map<number, Rating>>(
    () => new Map(initialRatings ?? []),
  );
  /** Milliseconds spent per card, banked as each one is answered. */
  const [durations, setDurations] = useState<Map<number, number>>(
    () => new Map(initialDurations ?? []),
  );
  const [round, setRound] = useState(initialRound);
  const [editOpen, setEditOpen] = useState(false);
  /**
   * A scan being examined at full size, or null.
   *
   * The card is fitted to the window, which is what keeps the question, the
   * picture and the rating buttons on one screen — but it also means browser
   * zoom cannot make the picture bigger: zooming shrinks the window in CSS
   * pixels, and the picture is sized from the window. So the picture gets a
   * view of its own, where the whole screen is the frame.
   */
  const [zoomed, setZoomed] = useState<string | null>(null);
  /** Whether that view is showing the scan at its own resolution. */
  const [actualSize, setActualSize] = useState(false);
  const [isPending, startTransition] = useTransition();
  /** Read straight from localStorage — it is browser state, not session state. */
  const soundOn = useSyncExternalStore(
    subscribeStudySound,
    isStudySoundEnabled,
    studySoundServerSnapshot,
  );

  const current = studyCards[currentIndex];
  const total = studyCards.length;

  /**
   * The current card's counters, read live rather than off `studyCards`.
   *
   * The session holds the cards it was handed when it started, so a card missed
   * in the first round and seen again in the review round would still show the
   * miss count it had before that miss. Reading through the store means the
   * corner always agrees with what has actually been recorded.
   */
  const history = useStore(
    useCallback(
      (db: DbDoc) => {
        const live = current ? db.cards.find((c) => c.id === current.id) : null;
        return {
          timesMissed: live?.timesMissed ?? current?.timesMissed ?? 0,
          streak: live?.consecutiveCorrect ?? current?.consecutiveCorrect ?? 0,
        };
      },
      [current],
    ),
  );
  /** Answered in its own surface rather than by flipping and self-rating. */
  const interactive = current?.type === "quiz";

  /**
   * A click on a picture opens the picture, not the card behind it.
   *
   * Caught on the way down so it beats the card's own reveal handler: a scan is
   * something to look at closely before answering, and turning the card over
   * while trying to read it is the opposite of what was asked for.
   */
  const openImageOnClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== "IMG") return;
    e.preventDefault();
    e.stopPropagation();
    setZoomed((target as HTMLImageElement).src);
    // Always opens fitted, whatever the last scan was left on.
    setActualSize(false);
  }, []);

  // A quiz card puts its options up straight away, so it is two columns from
  // the moment it appears; a basic card only becomes two when it is turned over.
  const answerShowing = !finished && current !== undefined && (revealed || interactive);
  useEffect(() => {
    onAnswerShowing?.(answerShowing);
  }, [answerShowing, onAnswerShowing]);

  // Stopped the moment the answer is on screen: what the time is worth
  // knowing about is the recall, not how long the self-rating took afterwards.
  const timer = useCardTimer({
    cardId: current?.id,
    priorMs: current ? (durations.get(current.id) ?? 0) : 0,
    // Paused while correcting the card: the clock is there to pace recall, and
    // time spent fixing a typo is not time spent trying to remember.
    running: !finished && current !== undefined && !revealed && !editOpen,
  });
  const readElapsed = timer.read;

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

  /**
   * The round's time, card by card.
   *
   * Only cards with a recorded time count towards the total and the average: a
   * session resumed from before the timer existed has cards it genuinely does
   * not know the time for, and treating those as zero would quietly flatter
   * both numbers.
   */
  const timings = useMemo(() => {
    const timed = studyCards
      .map((card) => durations.get(card.id))
      .filter((ms): ms is number => ms !== undefined);
    const totalMs = timed.reduce((sum, ms) => sum + ms, 0);
    return {
      totalMs,
      timedCount: timed.length,
      averageMs: timed.length > 0 ? totalMs / timed.length : 0,
    };
  }, [studyCards, durations]);

  /**
   * Show the answer, and stop the clock on the millisecond it happened.
   *
   * The stopped time is captured here rather than read off the timer's own
   * quarter-second tick, so the frozen digits are the same moment the card is
   * credited with rather than up to a quarter-second short of it.
   */
  const reveal = useCallback(() => {
    setRevealedMs(readElapsed());
    setRevealed(true);
  }, [readElapsed]);

  /**
   * Bank the time on the card being left.
   *
   * Called on the way out rather than continuously, so the map only ever holds
   * settled numbers — and called when stepping back as well as when answering,
   * or a card visited twice would only be credited with the second visit.
   */
  const bankTime = useCallback((cardId: number, ms: number) => {
    setDurations((prev) => {
      const next = new Map(prev);
      next.set(cardId, ms);
      return next;
    });
  }, []);

  const rate = useCallback(
    (rating: Rating) => {
      bankTime(current.id, readElapsed());

      setRatings((prev) => {
        const next = new Map(prev);
        next.set(current.id, rating);
        return next;
      });

      startTransition(async () => {
        await rateCardAction({ cardId: current.id, deckId, rating });
      });

      if (currentIndex < total - 1) {
        setRevealed(false);
        setCurrentIndex((i) => i + 1);
      } else {
        setFinished(true);
      }
    },
    [current, currentIndex, total, deckId, bankTime, readElapsed],
  );

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      bankTime(current.id, readElapsed());
      setCurrentIndex((i) => i - 1);
      setRevealed(false);
    }
  }, [current, currentIndex, bankTime, readElapsed]);

  const restart = useCallback(() => {
    setStudyCards(cards);
    setCurrentIndex(0);
    setRevealed(false);
    setFinished(false);
    setRatings(new Map());
    setDurations(new Map());
    setRound(1);
  }, [cards]);

  const shuffleAndRestart = useCallback(() => {
    setStudyCards(shuffleArray(cards));
    setCurrentIndex(0);
    setRevealed(false);
    setFinished(false);
    setRatings(new Map());
    setDurations(new Map());
    setRound(1);
  }, [cards]);

  const reviewMissed = useCallback(() => {
    setStudyCards(shuffleArray(missedCards));
    setCurrentIndex(0);
    setRevealed(false);
    setFinished(false);
    setRatings(new Map());
    setDurations(new Map());
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
      durations: [...durations.entries()],
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
    durations,
    round,
  ]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Never steal keys from somewhere the user is typing. `isContentEditable`
      // matters as much as the input checks: the card editor is a
      // contenteditable div, so without it a space typed while correcting a
      // card would flip the card behind the dialog, and a "2" would rate it.
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      )
        return;

      // The dialog also carries buttons and a type picker, which take focus
      // without being editable.
      if (editOpen) return;

      // While a scan is being examined the shortcuts belong to it: Escape puts
      // it away, and nothing else should flip or rate the card behind it.
      if (zoomed !== null) {
        if (e.key === "Escape") {
          e.preventDefault();
          setZoomed(null);
        }
        return;
      }

      // Quiz cards are answered in their own surface, so the flip and
      // self-rate shortcuts would either do nothing or record a rating the
      // user didn't intend.
      if (interactive) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (!finished && !revealed) reveal();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (!finished && !revealed) goPrev();
          break;
        case "1":
          if (!finished && revealed) {
            e.preventDefault();
            rate("missed");
          }
          break;
        case "2":
          if (!finished && revealed) {
            e.preventDefault();
            rate("got_it");
          }
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [reveal, goPrev, rate, finished, revealed, interactive, editOpen, zoomed]);

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
            You reviewed {total} card{total === 1 ? "" : "s"}
            {timings.timedCount > 0 && (
              <>
                {" "}
                in{" "}
                {/* The abbreviated form is for the eye; the spoken one is what
                    a screen reader should read out. */}
                <span aria-hidden className="font-medium text-foreground">
                  {formatDuration(timings.totalMs)}
                </span>
                <span className="sr-only">
                  {spokenDuration(timings.totalMs)}
                </span>
              </>
            )}
            .
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

        {/* Time — the deck total, then where it went */}
        {timings.timedCount > 0 && (
          <div className="w-full max-w-md">
            <div className="flex items-stretch justify-center gap-6 rounded-xl border bg-muted/40 p-4">
              <div className="flex-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Total time
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {formatDuration(timings.totalMs)}
                </p>
              </div>
              <div className="w-px bg-border" />
              <div className="flex-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Average card
                </p>
                {/* Coloured by the same thresholds as the timer, so an average
                    in amber means the pace was amber. */}
                <p
                  className={`mt-1 text-2xl font-bold tabular-nums ${STAGE_TEXT[stageForMs(timings.averageMs)]}`}
                >
                  {formatDuration(timings.averageMs)}
                </p>
              </div>
            </div>

            <ul className="mt-3 max-h-56 divide-y divide-border overflow-y-auto rounded-xl border text-left">
              {studyCards.map((card, index) => {
                const ms = durations.get(card.id);
                const rating = ratings.get(card.id);
                return (
                  <li
                    key={card.id}
                    className="flex items-center gap-3 px-3 py-2 text-sm"
                  >
                    <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    {rating === "got_it" ? (
                      <Check className="size-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <X className="size-3.5 shrink-0 text-red-500" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {plainText(card.front) || "Untitled card"}
                    </span>
                    {ms === undefined ? (
                      <span
                        className="shrink-0 text-xs text-muted-foreground"
                        title="Answered before this session was resumed"
                      >
                        &mdash;
                      </span>
                    ) : (
                      <span
                        className={`shrink-0 text-xs font-semibold tabular-nums ${STAGE_TEXT[stageForMs(ms)]}`}
                      >
                        <span aria-hidden>{formatDuration(ms)}</span>
                        <span className="sr-only">{spokenDuration(ms)}</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

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
    <div
      className="mt-3 flex min-h-0 flex-1 flex-col gap-3"
      style={accentStyle(deckId)}
    >
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
          <CardTimer
            elapsedMs={revealed ? revealedMs : timer.elapsedMs}
            stage={revealed ? stageForMs(revealedMs) : timer.stage}
            stopped={revealed}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={soundOn}
            title={soundOn ? "Mute timer chimes" : "Unmute timer chimes"}
            onClick={() => {
              const next = !soundOn;
              setStudySoundEnabled(next);
              // Turning it on plays the amber chime, both to confirm the
              // switch and because a warning sound should never be first
              // heard at full volume mid-card.
              if (next) previewStageChime("amber");
            }}
          >
            {soundOn ? (
              <Volume2 className="size-3.5" />
            ) : (
              <VolumeX className="size-3.5" />
            )}
            <span className="sr-only">
              {soundOn ? "Mute timer chimes" : "Unmute timer chimes"}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditOpen(true)}
            title="Edit this card"
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
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
        className={`grid min-h-0 w-full flex-1 gap-3 ${revealed ? "md:grid-cols-2" : ""}`}
      >
        {/* Question */}
        <Card
          role={revealed || interactive ? undefined : "button"}
          tabIndex={revealed || interactive ? undefined : 0}
          onClick={revealed || interactive ? undefined : reveal}
          onKeyDown={
            revealed || interactive
              ? undefined
              : (e) => {
                  if (e.key === "Enter") reveal();
                }
          }
          className={`relative min-h-0 overflow-hidden transition-all duration-200 ${
            revealed || interactive
              ? ""
              : "cursor-pointer hover:-translate-y-0.5 hover:border-[var(--deck-accent-line)] hover:shadow-lg hover:shadow-[var(--deck-accent-soft)]"
          }`}
        >
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-1.5 bg-[var(--deck-accent)]"
          />
          <CardHistory
            timesMissed={history.timesMissed}
            streak={history.streak}
          />
          <CardContent
            className="study-media flex h-full flex-col items-center overflow-y-auto px-6 py-3"
            onClickCapture={openImageOnClick}
          >
            {/* Centred by auto margins rather than `justify-center`: a
                centred flex box clips the top of anything taller than it, so a
                long answer opened halfway down itself and could not be
                scrolled back to its first line. */}
            <div className="m-auto w-full">
              <p className="mb-1 text-center text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                Question
              </p>
              <div
                className="rich-content w-full text-left text-lg leading-relaxed md:text-xl"
                dangerouslySetInnerHTML={{ __html: current.front }}
              />
              {!revealed && !interactive && (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Click or press{" "}
                  <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[0.7rem]">
                    Space
                  </kbd>{" "}
                  to reveal answer
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Answer — self-revealed for basic cards, answered directly for the
            other two. `key` resets each answer surface between cards. */}
        {current.type === "quiz" && (
          <QuizAnswer
            key={current.id}
            card={current}
            onResolved={rate}
            onRevealed={reveal}
          />
        )}
        {current.type === "basic" && revealed && (
          <Card className="min-h-0 animate-in fade-in slide-in-from-bottom-2 border-[var(--deck-accent-line)] bg-[var(--deck-accent-soft)] duration-200">
            <CardContent
            className="study-media flex h-full flex-col items-center overflow-y-auto px-6 py-3"
            onClickCapture={openImageOnClick}
          >
              {/* Same auto-margin centring as the question. */}
              <div className="m-auto w-full">
                <p className="mb-1 text-center text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                  Answer
                </p>
                <div
                  className="rich-content w-full text-left text-lg leading-relaxed md:text-xl"
                  dangerouslySetInnerHTML={{ __html: current.back }}
                />
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Rating / Navigation. Quiz cards grade themselves, so they never show
          these. */}
      {revealed && !interactive ? (
        <div className="flex shrink-0 flex-col items-center gap-2">
          <p className="text-sm text-muted-foreground">How did you do?</p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="lg"
              onClick={() => rate("missed")}
              disabled={isPending}
              className="min-w-32 border-red-500/40 text-red-500 transition-transform hover:-translate-y-0.5 hover:bg-red-500/10 hover:text-red-500"
            >
              <X className="size-4" />
              Missed
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => rate("got_it")}
              disabled={isPending}
              className="min-w-32 border-emerald-500/40 text-emerald-500 transition-transform hover:-translate-y-0.5 hover:bg-emerald-500/10 hover:text-emerald-500"
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

      {/* Correcting a card mid-session. The session keeps its own working list,
          so the saved card is written back into it — otherwise the fix would be
          stored but the card in front of you would still show the mistake.
          Position, ratings, times and the shuffled order are all untouched. */}
      {current && (
        <EditCardDialog
          card={current}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={(saved) =>
            setStudyCards((list) =>
              list.map((c) => (c.id === saved.id ? saved : c)),
            )
          }
        />
      )}

      {/* The picture with the screen as its frame. Rendered here rather than in
          a dialog component because it wants no chrome at all: the scan, a way
          out, and nothing else competing for the space.

          Clicking the scan again takes it to its own full resolution and lets
          the frame scroll — browser zoom cannot help with any of this, because
          zooming shrinks the window in CSS pixels and every picture here is
          sized from the window, so the two cancel out. Magnification has to
          come from the picture's own size instead. */}
      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Card image"
          onClick={() => setZoomed(null)}
          className="fixed inset-0 z-50 overflow-auto bg-black/85 p-4 animate-in fade-in duration-150"
        >
          <div
            className={`flex min-h-full ${actualSize ? "" : "items-center justify-center"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={zoomed}
              alt="Card image at full size"
              onClick={(e) => {
                e.stopPropagation();
                setActualSize((full) => !full);
              }}
              title={actualSize ? "Fit to screen" : "See it at full resolution"}
              className={`m-auto rounded-md bg-white shadow-2xl ${
                actualSize
                  ? "max-w-none cursor-zoom-out"
                  : "max-h-[calc(100dvh-2rem)] max-w-full cursor-zoom-in object-contain"
              }`}
            />
          </div>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Close image"
            onClick={() => setZoomed(null)}
            className="fixed top-4 right-4"
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
