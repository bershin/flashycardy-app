/**
 * Plausible misspellings of a word, for a four-option spelling question.
 *
 * The point is that the wrong answers must be *tempting*. "necessary" against
 * "banana" tests nothing; against "neccessary" and "necesary" it tests whether
 * you know which consonant doubles. So the mistakes here are the ones people
 * actually make — doubling the wrong letter, halving the right one, the endings
 * that sound identical — rather than random letters.
 *
 * Pure and deterministic given a source of randomness, so every rule can be
 * tested directly and a card can be regenerated the same way twice.
 */

const VOWELS = "aeiou";

/** Consonants English doubles: the ones that generate a real hesitation. */
const DOUBLES = "bcdfglmnprst";

/** Endings that sound the same and are constantly mixed up. */
const SUFFIX_SWAPS: [string, string][] = [
  ["ary", "ery"], ["ery", "ary"],
  ["ant", "ent"], ["ent", "ant"],
  ["ance", "ence"], ["ence", "ance"],
  ["able", "ible"], ["ible", "able"],
  ["tion", "sion"], ["sion", "tion"],
  ["cial", "tial"], ["tial", "cial"],
  ["ous", "us"], ["ise", "ize"], ["ize", "ise"],
  ["ei", "ie"], ["ie", "ei"],
];

type Rule = (word: string) => string[];

/** necessary → necesary: a doubled pair reduced to one. */
const halveDouble: Rule = (word) => {
  const out: string[] = [];
  for (let i = 0; i < word.length - 1; i++) {
    if (word[i] === word[i + 1] && !VOWELS.includes(word[i])) {
      out.push(word.slice(0, i) + word.slice(i + 1));
    }
  }
  return out;
};

/** necessary → neccessary: a single consonant doubled where it plausibly could. */
const doubleSingle: Rule = (word) => {
  const out: string[] = [];
  for (let i = 1; i < word.length - 1; i++) {
    const letter = word[i];
    if (!DOUBLES.includes(letter)) continue;
    if (word[i - 1] === letter || word[i + 1] === letter) continue;
    // Only between vowels, which is where the doubling question actually
    // arises — "traveling" or "travelling", never "sstop".
    if (!VOWELS.includes(word[i - 1]) || !VOWELS.includes(word[i + 1])) continue;
    out.push(word.slice(0, i) + letter + word.slice(i));
  }
  return out;
};

/** definitely → defiantely: two adjacent letters changing places. */
const transpose: Rule = (word) => {
  const out: string[] = [];
  for (let i = 1; i < word.length - 2; i++) {
    if (word[i] === word[i + 1]) continue;
    out.push(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  }
  return out;
};

/** separate → seperate: the unstressed vowel nobody can hear. */
const swapVowel: Rule = (word) => {
  const out: string[] = [];
  const swaps: Record<string, string> = { a: "e", e: "a", i: "e", o: "u", u: "o" };
  for (let i = 1; i < word.length - 1; i++) {
    const letter = word[i];
    if (!VOWELS.includes(letter)) continue;
    // Not next to another vowel: changing one half of a pair makes a word that
    // looks nothing like the original rather than a near miss.
    if (VOWELS.includes(word[i - 1]) || VOWELS.includes(word[i + 1])) continue;
    out.push(word.slice(0, i) + swaps[letter] + word.slice(i + 1));
  }
  return out;
};

/** stationary → stationery, receive → recieve. */
const swapSuffix: Rule = (word) => {
  const out: string[] = [];
  for (const [from, to] of SUFFIX_SWAPS) {
    if (from.length > 2 && word.endsWith(from)) {
      out.push(word.slice(0, -from.length) + to);
    } else if (from.length === 2) {
      const at = word.indexOf(from, 1);
      if (at > 0) out.push(word.slice(0, at) + to + word.slice(at + from.length));
    }
  }
  return out;
};

/**
 * The rules in the order they are drawn from.
 *
 * Ending and doubling mistakes first, because they are the ones a reader has to
 * think about; a transposition is often obvious on sight and makes a weak
 * distractor when a better one was available.
 */
const RULES: Rule[] = [swapSuffix, halveDouble, doubleSingle, swapVowel, transpose];

/**
 * Up to `count` misspellings, best first.
 *
 * Never the word itself, never a duplicate. A word too short or too regular to
 * misspell convincingly may yield fewer than asked for — reported honestly by
 * returning a shorter list rather than padding it with nonsense.
 */
export function spellingDistractors(
  word: string,
  count = 3,
  random: () => number = Math.random,
): string[] {
  const target = word.trim();
  if (target.length < 3) return [];

  const seen = new Set([target.toLowerCase()]);
  const picked: string[] = [];

  for (const rule of RULES) {
    const candidates = rule(target).filter((c) => {
      const key = c.toLowerCase();
      if (seen.has(key) || c.length < 2) return false;
      seen.add(key);
      return true;
    });

    // One per rule on the first pass, so the options show different kinds of
    // mistake rather than three variations of the same one.
    if (candidates.length > 0 && picked.length < count) {
      picked.push(candidates[Math.floor(random() * candidates.length)]);
    }
  }

  // Second pass fills any shortfall from whatever the rules can still offer.
  if (picked.length < count) {
    const rest = RULES.flatMap((rule) => rule(target)).filter((c) => {
      const key = c.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    while (picked.length < count && rest.length > 0) {
      picked.push(rest.splice(Math.floor(random() * rest.length), 1)[0]);
    }
  }

  return picked;
}

/** The four options in a random order, and which one is right. */
export function spellingOptions(
  word: string,
  random: () => number = Math.random,
): { options: string[]; correctIndex: number } | null {
  const wrong = spellingDistractors(word, 3, random);
  if (wrong.length === 0) return null;

  const options = [word.trim(), ...wrong];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { options, correctIndex: options.indexOf(word.trim()) };
}
