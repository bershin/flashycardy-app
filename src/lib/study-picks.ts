"use client";

/**
 * Cards chosen on the deck page, waiting for the study page to pick them up.
 *
 * A handover rather than storage: the study page is a separate route, and the
 * ids cannot ride in the URL — a few hundred of them would make an address
 * longer than browsers reliably accept, and truncating a study list silently is
 * exactly the sort of failure nobody notices.
 *
 * `sessionStorage` rather than a module variable so the choice survives the
 * reload the study page may do, and dies with the tab rather than lying in wait
 * for a session next week.
 */

const KEY = "flashycardy.studyPicks";

type Picks = { deckId: number; cardIds: number[] };

export function setStudyPicks(deckId: number, cardIds: number[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ deckId, cardIds }));
  } catch {
    // Out of quota, or storage refused: the study page falls back to the deck's
    // due cards, which is wrong but not broken.
  }
}

/** Reads and clears the choice, so a reload does not restart the same run. */
export function takeStudyPicks(deckId: number): number[] | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(KEY);
  try {
    const picks = JSON.parse(raw) as Picks;
    return picks.deckId === deckId && picks.cardIds.length > 0
      ? picks.cardIds
      : null;
  } catch {
    return null;
  }
}
