"use client";

interface ProgressRingProps {
  /** Cards not currently due. */
  done: number;
  total: number;
  size?: number;
}

/**
 * How caught up a deck is, as a single meter.
 *
 * One value, so it gets a meter rather than a chart, drawn in the deck's own
 * accent colour. The percentage is written in the middle in text ink — the ring
 * is never the only way to read the number, and the colour carries deck
 * identity rather than magnitude.
 */
export function ProgressRing({ done, total, size = 44 }: ProgressRingProps) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (pct / 100) * circumference;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${pct}% caught up, ${done} of ${total} cards`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        {/* Omitted entirely at zero: a round cap on a zero-length dash still
            paints a dot, which reads as a sliver of progress that isn't there. */}
        {pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            stroke="var(--deck-accent)"
            strokeDasharray={`${filled} ${circumference - filled}`}
            className="transition-[stroke-dasharray] duration-500"
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[0.65rem] font-semibold tabular-nums text-foreground">
        {pct}%
      </span>
    </div>
  );
}
