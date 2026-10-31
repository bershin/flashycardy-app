import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkTyped,
  clampBox,
  firstImageSrc,
  gatherTyped,
  mixSiblings,
  normalizeWord,
  planGroupSave,
  typedSpan,
  wordHint,
  withoutFirstImage,
  type OcclusionBox,
  type OcclusionPayload,
} from "./occlusion.ts";

const box = (id: string, label: string, x = 0.1): OcclusionBox => ({
  id,
  x,
  y: 0.1,
  w: 0.2,
  h: 0.05,
  label,
});

const card = (id: number, boxId: string, boxes: OcclusionBox[], group = "g") => ({
  id,
  occlusion: { group, boxId, boxes } satisfies OcclusionPayload,
});

test("the picture is found and can be taken out of the question", () => {
  const html = `<p>Name the bone</p><p><img src="cue:${"a".repeat(64)}" alt=""></p>`;
  assert.equal(firstImageSrc(html), `cue:${"a".repeat(64)}`);
  assert.equal(withoutFirstImage(html), "<p>Name the bone</p>");
  assert.equal(firstImageSrc("<p>no picture</p>"), null);
});

test("moving a box keeps its card; changing its label flags it", () => {
  const before = [box("a", "Femur"), box("b", "Tibia")];
  const siblings = [card(1, "a", before), card(2, "b", before)];
  const plan = planGroupSave(siblings, [box("a", "Femur", 0.5), box("b", "Fibula")]);

  assert.deepEqual(
    plan.keep.map((k) => [k.card.id, k.relabelled]),
    [[1, false], [2, true]],
  );
  assert.equal(plan.add.length, 0);
  assert.equal(plan.remove.length, 0);
});

test("a new box needs a card and a removed box loses one", () => {
  const before = [box("a", "Femur"), box("b", "Tibia")];
  const siblings = [card(1, "a", before), card(2, "b", before)];
  const plan = planGroupSave(siblings, [box("a", "Femur"), box("c", "Patella")]);

  assert.deepEqual(plan.keep.map((k) => k.card.id), [1]);
  assert.deepEqual(plan.add.map((b) => b.label), ["Patella"]);
  assert.deepEqual(plan.remove.map((c) => c.id), [2]);
});

test("only a picture's own cards are mixed, among their own places", () => {
  const boxes = [box("a", "A"), box("b", "B"), box("c", "C")];
  const cards: Array<{ id: number; occlusion?: OcclusionPayload }> = [
    { id: 10 },
    card(1, "a", boxes),
    card(2, "b", boxes),
    { id: 11 },
    card(3, "c", boxes),
  ];
  // A fixed roll makes the shuffle predictable; the plain cards never move.
  const mixed = mixSiblings(cards, () => 0);
  assert.deepEqual(mixed.map((c) => c.id), [10, 2, 3, 11, 1]);
  const plain: Array<{ id: number; occlusion?: OcclusionPayload }> = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(mixSiblings(plain).map((c) => c.id), [1, 2]);
});

test("a box is kept inside the picture", () => {
  const b = clampBox({ id: "a", x: 0.9, y: -0.2, w: 0.5, h: 0.001, label: "" });
  assert.deepEqual([b.x, b.y, b.h], [0.9, 0, 0.01]);
  assert.ok(Math.abs(b.w - 0.1) < 1e-9);
});

test("a changed explanation keeps the card's progress", () => {
  const before = [box("a", "Femur")];
  const after = [{ ...box("a", "Femur"), note: "The thigh bone, the longest in the body" }];
  const plan = planGroupSave([card(1, "a", before)], after);
  assert.deepEqual(
    plan.keep.map((k) => [k.card.id, k.relabelled]),
    [[1, false]],
  );
});

test("a typed word matches whatever its case, spacing or edge punctuation", () => {
  assert.equal(normalizeWord("  EUGLENA: "), "euglena");
  assert.equal(normalizeWord("contractile   Vacuole"), "contractile vacuole");
  assert.equal(normalizeWord("it’s"), "it's");
  assert.equal(normalizeWord("cliché") === normalizeWord("cliche"), false);
});

test("a guess opens a hidden box, says it was found already, or is wrong", () => {
  const boxes = [box("a", "thief"), box("b", "nucleus"), box("c", "nucleus"), box("d", "piece")];
  const asked = new Set(["a", "b", "c"]);
  assert.deepEqual(checkTyped(boxes, asked, new Set(), "Thief"), { kind: "found", boxId: "a" });
  assert.deepEqual(checkTyped(boxes, asked, new Set(), "theif"), { kind: "wrong" });
  assert.deepEqual(checkTyped(boxes, asked, new Set(["a"]), "thief"), { kind: "again" });
  // The same word twice opens one box per guess.
  assert.deepEqual(checkTyped(boxes, asked, new Set(["b"]), "nucleus"), { kind: "found", boxId: "c" });
  // A word not being asked — its card isn't due — is shown, not guessed.
  assert.deepEqual(checkTyped(boxes, asked, new Set(), "piece"), { kind: "showing" });
  assert.deepEqual(checkTyped(boxes, asked, new Set(), "   "), { kind: "wrong" });
});

test("a typed picture's cards are brought together, and its run found from any of them", () => {
  const typed = (id: number, group: string) => ({
    id,
    occlusion: { group, boxId: String(id), boxes: [], typed: true } satisfies OcclusionPayload,
  });
  const plain = (id: number) => ({ id, occlusion: undefined });
  const list = [plain(1), typed(2, "t"), plain(3), typed(4, "t"), card(5, "a", []), typed(6, "t")];
  const gathered = gatherTyped(list);
  assert.deepEqual(gathered.map((c) => c.id), [1, 2, 4, 6, 3, 5]);
  assert.deepEqual(typedSpan(gathered, 2), { start: 1, end: 3 });
  assert.deepEqual(typedSpan(gathered, 4), { start: 4, end: 4 });
  assert.deepEqual(typedSpan(gathered, 0), { start: 0, end: 0 });
});

test("a word with no picture shows its clue, or a blank per letter", () => {
  assert.equal(wordHint({ label: "thief", clue: " a robber " }), "a robber");
  assert.equal(wordHint({ label: "thief" }), "_ _ _ _ _");
  assert.equal(wordHint({ label: "it's", clue: "" }), "_ _ ' _");
  assert.equal(wordHint({ label: "ice cream" }), "_ _ _   _ _ _ _ _");
});
