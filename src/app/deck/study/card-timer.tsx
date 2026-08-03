"use client";

import {
  STAGE_STROKE,
  STAGE_TEXT,
  formatClock,
  spokenDuration,
  stageFraction,
  type TimerStage,
} from "@/lib/study-timer";

interface CardTimerProps {
  elapsedMs: number;
  stage: TimerStage;
  size?: number;
}

const STAGE_ANNOUNCEMENT: Record<TimerStage, string> = {
  green: "",
  amber: "Over 30 seconds on this card.",
  red: "Over a minute on this card.",
};

/**
 * How long the card on screen has been up, as a ring around the clock.
 *
 * The ring is one lap per thirty-second window rather than one lap for the
 * whole card: there is no total to be a fraction of — a card can take as long
 * as it takes — so a ring that filled forever would have nothing to fill
 * towards. Emptying and changing colour is what makes crossing a window
 * visible at a glance.
 *
 * Red is the exception: it fills once and stays full, since past ninety seconds
 * there is no further stage, and a ring that restarted there would read as
 * progress. The digits in the middle are the real number, and they never rely
 * on the colour to be legible.
 */
export function CardTimer({ elapsedMs, stage, size = 40 }: CardTimerProps) {
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = stageFraction(elapsedMs) * circumference;

  return (
    <div
      role="timer"
      aria-label={`${spokenDuration(elapsedMs)} on this card`}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        aria-hidden
        width={size}
        height={size}
        className={`-rotate-90 ${stage === "red" ? "animate-pulse" : ""}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        {/* Omitted at zero: a round cap on a zero-length dash still paints a
            dot, which reads as a sliver of time that hasn't passed. */}
        {filled > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
            className={`${STAGE_STROKE[stage]} transition-[stroke-dasharray] duration-200`}
          />
        )}
      </svg>
      <span
        aria-hidden
        className={`absolute inset-0 flex items-center justify-center text-[0.65rem] font-semibold tabular-nums ${STAGE_TEXT[stage]}`}
      >
        {formatClock(elapsedMs)}
      </span>

      {/* Announced once per crossing — the sounds are no use to a screen
          reader user with audio off, and the digits themselves must not be
          live or every tick would be read out. */}
      <span aria-live="polite" className="sr-only">
        {STAGE_ANNOUNCEMENT[stage]}
      </span>
    </div>
  );
}
