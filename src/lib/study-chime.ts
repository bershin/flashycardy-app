"use client";

/**
 * The two study chimes, synthesised rather than shipped.
 *
 * A couple of oscillators cost nothing and keep the static export free of audio
 * assets — an mp3 would be a network request on a site that is otherwise happy
 * offline. Amber is one soft tone; red is a lower, louder pair, so the second
 * warning is distinguishable from the first without having to look up.
 *
 * Browsers refuse to start audio before the user has interacted with the page.
 * Studying is all interaction — opening the deck, flipping the card — so by the
 * time thirty seconds have passed the context resumes fine. If it doesn't, the
 * timer still runs; a silent chime is not worth an error.
 */

import { isStudySoundEnabled } from "@/lib/settings";

type Beep = {
  frequency: number;
  /** Seconds from the start of the chime. */
  at: number;
  duration: number;
  gain: number;
};

const CHIMES: Record<"amber" | "red", Beep[]> = {
  // A single mid tone: "you're past the easy window".
  amber: [{ frequency: 740, at: 0, duration: 0.18, gain: 0.07 }],
  // Lower, twice, and appreciably louder.
  red: [
    { frequency: 440, at: 0, duration: 0.22, gain: 0.22 },
    { frequency: 370, at: 0.26, duration: 0.28, gain: 0.22 },
  ],
};

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  // Suspended is the normal state until the page has been interacted with, and
  // again after the tab has been in the background.
  if (context.state === "suspended") void context.resume();
  return context;
}

function schedule(ctx: AudioContext, beep: Beep) {
  const start = ctx.currentTime + beep.at;
  const end = start + beep.duration;

  const oscillator = ctx.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = beep.frequency;

  // Ramped in and out: an oscillator switched on at full gain clicks.
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(beep.gain, start + 0.015);
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(envelope).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

/** Sound the warning for a stage the card has just crossed into. */
export function playStageChime(stage: "amber" | "red") {
  if (!isStudySoundEnabled()) return;
  const ctx = audioContext();
  if (!ctx) return;
  try {
    for (const beep of CHIMES[stage]) schedule(ctx, beep);
  } catch {
    // Audio is decoration here. Never let it interrupt a session.
  }
}

/** Preview a chime — used by the sound toggle so the volume isn't a surprise. */
export function previewStageChime(stage: "amber" | "red") {
  const ctx = audioContext();
  if (!ctx) return;
  try {
    for (const beep of CHIMES[stage]) schedule(ctx, beep);
  } catch {
    // As above.
  }
}
