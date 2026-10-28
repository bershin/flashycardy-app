import assert from "node:assert/strict";
import { test } from "node:test";
import { deserializeDoc, type SerializedDbDoc } from "./types.ts";

const T = "2026-10-27T19:50:00.000Z";

function doc(cards: Array<Record<string, unknown>>): SerializedDbDoc {
  return {
    version: 2,
    mutatedAt: T,
    deviceId: "d",
    nextDeckId: 2,
    nextCardId: 10,
    decks: [],
    cards: cards.map((c, i) => ({
      id: i + 1,
      deckId: 1,
      front: "",
      back: "",
      nextReviewAt: T,
      consecutiveCorrect: 0,
      createdAt: T,
      updatedAt: T,
      ...c,
    })) as SerializedDbDoc["cards"],
  };
}

test("a card carrying boxes or parts is read as what it is, whatever it was saved as", () => {
  const occlusion = { group: "g", boxId: "a", boxes: [] };
  const parts = { group: "h", partId: "a", items: [] };
  const read = deserializeDoc(
    doc([
      // Saved back as basic by a copy of the app from before these types.
      { type: "basic", occlusion },
      { type: "basic", parts },
      { type: "basic" },
      { type: "vocabulary" },
    ]),
  );
  assert.deepEqual(
    read.cards.map((c) => c.type),
    ["occlusion", "parts", "basic", "basic"],
  );
});
