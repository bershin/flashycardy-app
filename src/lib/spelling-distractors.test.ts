import assert from "node:assert/strict";
import { test } from "node:test";
import { spellingDistractors, spellingOptions } from "./spelling-distractors.ts";

/** Deterministic "random" so a rule's output can be asserted exactly. */
const first = () => 0;

test("never offers the word itself, and never repeats", () => {
  for (const word of ["necessary", "separate", "definitely", "receive", "accommodate"]) {
    const wrong = spellingDistractors(word, 3, first);
    assert.ok(!wrong.includes(word), `${word} offered itself`);
    assert.equal(new Set(wrong).size, wrong.length, `${word} repeated a distractor`);
  }
});

test("produces three for words people actually get wrong", () => {
  for (const word of ["necessary", "separate", "definitely", "accommodate", "occurrence", "embarrass"]) {
    assert.equal(spellingDistractors(word, 3, first).length, 3, `only got few for ${word}`);
  }
});

test("halves a doubled consonant — the necessary/necesary trap", () => {
  assert.ok(spellingDistractors("necessary", 3, first).includes("necesary"));
});

test("doubles a single consonant between vowels", () => {
  // "traveling" and "travelling" are the argument this rule imitates.
  assert.ok(spellingDistractors("traveling", 3, first).some((d) => d === "travelling"));
});

test("swaps endings that sound identical", () => {
  assert.ok(spellingDistractors("stationary", 3, first).includes("stationery"));
  assert.ok(spellingDistractors("receive", 3, first).includes("recieve"));
  assert.ok(spellingDistractors("independent", 3, first).includes("independant"));
});

test("misspellings stay recognisably the same word", () => {
  // Every distractor should be within one edit of the original: a wrong answer
  // that looks like a different word tests nothing.
  const distance = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(
          d[i - 1][j] + 1,
          d[i][j - 1] + 1,
          d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
    return d[a.length][b.length];
  };

  for (const word of ["necessary", "separate", "definitely", "accommodate", "rhythm", "conscience"]) {
    for (const wrong of spellingDistractors(word, 3, first)) {
      assert.ok(
        distance(word, wrong) <= 2,
        `${wrong} is too far from ${word} to be tempting`,
      );
    }
  }
});

test("a word too short or too plain yields nothing rather than nonsense", () => {
  assert.deepEqual(spellingDistractors("at", 3, first), []);
  assert.deepEqual(spellingDistractors("", 3, first), []);
});

test("the four options contain the answer, and say which it is", () => {
  const result = spellingOptions("necessary", first)!;
  assert.equal(result.options.length, 4);
  assert.equal(result.options[result.correctIndex], "necessary");
  assert.equal(new Set(result.options).size, 4);
});

test("the answer is not always in the same place", () => {
  // Shuffled with a real source of randomness, over enough draws.
  const seen = new Set<number>();
  for (let i = 0; i < 60; i++) seen.add(spellingOptions("necessary")!.correctIndex);
  assert.ok(seen.size > 1, "the correct option never moved");
});
