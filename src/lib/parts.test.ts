import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseParts,
  partLetter,
  partLine,
  planPartsSave,
  type Part,
  type PartsPayload,
} from "./parts.ts";

const FRONT =
  "<p><strong>a) 131 × 19 =</strong></p><p><strong>b) 672 ÷ 14 =</strong></p>" +
  "<p><strong>c) 9.12 × 34 =</strong></p><p><strong>d) 65.65 ÷ 13 =</strong></p>";
const BACK =
  "<p>a) 131 × 19 = 2489</p><p>b) 672 ÷ 14 = 48</p>" +
  "<p>c) 9.12 × 34 = 310.08</p><p>d) 65.65 ÷ 13 = 5.05</p>";

test("a lettered card splits into its parts", () => {
  const parsed = parseParts(FRONT, BACK);
  assert.deepEqual(parsed, {
    stem: [],
    notes: [],
    items: [
      { question: "131 × 19", answer: "2489" },
      { question: "672 ÷ 14", answer: "48" },
      { question: "9.12 × 34", answer: "310.08" },
      { question: "65.65 ÷ 13", answer: "5.05" },
    ],
  });
});

test("answers may be given alone, and other lines are kept", () => {
  const parsed = parseParts(
    "<p>Work out:</p><p>(a) 2 + 2</p><p>(b) 3 × 3</p>",
    "<p>a) 4</p><p>b. 9</p><p>Show your working.</p>",
  );
  assert.deepEqual(parsed?.stem, ["Work out:"]);
  assert.deepEqual(parsed?.notes, ["Show your working."]);
  assert.deepEqual(parsed?.items.map((p) => p.answer), ["4", "9"]);
});

test("a card that isn't in parts, or is missing an answer, is not split", () => {
  assert.equal(parseParts("<p>What is 2 + 2?</p>", "<p>4</p>"), null);
  assert.equal(parseParts("<p>a) 1 + 1</p><p>b) 2 + 2</p>", "<p>a) 2</p>"), null);
});

test("editing keeps each part's card, and flags only the changed one", () => {
  const items: Part[] = [
    { id: "a", question: "1 + 1", answer: "2" },
    { id: "b", question: "2 + 2", answer: "4" },
  ];
  const card = (id: number, partId: string) => ({
    id,
    parts: { group: "g", partId, items } satisfies PartsPayload,
  });
  const plan = planPartsSave(
    [card(1, "a"), card(2, "b")],
    [
      { id: "a", question: "1 + 1", answer: "2", note: "One and one more" },
      { id: "b", question: "2 + 2", answer: "5" },
      { id: "c", question: "3 + 3", answer: "6" },
    ],
  );
  assert.deepEqual(plan.keep.map((k) => [k.card.id, k.changed]), [[1, false], [2, true]]);
  assert.deepEqual(plan.add.map((p) => p.id), ["c"]);
  assert.equal(plan.remove.length, 0);
});

test("parts are lettered, and a card reads as its own line", () => {
  assert.deepEqual([0, 3, 25, 26].map(partLetter), ["a", "d", "z", "aa"]);
  const items: Part[] = [
    { id: "x", question: "131 × 19", answer: "2489" },
    { id: "y", question: "672 ÷ 14", answer: "48" },
  ];
  assert.equal(partLine({ parts: { group: "g", partId: "y", items } }), "b) 672 ÷ 14 = 48");
});
