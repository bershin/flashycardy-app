/**
 * Shared styling for the small status pills on deck cards.
 *
 * Kept in one place because the dashboard and the sub-deck list render the same
 * set of badges, and they had already drifted apart once.
 *
 * Tone carries meaning, but never on its own — every badge is labelled, so the
 * colour is reinforcement rather than the message.
 */
export type BadgeTone = "due" | "tomorrow" | "done" | "studied" | "muted";

const TONES: Record<BadgeTone, string> = {
  // The only actionable one, so it is the strongest.
  due: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-300/25",
  // Deliberately quieter: a heads-up, not something to act on yet.
  tomorrow:
    "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-300/20",
  done: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:bg-emerald-400/15 dark:text-emerald-300 dark:ring-emerald-300/25",
  studied:
    "bg-violet-500/15 text-violet-700 ring-violet-500/25 dark:bg-violet-400/15 dark:text-violet-300 dark:ring-violet-300/25",
  muted: "bg-muted text-muted-foreground ring-border/60",
};

export function badgeClass(tone: BadgeTone, extra = ""): string {
  return [
    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1",
    "text-xs font-medium ring-1 ring-inset",
    TONES[tone],
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}
