/**
 * Reconciling two versions of the document that were edited apart.
 *
 * Sync used to be last-writer-wins over the whole file: whichever machine
 * pushed most recently replaced everything the other had done. Two computers
 * open in the same hour did not conflict, they overwrote — quietly, because
 * from the loser's side nothing had failed.
 *
 * This merges by record instead. A card edited on one machine and a deck
 * renamed on the other both survive, because they are different records; the
 * same record edited in both places falls back to the later `updatedAt`, which
 * is the one judgement call that cannot be avoided.
 *
 * Deletion is the part that needs memory. A record present on one side and
 * absent on the other is either newly written there or newly deleted here, and
 * the two are indistinguishable from the documents alone. So each device
 * remembers what the last agreed version contained — ids and their timestamps,
 * not their contents, which is a few tens of kilobytes rather than a copy of
 * every image. Against that, absence has a meaning.
 *
 * Everything here is pure: no store, no network, no clock beyond what is passed
 * in. That is deliberate — this is the code that decides whether someone's work
 * survives, and it should be possible to test every branch of it directly.
 */

import type { CardRow, DayTodo, DbDoc, DeckRow, Memo } from "./types";

/**
 * What the last agreed version held: each record's id against the `updatedAt`
 * it had then. Absence of an id means the record did not exist.
 */
export type SyncBase = {
  decks: Record<number, number>;
  cards: Record<number, number>;
  todos: Record<number, number>;
  /** Absent in a base written before notes existed; reads as "none known". */
  memos?: Record<number, number>;
};

type Row = { id: number; createdAt: Date; updatedAt: Date };

/**
 * When a row last changed, for deciding which side is newer.
 *
 * Not always `updatedAt`. Marking a deck studied deliberately leaves that field
 * alone — studying is not editing — so a deck whose only change is the study
 * stamp looks untouched, and two devices comparing `updatedAt` would tie and
 * each keep its own copy. That is precisely why "studied today" never crossed
 * between machines. Anything that records a change has to be part of the
 * comparison, whether or not it is an edit.
 */
const deckStamp = (deck: DeckRow) =>
  Math.max(deck.updatedAt.getTime(), deck.lastStudiedAt?.getTime() ?? 0);

const rowStamp = (row: Row) => row.updatedAt.getTime();

function stamps<T extends Row>(
  rows: readonly T[],
  stampOf: (row: T) => number,
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const row of rows) out[row.id] = stampOf(row);
  return out;
}

/** The manifest to remember after a successful sync. */
export function baseOf(doc: DbDoc): SyncBase {
  return {
    decks: stamps(doc.decks, deckStamp),
    cards: stamps(doc.cards, rowStamp),
    todos: stamps(doc.todos, rowStamp),
    memos: stamps(doc.memos, rowStamp),
  };
}

/** How the merge differed from each side, so the caller knows what to write. */
export type MergeReport = {
  /** The merge is not what this device already had: adopt it locally. */
  localChanged: boolean;
  /** The merge is not what GitHub holds: push it back. */
  remoteChanged: boolean;
  /** Records kept from each side, and records dropped as deleted. */
  fromLocal: number;
  fromRemote: number;
  deleted: number;
  /** Records that arrived sharing an id with a different local record. */
  renumbered: number;
};

type Tally = { fromLocal: number; fromRemote: number; deleted: number };

function mergeRows<T extends Row>(
  base: Record<number, number> | null,
  local: readonly T[],
  remote: readonly T[],
  stampOf: (row: T) => number,
  report: MergeReport,
  tally: Tally,
): T[] {
  const byLocal = new Map(local.map((row) => [row.id, row]));
  const byRemote = new Map(remote.map((row) => [row.id, row]));
  const merged: T[] = [];

  for (const id of new Set([...byLocal.keys(), ...byRemote.keys()])) {
    const mine = byLocal.get(id);
    const theirs = byRemote.get(id);

    if (mine && theirs) {
      // The same record on both sides. Later wins; a tie keeps the local copy,
      // which is arbitrary but has to be decided the same way on both machines
      // or they would swap versions forever.
      if (stampOf(mine) >= stampOf(theirs)) {
        merged.push(mine);
        tally.fromLocal += 1;
        if (stampOf(mine) > stampOf(theirs)) {
          report.remoteChanged = true;
        }
      } else {
        merged.push(theirs);
        tally.fromRemote += 1;
        report.localChanged = true;
      }
      continue;
    }

    const known = base?.[id];
    const only = (mine ?? theirs) as T;
    const isMine = Boolean(mine);

    if (!base || known === undefined) {
      // Either this device has never agreed a version with GitHub — in which
      // case nothing can be read as a deletion and everything is kept — or the
      // record is simply new on the side that has it.
      merged.push(only);
      if (isMine) {
        tally.fromLocal += 1;
        report.remoteChanged = true;
      } else {
        tally.fromRemote += 1;
        report.localChanged = true;
      }
      continue;
    }

    if (stampOf(only) > known) {
      // Deleted on one side, edited on the other since they last agreed. The
      // edit is kept: a deletion that loses an edit is unrecoverable, while a
      // deletion that has to be repeated is an annoyance.
      merged.push(only);
      if (isMine) {
        tally.fromLocal += 1;
        report.remoteChanged = true;
      } else {
        tally.fromRemote += 1;
        report.localChanged = true;
      }
      continue;
    }

    // Present when they last agreed, untouched since, and now gone from one
    // side: that is a deletion, and it applies.
    tally.deleted += 1;
    if (isMine) report.localChanged = true;
    else report.remoteChanged = true;
  }

  return merged;
}

/**
 * Two machines offline at once both hand out the same next id, and the records
 * are not the same record. Whichever arrives second is renumbered before the
 * merge can mistake them for one another.
 *
 * Told apart by `createdAt`: two devices allocating the same number produce
 * rows created at different instants, whereas one record synced normally has
 * the same creation stamp on both sides.
 */
function renumberRemote(
  base: SyncBase | null,
  local: DbDoc,
  remote: DbDoc,
  report: MergeReport,
): DbDoc {
  const collides = <T extends Row>(
    mine: Map<number, T>,
    theirs: readonly T[],
    known: Record<number, number> | undefined,
  ): Map<number, number> => {
    const map = new Map<number, number>();
    for (const row of theirs) {
      const ours = mine.get(row.id);
      if (!ours) continue;
      if (known && known[row.id] !== undefined) continue;
      if (ours.createdAt.getTime() === row.createdAt.getTime()) continue;
      map.set(row.id, 0);
    }
    return map;
  };

  const deckMap = collides(
    new Map(local.decks.map((d) => [d.id, d])),
    remote.decks,
    base?.decks,
  );
  const cardMap = collides(
    new Map(local.cards.map((c) => [c.id, c])),
    remote.cards,
    base?.cards,
  );
  const todoMap = collides(
    new Map(local.todos.map((t) => [t.id, t])),
    remote.todos,
    base?.todos,
  );
  const memoMap = collides(
    new Map(local.memos.map((m) => [m.id, m])),
    remote.memos,
    base?.memos,
  );

  if (deckMap.size + cardMap.size + todoMap.size + memoMap.size === 0)
    return remote;

  const next = (rows: readonly Row[], ...counters: number[]) =>
    Math.max(...counters, ...rows.map((r) => r.id + 1), 1);

  let nextDeck = next(
    [...local.decks, ...remote.decks],
    local.nextDeckId,
    remote.nextDeckId,
  );
  let nextCard = next(
    [...local.cards, ...remote.cards],
    local.nextCardId,
    remote.nextCardId,
  );
  let nextTodo = next(
    [...local.todos, ...remote.todos],
    local.nextTodoId,
    remote.nextTodoId,
  );
  let nextMemo = next(
    [...local.memos, ...remote.memos],
    local.nextMemoId,
    remote.nextMemoId,
  );

  for (const id of deckMap.keys()) deckMap.set(id, nextDeck++);
  for (const id of cardMap.keys()) cardMap.set(id, nextCard++);
  for (const id of todoMap.keys()) todoMap.set(id, nextTodo++);
  for (const id of memoMap.keys()) memoMap.set(id, nextMemo++);

  report.renumbered =
    deckMap.size + cardMap.size + todoMap.size + memoMap.size;

  const decks: DeckRow[] = remote.decks.map((deck) => ({
    ...deck,
    id: deckMap.get(deck.id) ?? deck.id,
    // A renumbered deck takes its children with it.
    parentId:
      deck.parentId === null
        ? null
        : (deckMap.get(deck.parentId) ?? deck.parentId),
  }));
  const cards: CardRow[] = remote.cards.map((card) => ({
    ...card,
    id: cardMap.get(card.id) ?? card.id,
    deckId: deckMap.get(card.deckId) ?? card.deckId,
  }));
  const todos: DayTodo[] = remote.todos.map((todo) => ({
    ...todo,
    id: todoMap.get(todo.id) ?? todo.id,
  }));
  const memos: Memo[] = remote.memos.map((memo) => ({
    ...memo,
    id: memoMap.get(memo.id) ?? memo.id,
  }));

  return {
    ...remote,
    decks,
    cards,
    todos,
    memos,
    nextDeckId: nextDeck,
    nextCardId: nextCard,
    nextTodoId: nextTodo,
    nextMemoId: nextMemo,
  };
}

/**
 * Merge what GitHub holds into what this device holds.
 *
 * `base` is what the two last agreed on, or null if they never have — in which
 * case nothing is treated as deleted and the result is the union, which can
 * resurrect a record deleted before this device ever synced. That is the safe
 * direction to be wrong in, and it self-corrects on the next sync.
 */
export function mergeDocs(
  base: SyncBase | null,
  local: DbDoc,
  incoming: DbDoc,
  now: Date = new Date(),
): { doc: DbDoc; report: MergeReport } {
  const report: MergeReport = {
    localChanged: false,
    remoteChanged: false,
    fromLocal: 0,
    fromRemote: 0,
    deleted: 0,
    renumbered: 0,
  };
  const tally: Tally = { fromLocal: 0, fromRemote: 0, deleted: 0 };
  const remote = renumberRemote(base, local, incoming, report);
  if (report.renumbered > 0) {
    // The renumbered rows are new to both sides, so both need the result.
    report.localChanged = true;
    report.remoteChanged = true;
  }

  const decks = mergeRows(
    base?.decks ?? null,
    local.decks,
    remote.decks,
    deckStamp,
    report,
    tally,
  );
  const cards = mergeRows(
    base?.cards ?? null,
    local.cards,
    remote.cards,
    rowStamp,
    report,
    tally,
  );
  const todos = mergeRows(
    base?.todos ?? null,
    local.todos,
    remote.todos,
    rowStamp,
    report,
    tally,
  );
  // `?? null` matters more here than elsewhere: a base agreed before notes
  // existed has no `memos` key at all, and treating that as "nothing existed"
  // would read every note on both sides as newly deleted.
  const memos = mergeRows(
    base?.memos ?? null,
    local.memos,
    remote.memos,
    rowStamp,
    report,
    tally,
  );

  report.fromLocal = tally.fromLocal;
  report.fromRemote = tally.fromRemote;
  report.deleted = tally.deleted;

  const highest = (rows: readonly Row[]) =>
    rows.reduce((max, row) => Math.max(max, row.id + 1), 1);

  /**
   * The collection's own name and face.
   *
   * One record rather than a list, so there is nothing to match up by id and
   * nothing to delete: whichever side named it more recently wins, and a side
   * that has never named it loses to one that has. No base is consulted for the
   * same reason — absence here means "not yet named", never "deleted".
   */
  const profile = ((): DbDoc["profile"] => {
    if (!local.profile) return remote.profile;
    if (!remote.profile) return local.profile;
    return remote.profile.updatedAt.getTime() > local.profile.updatedAt.getTime()
      ? remote.profile
      : local.profile;
  })();
  if (profile !== local.profile) report.localChanged = true;
  if (profile !== remote.profile) report.remoteChanged = true;

  const doc: DbDoc = {
    // Carried from the local document rather than the constant: this decides
    // nothing about versions, and importing one would make the module depend on
    // something at run time when it needs nothing but its arguments.
    version: local.version,
    // Stamped now only if the document actually moved, so an unchanged
    // document does not look freshly edited to the next device that reads it.
    mutatedAt: report.localChanged ? now : local.mutatedAt,
    deviceId: local.deviceId,
    // Never reused, even where a merge dropped the row that had claimed one.
    nextDeckId: Math.max(local.nextDeckId, remote.nextDeckId, highest(decks)),
    nextCardId: Math.max(local.nextCardId, remote.nextCardId, highest(cards)),
    nextTodoId: Math.max(local.nextTodoId, remote.nextTodoId, highest(todos)),
    nextMemoId: Math.max(local.nextMemoId, remote.nextMemoId, highest(memos)),
    decks,
    cards,
    todos,
    memos,
    profile,
  };

  return { doc, report };
}
