/**
 * How long a card is taking, and what that should look like.
 *
 * A card gets three thirty-second windows. The first is green — that is the
 * pace a card you actually know is answered at. The second is amber and the
 * third is red, each announced with a sound (see `study-chime.ts`), so the
 * nudge lands even when you are staring at the card rather than at the clock.
 *
 * Nothing here ever ends a card: the timer is a pace signal, not a limit.
 * Running past the last window keeps counting in red.
 */

export type TimerStage = "green" | "amber" | "red";

/** Length of each pace window. One number drives the stages and the meter. */
export const STAGE_MS = 30_000;

export function stageForMs(ms: number): TimerStage {
  if (ms < STAGE_MS) return "green";
  if (ms < STAGE_MS * 2) return "amber";
  return "red";
}

/**
 * How far through the current window, 0–1.
 *
 * Red saturates at 1 rather than wrapping — past ninety seconds there is no
 * further stage to fill towards, and a bar that restarted would read as
 * progress.
 */
export function stageFraction(ms: number): number {
  const stage = stageForMs(ms);
  if (stage === "red") return Math.min((ms - STAGE_MS * 2) / STAGE_MS, 1);
  return (ms % STAGE_MS) / STAGE_MS;
}

/** `0:07`, `1:23`, `1:02:03` — the running clock, so digits never jump width. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** `47s`, `4m 12s`, `1h 3m` — totals, where a clock reads like a countdown. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Spoken form, for the parts of the UI a screen reader has to read out. */
export function spokenDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (seconds > 0 || minutes === 0)
    parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** Tailwind classes per stage, kept together so the three tones stay in step. */
export const STAGE_TEXT: Record<TimerStage, string> = {
  green: "text-emerald-500",
  amber: "text-amber-500",
  red: "text-red-500",
};

export const STAGE_STROKE: Record<TimerStage, string> = {
  green: "stroke-emerald-500",
  amber: "stroke-amber-500",
  red: "stroke-red-500",
};
