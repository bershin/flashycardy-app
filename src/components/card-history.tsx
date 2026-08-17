import { Flame, XCircle } from "lucide-react";

/**
 * A card's record: how many times it has been missed, and its current streak.
 *
 * Two numbers rather than one because they answer different questions. The
 * streak is how it is going, the misses are how hard it has been — a card on a
 * streak of two that has been missed nine times is not the same card as one on
 * a streak of two that has never been missed, and only the pair says so.
 *
 * Both are shown even at zero. A number that appears once it is interesting
 * would make its absence ambiguous: nothing yet, or nothing to report?
 *
 * Shared between studying and browsing so a card reads the same in both. The
 * browsing view sets `compact`, where these sit beside a menu button in a
 * header rather than alone in the corner of a full-screen card.
 */
export function CardHistory({
  timesMissed,
  streak,
  compact = false,
}: {
  timesMissed: number;
  streak: number;
  compact?: boolean;
}) {
  const pill = compact
    ? "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0 text-[0.65rem] font-medium ring-1 ring-inset tabular-nums"
    : "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset tabular-nums";
  const icon = compact ? "size-2.5" : "size-3";

  return (
    <div
      className={`flex items-center ${compact ? "gap-1" : "gap-1.5"}`}
      aria-label={`Missed ${timesMissed}, streak ${streak}`}
    >
      <span
        title={`Missed ${timesMissed} time${timesMissed === 1 ? "" : "s"} in total`}
        className={`${pill} bg-red-500/10 text-red-700 ring-red-500/20 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-300/20`}
      >
        <XCircle aria-hidden className={icon} />
        <span className="sr-only">Missed </span>
        {timesMissed}
      </span>
      <span
        title={`Answered correctly ${streak} time${streak === 1 ? "" : "s"} in a row`}
        className={`${pill} bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-300/20`}
      >
        <Flame aria-hidden className={icon} />
        <span className="sr-only">Streak </span>
        {streak}
      </span>
    </div>
  );
}
