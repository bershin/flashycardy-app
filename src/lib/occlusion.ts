/**
 * Picture cards with their labels hidden, one card per label.
 *
 * A diagram of the skeleton with twenty labels becomes twenty cards. Each one
 * shows the picture with every label covered and one box picked out, and asks
 * what is under it. They are ordinary cards in every other way — each has its
 * own streak, misses and review date — so the bones you know stop coming up
 * while the ones you keep confusing come back.
 *
 * The cards from one picture are siblings. They carry the same question (the
 * picture lives there, so it is stored once whatever the box count), the same
 * notes and the same list of boxes, and differ only in which box is theirs.
 * Editing any one of them edits the set.
 *
 * Nothing here touches the store or the DOM, so it can be tested on its own.
 */

import type { PartsPayload } from "./parts";

/**
 * Which set a card belongs to — a picture's labels or a question's parts — or
 * undefined for a card on its own.
 */
export function setGroup(card: {
  occlusion?: OcclusionPayload;
  parts?: PartsPayload;
}): string | undefined {
  return card.occlusion?.group ?? card.parts?.group;
}

/** A covered area, in fractions of the picture so it holds at any size. */
export type OcclusionBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** What is under the box: the answer to that box's card. */
  label: string;
};

export type OcclusionPayload = {
  /** Shared by every card made from the same picture. */
  group: string;
  /** Which of `boxes` this card asks about. */
  boxId: string;
  boxes: OcclusionBox[];
};

/** The first picture in a card's HTML, as written: `cue:<hash>` or `data:`. */
const FIRST_IMAGE = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/i;

export function firstImageSrc(html: string): string | null {
  return FIRST_IMAGE.exec(html)?.[1] ?? null;
}

/**
 * The question with its picture taken out, for drawing the words above the
 * picture separately. A paragraph the picture leaves empty goes with it.
 */
export function withoutFirstImage(html: string): string {
  return html
    .replace(FIRST_IMAGE, "")
    .replace(/<p>\s*<\/p>/g, "")
    .trim();
}

export function newOcclusionId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** The box a card asks about, or undefined for a card whose box has gone. */
export function targetBox(payload: OcclusionPayload): OcclusionBox | undefined {
  return payload.boxes.find((b) => b.id === payload.boxId);
}

/** Smallest box worth keeping, so a stray click does not make a card. */
export const MIN_BOX = 0.01;

/** Keep a box inside the picture and no smaller than {@link MIN_BOX}. */
export function clampBox(box: OcclusionBox): OcclusionBox {
  const x = Math.min(Math.max(box.x, 0), 1 - MIN_BOX);
  const y = Math.min(Math.max(box.y, 0), 1 - MIN_BOX);
  return {
    ...box,
    x,
    y,
    w: Math.min(Math.max(box.w, MIN_BOX), 1 - x),
    h: Math.min(Math.max(box.h, MIN_BOX), 1 - y),
  };
}

/**
 * Shuffle each picture's cards among the places they already hold.
 *
 * Drawn top to bottom every time, a diagram is learned as a sequence — "after
 * Clavicle comes Backbone" — rather than as bones, and a question's parts as
 * "the one after the 48". Every other card stays
 * exactly where it was, so this changes nothing for a deck with no pictures.
 */
export function mixSiblings<
  T extends { occlusion?: OcclusionPayload; parts?: PartsPayload },
>(
  cards: readonly T[],
  random: () => number = Math.random,
): T[] {
  const out = [...cards];
  const slots = new Map<string, number[]>();
  out.forEach((card, index) => {
    const group = setGroup(card);
    if (!group) return;
    slots.set(group, [...(slots.get(group) ?? []), index]);
  });
  for (const places of slots.values()) {
    const members = places.map((i) => out[i]);
    for (let i = members.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [members[i], members[j]] = [members[j], members[i]];
    }
    places.forEach((place, k) => (out[place] = members[k]));
  }
  return out;
}

/**
 * What saving a picture's boxes does to the cards already made from it.
 *
 * A box that already has a card keeps it — and with it the card's progress —
 * however far the box was moved. A box with a new label is flagged, because a
 * card asking for a different word has not been tested in its new form, the
 * same as rewording any other card. New boxes need cards; cards whose box was
 * removed go.
 */
export function planGroupSave<C extends { id: number; occlusion?: OcclusionPayload }>(
  siblings: readonly C[],
  boxes: readonly OcclusionBox[],
): {
  keep: Array<{ card: C; box: OcclusionBox; relabelled: boolean }>;
  add: OcclusionBox[];
  remove: C[];
} {
  const byBox = new Map<string, C>();
  const remove: C[] = [];
  for (const card of siblings) {
    const id = card.occlusion?.boxId;
    // Two cards on one box should never happen; if it does, one is enough.
    if (id === undefined || byBox.has(id)) remove.push(card);
    else byBox.set(id, card);
  }

  const keep: Array<{ card: C; box: OcclusionBox; relabelled: boolean }> = [];
  const add: OcclusionBox[] = [];
  for (const box of boxes) {
    const card = byBox.get(box.id);
    if (!card) {
      add.push(box);
      continue;
    }
    byBox.delete(box.id);
    const before = card.occlusion?.boxes.find((b) => b.id === box.id);
    keep.push({
      card,
      box,
      relabelled: before?.label.trim() !== box.label.trim(),
    });
  }
  remove.push(...byBox.values());
  return { keep, add, remove };
}

/** The label a card is asking for, as plain text, for search and summaries. */
export function occlusionLabel(card: { occlusion?: OcclusionPayload }): string {
  return card.occlusion ? (targetBox(card.occlusion)?.label ?? "") : "";
}
