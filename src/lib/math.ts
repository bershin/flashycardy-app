/**
 * Fractions on a card.
 *
 * A stacked fraction is drawn by KaTeX, which wants LaTeX: `\dfrac{72}{5^{2}}`.
 * Nobody revising for an exam should have to type that, so the editor asks for
 * the top and the bottom as they would be written on a calculator — `72` and
 * `5^2` — and this turns them into LaTeX.
 *
 * Both forms are stored on the node: the LaTeX to draw it, and the top and
 * bottom as typed so it can be opened for editing without reading LaTeX back,
 * and so the places that want plain text (search, the study summary, the AI
 * template step) can say `72/5^2` instead of nothing.
 *
 * Nothing here imports KaTeX. The conversion is plain string work, which keeps
 * it testable on its own and keeps KaTeX out of anything that only needs text.
 */

/** What the stored HTML of a fraction looks like, for finding it again. */
export const MATH_SPAN = /<span\b([^>]*\bdata-type="inline-math"[^>]*)>[\s\S]*?<\/span>/g;

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};

/** Characters LaTeX would read as commands rather than print. */
const ESCAPES: Record<string, string> = {
  "\\": "\\backslash{}",
  "{": "\\{",
  "}": "\\}",
  "#": "\\#",
  "$": "\\$",
  "%": "\\%",
  "&": "\\&",
  "_": "\\_",
  "~": "\\sim{}",
};

/** A run that a power or root applies to when no brackets say otherwise. */
const ATOM = /^[0-9A-Za-z.]+/;

/** Index of the `)` closing the `(` at `open`, or the end if it never closes. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return s.length;
}

/**
 * Calculator-style text to LaTeX.
 *
 * `^2` and `^(n+1)` are powers, `√81`, `√(x+1)` and `sqrt(x+1)` are roots,
 * `÷`, `×` and `*` are the signs. Anything else is printed as typed.
 */
export function toLatex(input: string): string {
  const s = input
    .trim()
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) =>
      "^(" + [...run].map((c) => SUPERSCRIPT_DIGITS[c]).join("") + ")",
    );

  let out = "";
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);

    const root = /^(?:√|sqrt)\(/.exec(rest);
    if (root) {
      const open = i + root[0].length - 1;
      const close = closing(s, open);
      out += "\\sqrt{" + toLatex(s.slice(open + 1, close)) + "}";
      i = close + 1;
      continue;
    }
    if (s[i] === "√") {
      const atom = ATOM.exec(s.slice(i + 1));
      out += atom ? "\\sqrt{" + atom[0] + "}" : "\\surd{}";
      i += 1 + (atom ? atom[0].length : 0);
      continue;
    }
    if (s[i] === "^") {
      if (s[i + 1] === "(") {
        const close = closing(s, i + 1);
        out += "^{" + toLatex(s.slice(i + 2, close)) + "}";
        i = close + 1;
        continue;
      }
      const atom = ATOM.exec(s.slice(i + 1));
      out += atom ? "^{" + atom[0] + "}" : "\\^{}";
      i += 1 + (atom ? atom[0].length : 0);
      continue;
    }
    if (s[i] === "÷") { out += "\\div "; i++; continue; }
    if (s[i] === "×" || s[i] === "*") { out += "\\times "; i++; continue; }

    out += ESCAPES[s[i]] ?? s[i];
    i++;
  }
  return out.trim();
}

/**
 * The LaTeX for a stacked fraction, optionally inside brackets.
 *
 * The brackets are `\left( … \right)` rather than typed ones either side, so
 * they grow to the fraction's full height instead of reaching its middle.
 */
export function fractionLatex(top: string, bottom: string, brackets = false): string {
  // \dfrac, not \frac: inside a line of text \frac shrinks both halves to
  // superscript size, which is unreadable for 3×3×3×3 over anything.
  const frac = "\\dfrac{" + toLatex(top) + "}{" + toLatex(bottom) + "}";
  return brackets ? "\\left(" + frac + "\\right)" : frac;
}

/**
 * A fraction as one line of text: `72/5^2`, `(3+4)/7`.
 *
 * Brackets go round a side only when it holds more than one term, so the
 * common case reads the way it would be typed.
 */
export function fractionText(top: string, bottom: string, brackets = false): string {
  const side = (s: string) => {
    const t = s.trim();
    return /[\s+\-×÷*/]/.test(t) ? "(" + t + ")" : t;
  };
  const text = side(top) + "/" + side(bottom);
  return brackets ? "(" + text + ")" : text;
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? decodeEntities(m[1]) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The LaTeX stored on a fraction's span, from that span's attributes. */
export function mathLatex(attrs: string): string {
  return attr(attrs, "data-latex") ?? "";
}

/**
 * Card HTML with each fraction spelled out as text.
 *
 * For the places that strip tags: without this a fraction is an empty span and
 * vanishes from search results and summaries, and the AI step would be handed
 * a maths question with its numbers missing.
 */
export function mathToText(html: string): string {
  return html.replace(MATH_SPAN, (_span, attrs: string) => {
    const top = attr(attrs, "data-top");
    const bottom = attr(attrs, "data-bottom");
    const text = top !== null && bottom !== null
      ? fractionText(top, bottom, attr(attrs, "data-brackets") === "true")
      : mathLatex(attrs);
    return " " + escapeHtml(text) + " ";
  });
}
