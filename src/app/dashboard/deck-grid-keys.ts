"use client";

import { useEffect } from "react";
import { shortcutAllowed } from "@/lib/shortcuts";

/**
 * Arrow keys to walk the deck grid, and n / h / d to study the selected deck.
 *
 * The selection is plain keyboard focus on the deck's link, not React state:
 * Enter then opens the deck with no extra code, Tab carries on from wherever
 * the arrows left off, and a reorder or a deck added by sync cannot leave a
 * stale index pointing at the wrong card. The deck card marks itself up with
 * `data-deck-root`, `data-deck-link` and `data-study` for this to find.
 */
export function useDeckGridKeys() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!shortcutAllowed(e)) return;

      const links = Array.from(
        document.querySelectorAll<HTMLElement>("[data-deck-link]"),
      );
      if (links.length === 0) return;

      const active = document.activeElement;
      const current = links.findIndex((link) =>
        link.closest("[data-deck-root]")?.contains(active),
      );
      // Only take the arrows when nothing else has the focus — on a todo's
      // checkbox or a header button they should keep doing what they do.
      const free = active === null || active === document.body;

      if (e.key.startsWith("Arrow")) {
        if (current === -1 && !free) return;
        e.preventDefault();
        const next = current === -1 ? 0 : step(links, current, e.key);
        links[next].focus({ preventScroll: true });
        links[next].scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }

      if (current === -1) return;

      if (e.key === "Escape") {
        (active as HTMLElement | null)?.blur();
        return;
      }

      const group = { n: "new", h: "hard", d: "due" }[e.key.toLowerCase()];
      if (!group) return;
      const pill = links[current]
        .closest("[data-deck-root]")
        ?.querySelector<HTMLButtonElement>(`[data-study="${group}"]`);
      if (!pill) return;
      e.preventDefault();
      pill.click();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * The deck an arrow press lands on.
 *
 * Left and right go through the decks in reading order, so they wrap from the
 * end of one row to the start of the next. Up and down go by where the decks
 * actually sit, since the grid is one, two or three columns wide depending on
 * the window: the nearest row in that direction, then the deck in it closest
 * to the one you are on.
 */
function step(links: HTMLElement[], current: number, key: string): number {
  if (key === "ArrowLeft") return Math.max(0, current - 1);
  if (key === "ArrowRight") return Math.min(links.length - 1, current + 1);

  const rects = links.map((l) =>
    (l.closest("[data-deck-root]") ?? l).getBoundingClientRect(),
  );
  const from = rects[current];
  const fromX = from.left + from.width / 2;
  const down = key === "ArrowDown";

  let best = current;
  let bestRow = Infinity;
  let bestCol = Infinity;
  rects.forEach((r, i) => {
    if (i === current) return;
    const dy = down ? r.top - from.top : from.top - r.top;
    // Half a card's height keeps decks in the same row, which can sit a pixel
    // or two apart while one is lifted on hover, out of the running.
    if (dy < from.height / 2) return;
    const dx = Math.abs(r.left + r.width / 2 - fromX);
    if (dy < bestRow - 1 || (Math.abs(dy - bestRow) <= 1 && dx < bestCol)) {
      best = i;
      bestRow = dy;
      bestCol = dx;
    }
  });
  return best;
}
