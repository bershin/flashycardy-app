import assert from "node:assert/strict";
import { test } from "node:test";
import { baseOf, mergeDocs } from "./merge.ts";
import type { CardRow, DbDoc, DeckRow, Memo } from "./types.ts";

const T0 = new Date("2026-08-01T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function deck(id: number, title: string, updated: Date, created = T0): DeckRow {
  return {
    id, userId: "local-user", title, description: null, parentId: null,
    position: id, lastStudiedAt: null, createdAt: created, updatedAt: updated,
  };
}

function card(id: number, deckId: number, front: string, updated: Date, created = T0): CardRow {
  return {
    id, deckId, type: "basic", front, back: "a", schedule: "weekly",
    nextReviewAt: T0, consecutiveCorrect: 0, lastCorrectAt: null, timesMissed: 0,
    createdAt: created, updatedAt: updated,
  };
}

function doc(parts: Partial<DbDoc> = {}): DbDoc {
  return {
    version: 2, mutatedAt: T0, deviceId: "dev", nextDeckId: 100,
    nextCardId: 100, nextTodoId: 100, nextMemoId: 100,
    decks: [], cards: [], todos: [], memos: [], ...parts,
  };
}

const fronts = (d: DbDoc) => d.cards.map((c) => c.front).sort();
const ids = (d: DbDoc) => d.cards.map((c) => c.id).sort((a, b) => a - b);

test("edits to different records on two machines both survive", () => {
  const shared = doc({ decks: [deck(1, "Maths", T0)], cards: [card(10, 1, "one", T0), card(11, 1, "two", T0)] });
  const base = baseOf(shared);

  const local = doc({ decks: [deck(1, "Maths", T0)], cards: [card(10, 1, "one EDITED HERE", at(5)), card(11, 1, "two", T0)] });
  const remote = doc({ decks: [deck(1, "Maths", T0)], cards: [card(10, 1, "one", T0), card(11, 1, "two EDITED THERE", at(6))] });

  const { doc: merged, report } = mergeDocs(base, local, remote);
  assert.deepEqual(fronts(merged), ["one EDITED HERE", "two EDITED THERE"]);
  assert.equal(report.localChanged, true, "local must adopt the remote edit");
  assert.equal(report.remoteChanged, true, "remote must receive the local edit");
});

test("the same record edited in both places keeps the later edit", () => {
  const shared = doc({ cards: [card(10, 1, "original", T0)] });
  const base = baseOf(shared);
  const local = doc({ cards: [card(10, 1, "mine", at(5))] });
  const remote = doc({ cards: [card(10, 1, "theirs", at(9))] });

  assert.deepEqual(fronts(mergeDocs(base, local, remote).doc), ["theirs"]);
  assert.deepEqual(fronts(mergeDocs(base, remote, local).doc), ["theirs"], "same answer whichever side merges");
});

test("a record created on the other machine arrives", () => {
  const base = baseOf(doc());
  const local = doc();
  const remote = doc({ cards: [card(10, 1, "new over there", at(3))] });
  const { doc: merged, report } = mergeDocs(base, local, remote);
  assert.deepEqual(fronts(merged), ["new over there"]);
  assert.equal(report.localChanged, true);
});

test("a deletion on one machine applies to the other", () => {
  const shared = doc({ cards: [card(10, 1, "doomed", T0), card(11, 1, "keeper", T0)] });
  const base = baseOf(shared);
  const local = shared;                                   // still has both
  const remote = doc({ cards: [card(11, 1, "keeper", T0)] }); // deleted 10

  const { doc: merged, report } = mergeDocs(base, local, remote);
  assert.deepEqual(fronts(merged), ["keeper"]);
  assert.equal(report.deleted, 1);
  assert.equal(report.localChanged, true);
});

test("a deletion does not resurrect on the next sync", () => {
  const shared = doc({ cards: [card(10, 1, "doomed", T0)] });
  const first = mergeDocs(baseOf(shared), shared, doc()).doc;
  assert.deepEqual(fronts(first), []);
  // Both sides now agree; merging again must not bring it back.
  const second = mergeDocs(baseOf(first), first, first).doc;
  assert.deepEqual(fronts(second), []);
});

test("an edit beats a delete rather than losing the work", () => {
  const shared = doc({ cards: [card(10, 1, "original", T0)] });
  const base = baseOf(shared);
  const local = doc({ cards: [card(10, 1, "edited after they deleted it", at(5))] });
  const remote = doc();

  const { doc: merged, report } = mergeDocs(base, local, remote);
  assert.deepEqual(fronts(merged), ["edited after they deleted it"]);
  assert.equal(report.remoteChanged, true, "the surviving edit must be pushed back");
});

test("with no agreed base nothing is treated as deleted", () => {
  const local = doc({ cards: [card(10, 1, "mine", T0)] });
  const remote = doc({ cards: [card(11, 1, "theirs", T0)] });
  assert.deepEqual(fronts(mergeDocs(null, local, remote).doc), ["mine", "theirs"]);
});

test("two machines that allocated the same id keep both records", () => {
  const base = baseOf(doc());
  const local = doc({ cards: [card(50, 1, "written here", at(1), at(1))] });
  const remote = doc({ cards: [card(50, 1, "written there", at(2), at(2))] });

  const { doc: merged, report } = mergeDocs(base, local, remote);
  assert.deepEqual(fronts(merged), ["written here", "written there"]);
  assert.equal(report.renumbered, 1);
  assert.equal(new Set(ids(merged)).size, 2, "ids must be distinct after renumbering");
  assert.ok(merged.nextCardId > Math.max(...ids(merged)), "the counter must clear every id in use");
});

test("a renumbered deck keeps its cards and its children", () => {
  const base = baseOf(doc());
  const local = doc({ decks: [deck(7, "mine", at(1), at(1))] });
  const remote = doc({
    decks: [deck(7, "theirs", at(2), at(2)), { ...deck(8, "child", at(2), at(2)), parentId: 7 }],
    cards: [card(60, 7, "belongs to theirs", at(2), at(2))],
  });

  const { doc: merged } = mergeDocs(base, local, remote);
  const theirs = merged.decks.find((d) => d.title === "theirs")!;
  const child = merged.decks.find((d) => d.title === "child")!;
  const moved = merged.cards.find((c) => c.front === "belongs to theirs")!;

  assert.notEqual(theirs.id, 7, "the arriving deck was renumbered");
  assert.equal(child.parentId, theirs.id, "its sub-deck followed it");
  assert.equal(moved.deckId, theirs.id, "its cards followed it");
  assert.ok(merged.decks.some((d) => d.id === 7 && d.title === "mine"), "the local deck kept its id");
});

test("an unchanged pair reports no work to do", () => {
  const shared = doc({ decks: [deck(1, "Maths", T0)], cards: [card(10, 1, "one", T0)] });
  const { report } = mergeDocs(baseOf(shared), shared, shared);
  assert.equal(report.localChanged, false);
  assert.equal(report.remoteChanged, false);
});

test("merging is stable: a second pass changes nothing", () => {
  const shared = doc({ cards: [card(10, 1, "a", T0), card(11, 1, "b", T0)] });
  const base = baseOf(shared);
  const local = doc({ cards: [card(10, 1, "a edited", at(5)), card(11, 1, "b", T0)] });
  const remote = doc({ cards: [card(10, 1, "a", T0), card(12, 1, "c", at(2))] });

  const once = mergeDocs(base, local, remote).doc;
  const twice = mergeDocs(baseOf(once), once, once);
  assert.deepEqual(fronts(twice.doc), fronts(once));
  assert.equal(twice.report.localChanged, false);
  assert.equal(twice.report.remoteChanged, false);
});

test("both machines reach the same document from either direction", () => {
  const shared = doc({ cards: [card(10, 1, "a", T0), card(11, 1, "b", T0)] });
  const base = baseOf(shared);
  const a = doc({ cards: [card(10, 1, "a edited on A", at(5)), card(11, 1, "b", T0), card(20, 1, "new on A", at(4), at(4))] });
  const b = doc({ cards: [card(10, 1, "a", T0), card(21, 1, "new on B", at(6), at(6))] });

  assert.deepEqual(fronts(mergeDocs(base, a, b).doc), fronts(mergeDocs(base, b, a).doc));
});

test("studying a deck on one machine shows on the other", () => {
  // The reported bug: marking a deck studied sets lastStudiedAt and leaves
  // updatedAt alone, so comparing updatedAt tied and each machine kept its own
  // copy — the tag never crossed.
  const shared = doc({ decks: [deck(1, "Maths", T0)] });
  const base = baseOf(shared);

  const studied: DeckRow = { ...deck(1, "Maths", T0), lastStudiedAt: at(30) };
  const local = doc({ decks: [deck(1, "Maths", T0)] });     // has not studied
  const remote = doc({ decks: [studied] });                  // studied over there

  const { doc: merged, report } = mergeDocs(base, local, remote);
  assert.equal(
    merged.decks[0].lastStudiedAt?.getTime(),
    at(30).getTime(),
    "the study stamp must arrive",
  );
  assert.equal(report.localChanged, true, "and this device must adopt it");
});

test("a studied deck is not overwritten by an unstudied copy", () => {
  const shared = doc({ decks: [deck(1, "Maths", T0)] });
  const base = baseOf(shared);
  const studied: DeckRow = { ...deck(1, "Maths", T0), lastStudiedAt: at(30) };

  // This machine did the studying; the other one has the older, unstudied row.
  const { doc: merged, report } = mergeDocs(
    base,
    doc({ decks: [studied] }),
    doc({ decks: [deck(1, "Maths", T0)] }),
  );
  assert.equal(merged.decks[0].lastStudiedAt?.getTime(), at(30).getTime());
  assert.equal(report.remoteChanged, true, "and it must be pushed back");
});

test("an unsynced document does not clear a populated one", () => {
  // The failure that started this: a fresh device pulling, or a stale one
  // pushing, must never empty the other side.
  const populated = doc({ decks: [deck(1, "Maths", T0)], cards: [card(10, 1, "one", T0), card(11, 1, "two", T0)] });
  const fresh = doc();
  const { doc: merged } = mergeDocs(null, fresh, populated);
  assert.equal(merged.cards.length, 2);
  assert.equal(merged.decks.length, 1);
});

function memo(id: number, title: string, updated: Date, created = T0): Memo {
  return {
    id, userId: "local-user", title, body: title.toLowerCase(),
    pinned: false, createdAt: created, updatedAt: updated,
  };
}

const titles = (d: DbDoc) => d.memos.map((m) => m.title).sort();

test("notes written on two machines both survive", () => {
  const shared = doc({ memos: [memo(1, "Shopping", T0)] });
  const base = baseOf(shared);

  const local = doc({ memos: [memo(1, "Shopping", T0), memo(2, "Recipes", at(5))] });
  const remote = doc({ memos: [memo(1, "Shopping", T0), memo(3, "Songs", at(6))] });

  const { doc: merged } = mergeDocs(base, local, remote);
  assert.deepEqual(titles(merged), ["Recipes", "Shopping", "Songs"]);
});

test("the later edit of the same note wins", () => {
  const shared = doc({ memos: [memo(1, "Draft", T0)] });
  const base = baseOf(shared);

  const local = doc({ memos: [memo(1, "Mine", at(5))] });
  const remote = doc({ memos: [memo(1, "Theirs", at(9))] });

  const { doc: merged } = mergeDocs(base, local, remote);
  assert.deepEqual(titles(merged), ["Theirs"]);
});

test("a note deleted on one machine stays deleted", () => {
  const shared = doc({ memos: [memo(1, "Gone", T0), memo(2, "Kept", T0)] });
  const base = baseOf(shared);

  // Deleted here, untouched there.
  const local = doc({ memos: [memo(2, "Kept", T0)] });
  const remote = doc({ memos: [memo(1, "Gone", T0), memo(2, "Kept", T0)] });

  const { doc: merged } = mergeDocs(base, local, remote);
  assert.deepEqual(titles(merged), ["Kept"]);
});

test("a base agreed before notes existed does not delete every note", () => {
  // What `baseOf` produced before `memos` was part of the document.
  const base = { ...baseOf(doc()), memos: undefined };

  const local = doc({ memos: [memo(1, "Mine", T0)] });
  const remote = doc({ memos: [memo(2, "Theirs", T0)] });

  const { doc: merged } = mergeDocs(base, local, remote);
  assert.deepEqual(titles(merged), ["Mine", "Theirs"]);
});

test("two notes given the same id apart are both kept, renumbered", () => {
  // Never synced, so both machines allocated id 1 for different notes.
  const local = doc({ memos: [memo(1, "Mine", T0, at(1))] });
  const remote = doc({ memos: [memo(1, "Theirs", T0, at(2))] });

  const { doc: merged, report } = mergeDocs(null, local, remote);
  assert.deepEqual(titles(merged), ["Mine", "Theirs"]);
  assert.equal(report.renumbered, 1);
  assert.equal(new Set(merged.memos.map((m) => m.id)).size, 2);
});
