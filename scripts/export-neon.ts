/**
 * One-time migration: dump the Neon Postgres database to the `data.json` format
 * the app now uses.
 *
 * Run this BEFORE cancelling the Neon subscription — once the database is gone
 * the data is unrecoverable.
 *
 *   DATABASE_URL='postgres://...' npm run export:neon
 *
 * Writes ./data.json. Commit that file to your private data repo, then point the
 * app's Settings page at it.
 *
 * The schema is declared inline rather than imported from `src/db/schema.ts` so
 * that this script keeps working after that file is deleted.
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

/** Every deck is reassigned to this owner, replacing the Clerk user id. */
const LOCAL_USER_ID = "local-user";
const OUTPUT = "data.json";

type DeckRecord = {
  id: number;
  userId: string;
  title: string;
  description: string | null;
  parentId: number | null;
  position: number;
  lastStudiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type CardRecord = {
  id: number;
  deckId: number;
  front: string;
  back: string;
  nextReviewAt: Date;
  consecutiveCorrect: number;
  createdAt: Date;
  updatedAt: Date;
};

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set.\n" +
        "Put it in a .env file at the project root, or pass it inline:\n" +
        "  DATABASE_URL='postgres://...' npm run export:neon",
    );
    process.exit(1);
  }

  const sql = neon(url);

  console.log("Reading decks…");
  const deckRows = (await sql`
    SELECT id, "userId", title, description, "parentId", position,
           "lastStudiedAt", "createdAt", "updatedAt"
    FROM decks
    ORDER BY id
  `) as unknown as DeckRecord[];

  console.log("Reading cards…");
  const cardRows = (await sql`
    SELECT id, "deckId", front, back, "nextReviewAt", "consecutiveCorrect",
           "createdAt", "updatedAt"
    FROM cards
    ORDER BY id
  `) as unknown as CardRecord[];

  const distinctUsers = new Set(deckRows.map((d) => d.userId));
  if (distinctUsers.size > 1) {
    console.warn(
      `Warning: found ${distinctUsers.size} distinct userIds. All decks will be ` +
        `reassigned to "${LOCAL_USER_ID}", merging them into one collection.`,
    );
  }

  // Cards whose deck no longer exists would be invisible in the app and would
  // bloat the sync payload. Postgres' FK made this impossible; report it anyway.
  const deckIds = new Set(deckRows.map((d) => d.id));
  const orphanedCards = cardRows.filter((c) => !deckIds.has(c.deckId));
  if (orphanedCards.length > 0) {
    console.warn(
      `Warning: dropping ${orphanedCards.length} card(s) with no matching deck.`,
    );
  }

  const doc = {
    version: 1 as const,
    mutatedAt: new Date().toISOString(),
    deviceId: "neon-export",
    nextDeckId: deckRows.reduce((max, d) => Math.max(max, d.id), 0) + 1,
    nextCardId: cardRows.reduce((max, c) => Math.max(max, c.id), 0) + 1,
    decks: deckRows.map((d) => ({
      id: d.id,
      userId: LOCAL_USER_ID,
      title: d.title,
      description: d.description,
      parentId: d.parentId,
      position: d.position,
      lastStudiedAt: isoOrNull(d.lastStudiedAt),
      createdAt: iso(d.createdAt),
      updatedAt: iso(d.updatedAt),
    })),
    cards: cardRows
      .filter((c) => deckIds.has(c.deckId))
      .map((c) => ({
        id: c.id,
        deckId: c.deckId,
        front: c.front,
        back: c.back,
        nextReviewAt: iso(c.nextReviewAt),
        consecutiveCorrect: c.consecutiveCorrect,
        createdAt: iso(c.createdAt),
        updatedAt: iso(c.updatedAt),
      })),
  };

  const json = JSON.stringify(doc, null, 2);
  writeFileSync(OUTPUT, json);

  const megabytes = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  const topLevel = doc.decks.filter((d) => d.parentId === null).length;

  console.log(
    `\nWrote ${OUTPUT}\n` +
      `  decks:  ${doc.decks.length} (${topLevel} top-level, ${doc.decks.length - topLevel} sub-decks)\n` +
      `  cards:  ${doc.cards.length}\n` +
      `  size:   ${megabytes} MB\n\n` +
      `Check these counts against the database before cancelling Neon.`,
  );

  if (Buffer.byteLength(json) > 40 * 1024 * 1024) {
    console.warn(
      "Warning: this file is over 40 MB, largely from base64 images embedded in " +
        "cards. The GitHub Contents API hard-stops at 100 MB.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
