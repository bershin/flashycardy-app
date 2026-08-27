/**
 * Two machines, one shared file, no network: the merge driven the way the sync
 * loop drives it — pull, merge, push — to check that the pair converges rather
 * than taking turns overwriting each other.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { baseOf, mergeDocs, type SyncBase } from "./merge.ts";
import type { CardRow, DbDoc } from "./types.ts";

const T0 = new Date("2026-08-01T10:00:00Z");
const at = (m: number) => new Date(T0.getTime() + m * 60_000);

function card(id: number, front: string, updated: Date, created = T0): CardRow {
  return {
    id, deckId: 1, type: "basic", front, back: "a", schedule: "weekly",
    nextReviewAt: T0, consecutiveCorrect: 0, lastCorrectAt: null, timesMissed: 0,
    createdAt: created, updatedAt: updated,
  };
}
const doc = (cards: CardRow[], parts: Partial<DbDoc> = {}): DbDoc => ({
  version: 2, mutatedAt: T0, deviceId: "d", nextDeckId: 100, nextCardId: 100,
  nextTodoId: 100, decks: [], cards, todos: [], ...parts,
});

/** A machine: its own document and its own memory of the last agreement. */
class Machine {
  doc: DbDoc;
  base: SyncBase | null;

  constructor(doc: DbDoc, base: SyncBase | null = null) {
    this.doc = doc;
    this.base = base;
  }

  edit(next: DbDoc) { this.doc = next; }

  /** One sync tick: merge the file in, then write back if we hold more. */
  sync(file: { doc: DbDoc }) {
    const { doc: merged, report } = mergeDocs(this.base, this.doc, file.doc);
    this.doc = merged;
    this.base = baseOf(merged);
    if (report.remoteChanged) {
      file.doc = merged;
      // The writer's base is what it just published.
      this.base = baseOf(merged);
    }
    return report;
  }
}

const fronts = (d: DbDoc) => d.cards.map((c) => c.front).sort();

test("two machines editing at once keep both edits", () => {
  const start = doc([card(10, "one", T0), card(11, "two", T0)]);
  const file = { doc: start };
  const a = new Machine(structuredClone(start), baseOf(start));
  const b = new Machine(structuredClone(start), baseOf(start));

  a.edit(doc([card(10, "one edited by A", at(5)), card(11, "two", T0)]));
  b.edit(doc([card(10, "one", T0), card(11, "two edited by B", at(6))]));

  a.sync(file);
  b.sync(file);
  a.sync(file);

  assert.deepEqual(fronts(a.doc), ["one edited by A", "two edited by B"]);
  assert.deepEqual(fronts(b.doc), fronts(a.doc));
  assert.deepEqual(fronts(file.doc), fronts(a.doc));
});

test("the studied-today case: a change on A reaches B", () => {
  const start = doc([card(10, "vocab", T0)]);
  const file = { doc: start };
  const a = new Machine(structuredClone(start), baseOf(start));
  const b = new Machine(structuredClone(start), baseOf(start));

  a.edit(doc([card(10, "vocab studied", at(2))]));
  a.sync(file);
  b.sync(file);

  assert.deepEqual(fronts(b.doc), ["vocab studied"]);
});

test("a stale machine no longer erases the other's work", () => {
  // B has been open for hours doing nothing; A adds a hundred cards.
  const start = doc([card(10, "seed", T0)]);
  const file = { doc: start };
  const a = new Machine(structuredClone(start), baseOf(start));
  const b = new Machine(structuredClone(start), baseOf(start));

  const added = Array.from({ length: 100 }, (_, i) => card(200 + i, `added ${i}`, at(10), at(10)));
  a.edit(doc([card(10, "seed", T0), ...added]));
  a.sync(file);

  // B now touches one card — under the old rule its whole document, lacking
  // A's hundred, would have replaced the file.
  b.edit(doc([card(10, "seed touched by B", at(30))]));
  b.sync(file);

  assert.equal(file.doc.cards.length, 101, "A's hundred survived B's push");
  assert.ok(fronts(file.doc).includes("seed touched by B"), "B's edit survived too");
});

test("three rounds of alternating edits converge", () => {
  const start = doc([card(10, "base", T0)]);
  const file = { doc: start };
  const a = new Machine(structuredClone(start), baseOf(start));
  const b = new Machine(structuredClone(start), baseOf(start));

  for (let round = 1; round <= 3; round++) {
    a.edit({ ...a.doc, cards: [...a.doc.cards, card(300 + round, `A${round}`, at(round * 10), at(round * 10))] });
    a.sync(file);
    b.edit({ ...b.doc, cards: [...b.doc.cards, card(400 + round, `B${round}`, at(round * 10 + 1), at(round * 10 + 1))] });
    b.sync(file);
    a.sync(file);
  }

  assert.deepEqual(fronts(a.doc), fronts(b.doc));
  assert.deepEqual(fronts(a.doc), fronts(file.doc));
  assert.equal(a.doc.cards.length, 7, "one seed plus six additions");
});

test("a delete on one machine sticks after a full round trip", () => {
  const start = doc([card(10, "keep", T0), card(11, "remove", T0)]);
  const file = { doc: start };
  const a = new Machine(structuredClone(start), baseOf(start));
  const b = new Machine(structuredClone(start), baseOf(start));

  a.edit(doc([card(10, "keep", T0)]));
  a.sync(file);
  b.sync(file);
  a.sync(file);
  b.sync(file);

  assert.deepEqual(fronts(a.doc), ["keep"]);
  assert.deepEqual(fronts(b.doc), ["keep"]);
  assert.deepEqual(fronts(file.doc), ["keep"]);
});
