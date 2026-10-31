import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampBox,
  firstImageSrc,
  mixSiblings,
  planGroupSave,
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
