"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playStageChime, playTick } from "@/lib/study-chime";
import { stageForMs, type TimerStage } from "@/lib/study-timer";

interface CardTimerOptions {
  /** Restarts the clock whenever it changes. */
  cardId: number | undefined;
  /** Time already banked against this card, from an earlier visit or session. */
  priorMs: number;
  /** False while the summary is up, or before there is a card to time. */
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
 * Time spent on the card currently on screen.
 *
 * Elapsed time is derived from timestamps rather than counted in ticks, so a
 * throttled background tab or a slow frame can't make the clock drift. Time
 * while the tab is hidden isn't counted at all: leaving a session open in
 * another window is not time spent studying, and counting it would put every
 * card into red and make the deck total meaningless.
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
  /** When the current stretch began; null while paused. */
  const startedAt = useRef<number | null>(null);
  const lastStage = useRef<TimerStage>("green");
  /** Whole seconds already ticked, so each one sounds exactly once. */
  const lastSecond = useRef(0);

  /**
   * The displayed time, tagged with what it is the time *for*.
   *
   * Reset during render rather than in the effect that starts the interval:
   * showing the previous card's clock for a frame is exactly the sort of stale
   * flash the effect would introduce, and the tag makes "a different card" and
   * "the same card, restarted" the same case.
   */
  const key = `${cardId}:${priorMs}:${running}`;
  const [shown, setShown] = useState({ key, elapsedMs: priorMs });
  if (shown.key !== key) setShown({ key, elapsedMs: priorMs });

  const read = useCallback(
    () =>
      banked.current +
      (startedAt.current === null ? 0 : Date.now() - startedAt.current),
    [],
  );

  useEffect(() => {
    if (cardId === undefined || !running) {
      startedAt.current = null;
      return;
    }

    banked.current = priorMs;
    startedAt.current = Date.now();
    lastStage.current = stageForMs(priorMs);
    lastSecond.current = Math.floor(priorMs / 1000);

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
      if (document.hidden) {
        if (startedAt.current !== null) {
          banked.current += Date.now() - startedAt.current;
          startedAt.current = null;
        }
      } else if (startedAt.current === null) {
        startedAt.current = Date.now();
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [cardId, priorMs, running, read]);

  return {
    elapsedMs: shown.elapsedMs,
    stage: stageForMs(shown.elapsedMs),
    read,
  };
}
