/**
 * Questions in parts — a) b) c) d) — one card per part.
 *
 * A worksheet question like "a) 131 × 19  b) 672 ÷ 14 …" is four sums, and
 * marking it as one card means getting c wrong sends a and b back with it.
 * Here each part is its own card with its own streak and review date, while
 * the deck still shows them together as one question, the way a picture's
 * labels are (see `occlusion.ts`, which this follows).
 *
 * The parts are plain text, typed with the sign buttons for × ÷ ² √. Every
 * card of the set carries the whole list and the id of its own part.
 */

export type Part = {
  id: string;
  /** What is asked, e.g. `131 × 19`. */
  question: string;
  /** What it comes to, e.g. `2489`. */
  answer: string;
};

export type PartsPayload = {
  /** Shared by every card of the question. */
  group: string;
  /** Which of `items` this card asks. */
  partId: string;
  items: Part[];
};

/** a, b, c … z, then aa, ab — a worksheet never gets that far, but no gap. */
export function partLetter(index: number): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  return index < 26
    ? letters[index]
    : letters[Math.floor(index / 26) - 1] + letters[index % 26];
}

export function newPartId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** This card's own part, with its letter, or undefined if it has gone. */
export function ownPart(
  payload: PartsPayload,
): (Part & { letter: string; index: number }) | undefined {
  const index = payload.items.findIndex((p) => p.id === payload.partId);
  if (index === -1) return undefined;
  return { ...payload.items[index], letter: partLetter(index), index };
}

/** The part a card asks, as one line of text, for search and summaries. */
export function partLine(card: { parts?: PartsPayload }): string {
  const own = card.parts ? ownPart(card.parts) : undefined;
  return own ? `${own.letter}) ${own.question} = ${own.answer}` : "";
}

/**
 * What saving a question's parts does to the cards already made from it.
 *
 * The same rules as a picture's boxes: a part that still exists keeps its card
 * and progress; a part whose question or answer changed is flagged as new,
 * because it has not been answered in its new form; new parts need cards and
 * removed parts lose theirs.
 */
export function planPartsSave<C extends { id: number; parts?: PartsPayload }>(
  siblings: readonly C[],
  items: readonly Part[],
): {
  keep: Array<{ card: C; part: Part; changed: boolean }>;
  add: Part[];
  remove: C[];
} {
  const byPart = new Map<string, C>();
  const remove: C[] = [];
  for (const card of siblings) {
    const id = card.parts?.partId;
    if (id === undefined || byPart.has(id)) remove.push(card);
    else byPart.set(id, card);
  }

  const keep: Array<{ card: C; part: Part; changed: boolean }> = [];
  const add: Part[] = [];
  for (const part of items) {
    const card = byPart.get(part.id);
    if (!card) {
      add.push(part);
      continue;
    }
    byPart.delete(part.id);
    const before = card.parts?.items.find((p) => p.id === part.id);
    keep.push({
      card,
      part,
      changed:
        before?.question.trim() !== part.question.trim() ||
        before?.answer.trim() !== part.answer.trim(),
    });
  }
  remove.push(...byPart.values());
  return { keep, add, remove };
}

/** The lines of some card HTML as plain text, one per paragraph or item. */
function lines(html: string): string[] {
  return html
    .replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const LETTERED = /^\(?([a-z])[).]\s*(.+)$/i;

/**
 * Read an ordinary card written as lettered parts into separate parts.
 *
 * The question side lists `a) 131 × 19 =` and so on; the answer side either
 * repeats each line with its result (`a) 131 × 19 = 2489`) or gives the
 * result alone (`a) 2489`). Lines that are not lettered are kept as the
 * instructions and the notes. Returns null when the card is not shaped like
 * that — fewer than two parts, or a part without an answer — so the menu only
 * offers to split cards it can split faithfully.
 */
export function parseParts(
  front: string,
  back: string,
): { stem: string[]; items: Array<Omit<Part, "id">>; notes: string[] } | null {
  const stem: string[] = [];
  const questions = new Map<string, string>();
  for (const line of lines(front)) {
    const m = LETTERED.exec(line);
    if (m) questions.set(m[1].toLowerCase(), m[2].replace(/\s*=\s*$/, "").trim());
    else stem.push(line);
  }
  if (questions.size < 2) return null;

  const answers = new Map<string, string>();
  const notes: string[] = [];
  for (const line of lines(back)) {
    const m = LETTERED.exec(line);
    if (!m || !questions.has(m[1].toLowerCase())) {
      notes.push(line);
      continue;
    }
    const text = m[2];
    const eq = text.lastIndexOf("=");
    answers.set(m[1].toLowerCase(), (eq === -1 ? text : text.slice(eq + 1)).trim());
  }

  const items: Array<Omit<Part, "id">> = [];
  for (const [letter, question] of questions) {
    const answer = answers.get(letter);
    if (!answer) return null;
    items.push({ question, answer });
  }
  return { stem, items, notes };
}
