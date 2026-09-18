import assert from "node:assert/strict";
import { test } from "node:test";
import { noteBodyToHtml, noteBodyToText } from "./note-body.ts";

test("a note typed before this keeps its lines", () => {
  const typed = "SELECT 1\nFROM t\n\nAnd then:\nSELECT 2";
  assert.equal(
    noteBodyToHtml(typed),
    "<p>SELECT 1<br>FROM t</p><p>And then:<br>SELECT 2</p>",
  );
});

test("a note already written as HTML is left alone", () => {
  const html = "<p>Already <strong>rich</strong></p>";
  assert.equal(noteBodyToHtml(html), html);
});

test("an empty note opens empty rather than as a blank paragraph", () => {
  assert.equal(noteBodyToHtml(""), "");
  assert.equal(noteBodyToHtml("   \n  "), "");
});

test("angle brackets in plain text survive as text, not as markup", () => {
  // The case that matters for these notes: a comparison in a WHERE clause.
  assert.equal(noteBodyToHtml("WHERE a < b & c > d"), "<p>WHERE a &lt; b &amp; c &gt; d</p>");
  assert.equal(noteBodyToText(noteBodyToHtml("WHERE a < b & c > d")), "WHERE a < b & c > d\n");
});

test("reading back the words drops the tags", () => {
  assert.equal(
    noteBodyToText("<p>One</p><p>Two<br>Three</p>").trim(),
    "One\nTwo\nThree",
  );
});

test("plain text reads back unchanged", () => {
  assert.equal(noteBodyToText("just words"), "just words");
});

test("an ampersand is decoded once, not twice", () => {
  // &amp;lt; is a literal "&lt;" the writer typed, not a less-than sign.
  assert.equal(noteBodyToText("<p>&amp;lt;</p>").trim(), "&lt;");
});
