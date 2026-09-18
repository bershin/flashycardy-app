/**
 * A note's body, which is HTML now and was plain text before.
 *
 * Notes were written into a textarea and stored as typed. Giving them the same
 * editor the cards use means storing HTML instead, and every note written until
 * now is still sitting there as plain text with real newlines in it. Handed to
 * an HTML editor as-is, those newlines collapse and a page of SQL becomes one
 * long line — so the old shape is converted on the way in, and the new one is
 * left alone.
 *
 * Nothing is rewritten on disk by reading. A note is only stored as HTML once
 * it has actually been edited.
 */

/** Looks like markup rather than something somebody typed. */
function looksLikeHtml(body: string): boolean {
  return /<\/?[a-z][a-z0-9]*(\s[^>]*)?>/i.test(body);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * What the editor should open with.
 *
 * Blank lines separate paragraphs and single newlines become breaks, which is
 * how the text was being read on screen before — a run of SQL keeps its lines
 * and the gaps between its statements.
 */
export function noteBodyToHtml(body: string): string {
  if (looksLikeHtml(body)) return body;
  if (!body.trim()) return "";
  return body
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * The words alone, for searching and for the one-line preview in the list.
 *
 * Block ends become newlines so the preview takes the first real line rather
 * than the whole note run together, and searching cannot match a tag name or an
 * attribute that the writer never typed.
 */
export function noteBodyToText(body: string): string {
  return body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    // Last, so an escaped entity in the source cannot be decoded twice.
    .replace(/&amp;/gi, "&");
}
