/**
 * A deck's identity colour.
 *
 * Keyed on the deck id rather than a hash of the title, so a deck keeps its
 * colour when renamed, and so decks created one after another get consecutive —
 * and therefore well-separated — hues. Ids are never reused, so a colour is
 * stable for the life of a deck.
 *
 * The five slots are defined in `globals.css`; see the comment there for why
 * these hues and not the other three from the palette.
 */
const ACCENT_SLOTS = 5;

export function accentVar(deckId: number): string {
  // Ids start at 1, so subtract to make deck 1 slot 1.
  const slot = ((deckId - 1) % ACCENT_SLOTS + ACCENT_SLOTS) % ACCENT_SLOTS;
  return `var(--accent-${slot + 1})`;
}

/**
 * Inline style vars for anything tinted by a deck's accent. Consumers read
 * `--accent` and the two pre-mixed surface tints rather than recomputing them.
 */
export function accentStyle(deckId: number): React.CSSProperties {
  const accent = accentVar(deckId);
  return {
    "--accent": accent,
    "--accent-soft": `color-mix(in oklab, ${accent} 14%, transparent)`,
    "--accent-line": `color-mix(in oklab, ${accent} 40%, transparent)`,
  } as React.CSSProperties;
}
