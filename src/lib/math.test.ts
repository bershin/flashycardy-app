import assert from "node:assert/strict";
import { test } from "node:test";
import { fractionLatex, mathToText, toLatex } from "./math.ts";

test("72 over 5 squared", () => {
  assert.equal(fractionLatex("72", "5^2"), "\\dfrac{72}{5^{2}}");
});

test("a raised digit from the toolbar reads as a power", () => {
  assert.equal(fractionLatex("72", "5²"), "\\dfrac{72}{5^{2}}");
});

test("signs in a fraction, with tall brackets round it", () => {
  assert.equal(
    fractionLatex("3×3×3×3", "3-3+3+3+3", true),
    "\\left(\\dfrac{3\\times 3\\times 3\\times 3}{3-3+3+3+3}\\right)",
  );
});

test("a star is a times sign and ÷ is division", () => {
  assert.equal(toLatex("6*2 ÷ 3"), "6\\times 2 \\div  3");
});

test("roots, with and without brackets", () => {
  assert.equal(toLatex("√81"), "\\sqrt{81}");
  assert.equal(toLatex("√(9+16)"), "\\sqrt{9+16}");
  assert.equal(toLatex("sqrt(2^2)"), "\\sqrt{2^{2}}");
});

test("a bracketed power", () => {
  assert.equal(toLatex("2^(n+1)"), "2^{n+1}");
});

test("characters LaTeX would act on are printed instead", () => {
  assert.equal(toLatex("50% & {x}_1"), "50\\% \\& \\{x\\}\\_1");
});

test("a dangling ^ or √ does not break the drawing", () => {
  assert.equal(toLatex("2^"), "2\\^{}");
  assert.equal(toLatex("√"), "\\surd{}");
});

test("a fraction in card HTML reads as text for search and summaries", () => {
  const html =
    '<p>Work out <span data-latex="\\dfrac{72}{5^{2}}" data-top="72" data-bottom="5^2" data-type="inline-math"></span></p>';
  assert.equal(mathToText(html), "<p>Work out  72/5^2 </p>");
});

test("a fraction's text keeps its brackets and groups each side", () => {
  const html =
    '<span data-latex="x" data-top="3×3" data-bottom="3-3+3" data-brackets="true" data-type="inline-math"></span>';
  assert.equal(mathToText(html), " ((3×3)/(3-3+3)) ");
});

test("HTML-escaped characters come back as typed", () => {
  const html =
    '<span data-latex="x" data-top="a &amp; b" data-bottom="2" data-type="inline-math"></span>';
  assert.equal(mathToText(html), " (a &amp; b)/2 ");
});
