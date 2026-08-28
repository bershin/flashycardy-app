import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSpellingSheet, spellingBackHtml } from "./spelling-sheet.ts";

const SHEET = [
  "Word\tCategory\tMeaning / Note\tExample Sentence\tSpelling Tip",
  "necessary\tDfE Year 5–6 statutory\tneeded; required\tIt is necessary to check your work.\tOne Collar, two Sleeves — 1 'c', 2 's'.",
  "identity\tDfE Year 5–6 statutory\twho or what someone is\tThe thief's identity was unknown.\tIdent + ity, like 'identify'.",
].join("\n");

test("reads the sheet's own columns and skips Category", () => {
  const rows = parseSpellingSheet(SHEET);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], {
    word: "identity",
    meaning: "who or what someone is",
    sentence: "The thief's identity was unknown.",
    tip: "Ident + ity, like 'identify'.",
  });
  // The giveaway that headings were used rather than positions.
  assert.ok(!JSON.stringify(rows).includes("statutory"));
});

test("without headings, columns are taken in the sheet's order", () => {
  const rows = parseSpellingSheet("rhythm\ta pattern of sound\tThe song has rhythm.\tRHYTHM Helps Your Two Hips Move.");
  assert.equal(rows[0].meaning, "a pattern of sound");
  assert.equal(rows[0].tip, "RHYTHM Helps Your Two Hips Move.");
});

test("pipes work as well as tabs", () => {
  const rows = parseSpellingSheet("Word | Meaning | Sentence | Tip\nqueue | a line of people | We had to queue. | Four silent letters.");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].word, "queue");
  assert.equal(rows[0].tip, "Four silent letters.");
});

test("a plain word list is still a sheet", () => {
  const rows = parseSpellingSheet("necessary\nseparate\ndefinite");
  assert.deepEqual(rows.map((r) => r.word), ["necessary", "separate", "definite"]);
  assert.equal(rows[0].meaning, undefined);
});

test("the back carries the word and every section given", () => {
  const html = spellingBackHtml(parseSpellingSheet(SHEET)[1]);
  assert.match(html, /<strong>identity<\/strong>/);
  for (const label of ["Meaning", "Sentence", "Tip"]) {
    assert.match(html, new RegExp(`<u>${label}:</u>`));
  }
  assert.match(html, /The thief&#39;s identity was unknown\.|The thief's identity was unknown\./);
});

test("every card gets all three headings, empty ones ready to fill", () => {
  const html = spellingBackHtml({ word: "rhythm", tip: "No vowels except y." });
  for (const label of ["Meaning", "Sentence", "Tip"]) {
    assert.match(html, new RegExp(`<u>${label}:</u>`), `${label} was missing`);
  }
  assert.match(html, /No vowels except y\./);
  // The two the sheet did not fill are present and empty, not filled with a
  // placeholder that would have to be deleted before writing.
  assert.equal(html.match(/<pre><code><\/code><\/pre>/g)?.length, 2);
});

test("angle brackets in a sheet cannot become markup", () => {
  const html = spellingBackHtml({ word: "x", meaning: "<script>alert(1)</script>" });
  assert.ok(!html.includes("<script>"), "raw markup survived into the card");
  assert.match(html, /&lt;script&gt;/);
});
