"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playStageChime, playTick } from "@/lib/study-chime";
import { stageForMs, type TimerStage } from "@/lib/study-timer";

interface CardTimerOptions {
  /** Restarts the clock whenever it changes. */
  cardId: number | undefined;
  /** Time already banked against this card, from an earlier visit or session. */
  priorMs: number;
  /**
   * False once the answer is on screen, while the summary is up, or before
   * there is a card to time. Stopping holds the clock where it is rather than
   * discarding it — the card can be answered, or resumed, from that number.
   */
  running: boolean;
}

interface CardTimer {
  elapsedMs: number;
  stage: TimerStage;
  /**
   * The exact time on the card right now, for banking when it is answered.
   *
   * Read rather than taken from `elapsedMs`, which is only as fresh as the last
   * tick — a card answered a fraction after a tick would otherwise lose the
   * remainder, and one answered instantly would record zero.
   */
  read: () => number;
}

const TICK_MS = 250;

/**
 * Time spent working on the card currently on screen.
 *
 * Elapsed time is derived from timestamps rather than counted in ticks, so a
 * throttled background tab or a slow frame can't make the clock drift. Two
 * things stop it: the tab being hidden, since a session left open in another
 * window is not time spent studying; and the answer being revealed, since what
 * is worth measuring is how long the recall took, not how long you then spent
 * deciding which button to press.
 *
 * The stage crossings are detected here, on the tick, rather than in an effect
 * watching the stage. An effect would also fire on the render where a new card
 * has arrived but the elapsed time hasn't been reset yet, chiming at somebody
 * who has just moved on.
 */
export function useCardTimer({
  cardId,
  priorMs,
  running,
}: CardTimerOptions): CardTimer {
  /** Time banked on this card, excluding the stretch since `startedAt`. */
  const banked = useRef(priorMs);
  /** When the current stretch began; null while stopped. */
  const startedAt = useRef<number | null>(null);
  const lastStage = useRef<TimerStage>("green");
  /** Whole seconds already ticked, so each one sounds exactly once. */
  const lastSecond = useRef(0);

  const read = useCallback(
    () =>
      banked.current +
      (startedAt.current === null ? 0 : Date.now() - startedAt.current),
    [],
  );

  /**
   * The displayed time, tagged with what it is the time *for*.
   *
   * Reset during render rather than in an effect: showing the previous card's
   * clock for a frame is exactly the sort of stale flash an effect would
   * introduce. Only a different card resets it — stopping simply leaves the
   * digits where the last tick put them, and starting again carries on from the
   * banked total. A caller that wants the stopped clock to read to the
   * millisecond can `read()` in the handler that stopped it.
   */
  const cardKey = `${cardId}:${priorMs}`;
  const [shown, setShown] = useState({ cardKey, elapsedMs: priorMs });
  if (shown.cardKey !== cardKey) setShown({ cardKey, elapsedMs: priorMs });

  // Split from the effect below so that stopping and starting the clock leaves
  // the time banked so far alone — only a different card starts from scratch.
  useEffect(() => {
    banked.current = priorMs;
    startedAt.current = null;
    lastStage.current = stageForMs(priorMs);
    lastSecond.current = Math.floor(priorMs / 1000);
  }, [cardId, priorMs]);

  useEffect(() => {
    if (cardId === undefined || !running) return;

    // Held at zero when the page opens in a background tab. `visibilitychange`
    // only fires on a *change*, so a card that was never on screen would
    // otherwise be timed from the moment the tab was opened until it was
    // eventually looked at.
    if (!document.hidden) startedAt.current = Date.now();

    const interval = window.setInterval(() => {
      const ms = read();
      setShown((prev) => ({ ...prev, elapsedMs: ms }));

      const stage = stageForMs(ms);
      const second = Math.floor(ms / 1000);
      const crossed = stage !== lastStage.current;

      if (crossed) {
        lastStage.current = stage;
        if (stage !== "green") playStageChime(stage);
      }

      // Once past the first window, every second is audible. The crossing
      // second is skipped because its chime has just played — a tick under it
      // would only muddy the one sound that means something.
      if (second !== lastSecond.current) {
        lastSecond.current = second;
        if (!crossed && stage !== "green") playTick(stage);
      }
    }, TICK_MS);

    function handleVisibility() {
      if (document.hidden) stop();
      else if (startedAt.current === null) startedAt.current = Date.now();
    }

    /** Fold the running stretch into the banked total and hold there. */
    function stop() {
      if (startedAt.current === null) return;
      banked.current += Date.now() - startedAt.current;
      startedAt.current = null;
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, [cardId, priorMs, running, read]);

  return {
    elapsedMs: shown.elapsedMs,
    stage: stageForMs(shown.elapsedMs),
    read,
  };
}
