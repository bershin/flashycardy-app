/**
 * A pasted spelling sheet: word, meaning, example sentence, memory tip.
 *
 * A four-option question tests whether you can pick the right spelling. It does
 * not teach you why "necessary" has one c and two s's — that is what the sheet
 * carries, and it belongs on the back of the card where it is read at the
 * moment of getting it wrong.
 *
 * Pasting from a spreadsheet gives tab-separated columns; pasting from a
 * document often gives pipes. Both are accepted, and the columns are found by
 * their headings when there are any, because a sheet with a Category column
 * should not silently put "DfE Year 5–6 statutory" where the meaning goes.
 */

export type SpellingEntry = {
  word: string;
  meaning?: string;
  sentence?: string;
  tip?: string;
};

/** Heading text → the field it fills. Matched loosely, lowercased. */
const HEADINGS: [RegExp, keyof SpellingEntry][] = [
  [/^word|spelling$/, "word"],
  [/mean|definition|note/, "meaning"],
  [/sentence|example|usage/, "sentence"],
  [/tip|hint|memor|trick/, "tip"],
];

function columns(line: string): string[] {
  const parts = line.includes("\t") ? line.split("\t") : line.split("|");
  return parts.map((c) => c.trim());
}

/**
 * Read the sheet.
 *
 * With a heading row the columns are named, so extra ones — Category, a blank
 * separator — are simply not asked for. Without one the order is assumed to be
 * word, meaning, sentence, tip, which is the order the sheet is written in.
 */
export function parseSpellingSheet(text: string): SpellingEntry[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  let map: (keyof SpellingEntry | null)[] | null = null;
  const first = columns(lines[0]);
  if (first.length > 1) {
    const guess = first.map((cell) => {
      const key = cell.toLowerCase().replace(/[^a-z]/g, "");
      return HEADINGS.find(([pattern]) => pattern.test(key))?.[1] ?? null;
    });
    // Only a heading row if it names a word column and at least one other.
    if (guess.includes("word") && guess.filter(Boolean).length > 1) map = guess;
  }

  const rows = map ? lines.slice(1) : lines;
  const entries: SpellingEntry[] = [];

  for (const line of rows) {
    const cells = columns(line);
    const entry: SpellingEntry = { word: "" };

    if (map) {
      map.forEach((field, i) => {
        if (field && cells[i]) entry[field] = cells[i];
      });
    } else {
      const [word, meaning, sentence, tip] = cells;
      Object.assign(entry, { word, meaning, sentence, tip });
    }

    // A single column is just a word list, which is still a valid sheet.
    if (!entry.word && cells.length === 1) entry.word = cells[0];
    if (entry.word) entries.push(entry);
  }

  return entries;
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The back of the card: the word, then meaning, sentence and tip.
 *
 * Each part is labelled and set apart, because this is read in the second or
 * two after answering — a paragraph of run-together prose would not be.
 *
 * All three headings appear whether or not the sheet filled them. An empty
 * block is an invitation to write one line when the card next comes up, which
 * is how the missing ones actually get written; leaving the heading out means
 * opening the editor and building the layout by hand first, so it never
 * happens.
 */
export function spellingBackHtml(entry: SpellingEntry): string {
  const parts = [`<p><strong>${escape(entry.word)}</strong></p>`];
  const sections: [string, string | undefined][] = [
    ["Meaning", entry.meaning],
    ["Sentence", entry.sentence],
    ["Tip", entry.tip],
  ];

  for (const [label, value] of sections) {
    parts.push(`<p><u>${label}:</u></p>`);
    parts.push(`<pre><code>${value ? escape(value) : ""}</code></pre>`);
  }

  return parts.join("");
}
