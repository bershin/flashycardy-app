"use client";

import { Timer } from "lucide-react";
import {
  STAGE_BG,
  STAGE_MS,
  STAGE_SURFACE,
  formatClock,
  spokenDuration,
  type TimerStage,
} from "@/lib/study-timer";

interface CardTimerProps {
  elapsedMs: number;
  stage: TimerStage;
}

const STAGES: TimerStage[] = ["green", "amber", "red"];

const STAGE_ANNOUNCEMENT: Record<TimerStage, string> = {
  green: "",
  amber: "Over 30 seconds on this card.",
  red: "Over a minute on this card.",
};

/**
 * How long the card on screen has been up.
 *
 * The three pips are the three windows, filling left to right, so the pace is
 * legible at a glance and without relying on the colour alone — which matters
 * both for colour vision deficiency and because green-to-amber is exactly the
 * pair the chimes exist to cover. The clock beside them is the real number.
 */
export function CardTimer({ elapsedMs, stage }: CardTimerProps) {
  return (
    <div
      role="timer"
      aria-label={`${spokenDuration(elapsedMs)} on this card`}
      className={`flex items-center gap-2 rounded-full border px-2.5 py-1 transition-colors ${STAGE_SURFACE[stage]}`}
    >
      <Timer className={`size-3.5 ${stage === "red" ? "animate-pulse" : ""}`} />
      <span className="text-xs font-semibold tabular-nums">
        {formatClock(elapsedMs)}
      </span>
      <span aria-hidden className="flex items-center gap-0.5">
        {STAGES.map((pip, i) => {
          const fill = Math.min(
            Math.max((elapsedMs - i * STAGE_MS) / STAGE_MS, 0),
            1,
          );
          return (
            <span
              key={pip}
              className="h-1 w-3 overflow-hidden rounded-full bg-current/20"
            >
              <span
                className={`block h-full rounded-full ${STAGE_BG[pip]} transition-[width] duration-200`}
                style={{ width: `${fill * 100}%` }}
              />
            </span>
          );
        })}
      </span>

      {/* Announced once per crossing — the chimes are no use to a screen
          reader user with sound off, and the digits themselves must not be
          live or every tick would be read out. */}
      <span aria-live="polite" className="sr-only">
        {STAGE_ANNOUNCEMENT[stage]}
      </span>
    </div>
  );
}
