/**
 * Cards whose numbers change every time they are seen.
 *
 * A card like "it takes 9 men 12 days, how long would 4 men take?" is answered
 * from memory the second time it comes round, which teaches the answer rather
 * than the method. A generated card stores the shape of the question instead of
 * one instance of it: the sentence with its numbers pulled out, a formula for
 * the answer, and formulas for the plausible wrong answers. Every appearance
 * rolls fresh values.
 *
 * The formulas are evaluated by the small parser below rather than by `eval` or
 * `new Function`. The templates are written by a language model and stored in a
 * synced file, so they are data from elsewhere; handing that to the JavaScript
 * engine would make a wrong answer the least of the problems.
 */

export type GeneratedVariable = {
  name: string;
  min: number;
  max: number;
  /** Values are min, min+step, min+2·step… Defaults to 1. */
  step?: number;
};

export type GeneratedPayload = {
  /**
   * The card as it was originally written, as values and an answer.
   *
   * This is what makes a template checkable without a person reading it: put
   * the original numbers into the new formula and it must produce the original
   * answer. A formula that is subtly inverted — m*n/d where m*d/n was meant —
   * survives every other check and fails this one immediately.
   */
  check?: { values: Record<string, number>; answer: number };
  /** The question, with `{name}` where each value goes. */
  template: string;
  variables: GeneratedVariable[];
  /** Must hold for a roll to be usable, e.g. `(m*d) % n == 0`. */
  constraint?: string;
  /** Expression for the right answer. */
  answer: string;
  /** Expressions for the wrong options — each should be a real mistake. */
  distractors: string[];
  /** Optional worked explanation, with the same `{name}` placeholders. */
  explanation?: string;
  /** Appended to every option, e.g. "days". */
  unit?: string;
};

/* ── expressions ──────────────────────────────────────────────────────────
 * Recursive descent over a tiny grammar: the arithmetic a school maths
 * question needs, comparisons so a constraint can be written, and a handful of
 * named functions. Anything else is a parse error, which is the point.
 */

type Token = {
  kind: "num" | "name" | "op" | "(" | ")" | "," | "?" | ":";
  text: string;
};

const OPERATORS = [
  "**", "==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "<", ">",
];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      tokens.push({ kind: "num", text: input.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      tokens.push({ kind: "name", text: input.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "," || ch === "?" || ch === ":") {
      tokens.push({ kind: ch, text: ch });
      i++;
      continue;
    }
    const op = OPERATORS.find((o) => input.startsWith(o, i));
    if (!op) throw new Error(`Unexpected character "${ch}"`);
    tokens.push({ kind: "op", text: op });
    i += op.length;
  }
  return tokens;
}

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  sqrt: Math.sqrt,
  min: Math.min,
  max: Math.max,
  gcd: (a, b) => {
    let x = Math.abs(Math.round(a));
    let y = Math.abs(Math.round(b));
    while (y) [x, y] = [y, x % y];
    return x;
  },
};

/** Loosest binds first; `**` is right-associative and handled in `unary`. */
const PRECEDENCE: Record<string, number> = {
  "||": 1, "&&": 2,
  "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3,
  "+": 4, "-": 4,
  "*": 5, "/": 5, "%": 5,
};

export function evaluate(
  expression: string,
  scope: Record<string, number>,
): number {
  const tokens = tokenize(expression);
  let pos = 0;

  const peek = () => tokens[pos];
  const eat = (text?: string) => {
    const token = tokens[pos];
    if (!token) throw new Error("Unexpected end of expression");
    if (text && token.text !== text) {
      throw new Error(`Expected "${text}" but found "${token.text}"`);
    }
    pos++;
    return token;
  };

  function primary(): number {
    const token = eat();
    if (token.kind === "num") return Number(token.text);
    if (token.kind === "(") {
      const value = ternary();
      eat(")");
      return value;
    }
    if (token.kind === "name") {
      if (peek()?.kind === "(") {
        eat("(");
        const args: number[] = [];
        if (peek()?.kind !== ")") {
          args.push(ternary());
          while (peek()?.kind === ",") { eat(","); args.push(ternary()); }
        }
        eat(")");
        const fn = FUNCTIONS[token.text];
        if (!fn) throw new Error(`Unknown function "${token.text}"`);
        return fn(...args);
      }
      if (!(token.text in scope)) {
        throw new Error(`Unknown variable "${token.text}"`);
      }
      return scope[token.text];
    }
    throw new Error(`Unexpected "${token.text}"`);
  }

  function unary(): number {
    const token = peek();
    if (token?.kind === "op" && (token.text === "-" || token.text === "+")) {
      eat();
      return token.text === "-" ? -unary() : unary();
    }
    const base = primary();
    if (peek()?.text === "**") { eat("**"); return base ** unary(); }
    return base;
  }

  function binary(minPrecedence: number): number {
    let left = unary();
    for (;;) {
      const token = peek();
      if (!token || token.kind !== "op") break;
      const precedence = PRECEDENCE[token.text];
      if (precedence === undefined || precedence < minPrecedence) break;
      eat();
      const right = binary(precedence + 1);
      switch (token.text) {
        case "+": left = left + right; break;
        case "-": left = left - right; break;
        case "*": left = left * right; break;
        case "/": left = left / right; break;
        case "%": left = left % right; break;
        case "==": left = left === right ? 1 : 0; break;
        case "!=": left = left !== right ? 1 : 0; break;
        case "<": left = left < right ? 1 : 0; break;
        case "<=": left = left <= right ? 1 : 0; break;
        case ">": left = left > right ? 1 : 0; break;
        case ">=": left = left >= right ? 1 : 0; break;
        case "&&": left = left && right ? 1 : 0; break;
        case "||": left = left || right ? 1 : 0; break;
        default: throw new Error(`Unknown operator "${token.text}"`);
      }
    }
    return left;
  }

  /**
   * `condition ? then : otherwise`, loosest of all and right-associative.
   *
   * Worth supporting because it is how a rule gets written when the arithmetic
   * changes case — "if it divides evenly, this, otherwise that" — and rejecting
   * it turned a sound template into a parse error about a colon.
   */
  function ternary(): number {
    const condition = binary(0);
    if (peek()?.kind !== "?") return condition;
    eat("?");
    const whenTrue = ternary();
    eat(":");
    const whenFalse = ternary();
    return condition !== 0 ? whenTrue : whenFalse;
  }

  const result = ternary();
  if (pos !== tokens.length) throw new Error(`Trailing "${peek()?.text}"`);
  if (!Number.isFinite(result)) throw new Error("Result is not a number");
  return result;
}

/* ── rolling a question ─────────────────────────────────────────────────── */

export type GeneratedInstance = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
  values: Record<string, number>;
};

function fill(template: string, values: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? format(values[name]) : whole,
  );
}

/** Two decimal places at most, and no trailing zeros: 27, 4.5, 0.33. */
function format(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function sample(variable: GeneratedVariable, random: () => number): number {
  const step = variable.step && variable.step > 0 ? variable.step : 1;
  const steps = Math.floor((variable.max - variable.min) / step);
  return variable.min + Math.round(random() * Math.max(0, steps)) * step;
}

/**
 * Roll one instance of the card.
 *
 * Rolls are retried rather than repaired: a constraint that fails, an answer
 * that lands on a fraction, options that collide — all mean this particular
 * draw was no good, and another draw costs nothing. After enough failures the
 * template itself is wrong, and saying so beats showing a broken question.
 *
 * The attempt budget is deliberately large. A tight constraint — "the volume
 * must divide by 1000" is satisfied by about one draw in forty — will fail a
 * few hundred attempts by luck alone, which showed up as a template that
 * previewed three times and then refused to save. Each attempt is a handful of
 * arithmetic, so the budget costs nothing and removes the flakiness.
 */
/** Why a template could not produce a question — enough to act on. */
export type RollDiagnosis = {
  attempts: number;
  constraintFailed: number;
  answerNotWhole: number;
  tooFewOptions: number;
  errored: number;
  lastError: string;
};

export class RollFailure extends Error {
  readonly diagnosis: RollDiagnosis;
  constructor(message: string, diagnosis: RollDiagnosis) {
    super(message);
    this.name = "RollFailure";
    this.diagnosis = diagnosis;
  }
}

/** The failure told as a sentence, for the person and for the next prompt. */
export function describeFailure(d: RollDiagnosis): string {
  if (d.errored > d.attempts / 2) {
    return `the formulas could not be worked out (${d.lastError})`;
  }
  if (d.constraintFailed > d.attempts / 2) {
    return "the constraint was never satisfied — no combination of the allowed values fits it";
  }
  if (d.answerNotWhole > d.attempts / 4) {
    return "the answer kept landing on a fraction rather than a whole number";
  }
  if (d.tooFewOptions > d.attempts / 4) {
    return "the wrong options kept colliding with the answer or with each other";
  }
  return "no usable question came out of it";
}

export function rollGenerated(
  payload: GeneratedPayload,
  random: () => number = Math.random,
  attempts = 4000,
): GeneratedInstance {
  let lastError = "";
  let failing = "a formula";
  const diagnosis: RollDiagnosis = {
    attempts,
    constraintFailed: 0,
    answerNotWhole: 0,
    tooFewOptions: 0,
    errored: 0,
    lastError: "",
  };
  for (let attempt = 0; attempt < attempts; attempt++) {
    const values: Record<string, number> = {};
    for (const variable of payload.variables) {
      values[variable.name] = sample(variable, random);
    }
    try {
      failing = "the constraint";
      if (payload.constraint && evaluate(payload.constraint, values) === 0) {
        diagnosis.constraintFailed++;
        continue;
      }
      failing = "the answer";
      const answer = evaluate(payload.answer, values);
      // A question whose answer is 27.333… is arithmetic gone wrong, not a
      // harder question.
      if (!Number.isInteger(answer)) {
        diagnosis.answerNotWhole++;
        continue;
      }

      const wrong: number[] = [];
      for (const expression of payload.distractors) {
        failing = `a wrong option ("${expression}")`;
        const value = evaluate(expression, values);
        if (!Number.isFinite(value)) continue;
        const rounded = Math.round(value * 100) / 100;
        // A distractor equal to the answer gives the game away; a repeat looks
        // like a typo; and a lone fraction among whole numbers is a tell, since
        // nobody's wrong working lands on 13.33 when the rest are integers.
        if (rounded === answer || wrong.includes(rounded)) continue;
        if (Number.isInteger(answer) && !Number.isInteger(rounded)) continue;
        if (rounded < 0) continue;
        wrong.push(rounded);
        // Five options is what these papers use, and more only pads the list.
        if (wrong.length === 4) break;
      }
      if (wrong.length < 2) {
        diagnosis.tooFewOptions++;
        continue;
      }

      const unit = payload.unit ? ` ${payload.unit}` : "";
      const all = [answer, ...wrong].map((value) => `${format(value)}${unit}`);
      // Shuffled with the same source of randomness, so a seeded roll is
      // reproducible end to end.
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
      }
      return {
        question: fill(payload.template, values),
        options: all,
        correctIndex: all.indexOf(`${format(answer)}${unit}`),
        explanation: payload.explanation
          ? fill(payload.explanation, values)
          : null,
        values,
      };
    } catch (error) {
      diagnosis.errored++;
      lastError = `${failing}: ${error instanceof Error ? error.message : String(error)}`;
      diagnosis.lastError = lastError;
    }
  }
  throw new RollFailure(
    `This template didn't work: ${describeFailure(diagnosis)}.`,
    diagnosis,
  );
}

/**
 * Does the template, given the original card's numbers, produce the original
 * card's answer?
 *
 * Returns null when there is nothing to check against — an unverifiable
 * template is not a wrong one, it just has to be read by a person instead.
 */
export function checkAgainstOriginal(
  payload: GeneratedPayload,
): { ok: boolean; got: number; want: number } | null {
  if (!payload.check) return null;
  const { values, answer } = payload.check;
  for (const variable of payload.variables) {
    if (!(variable.name in values)) return null;
  }
  try {
    const got = evaluate(payload.answer, values);
    return { ok: Math.abs(got - answer) < 1e-9, got, want: answer };
  } catch {
    return { ok: false, got: NaN, want: answer };
  }
}

/** Checked before a template is stored, so a broken one is never saved. */
export function validateGenerated(payload: GeneratedPayload): string | null {
  if (!payload.template.trim()) return "The question is empty.";
  if (payload.variables.length === 0) return "There are no variables to vary.";
  for (const variable of payload.variables) {
    if (!/^\w+$/.test(variable.name)) return `"${variable.name}" is not a usable name.`;
    if (!(variable.max >= variable.min)) return `${variable.name} has an empty range.`;
    if (!payload.template.includes(`{${variable.name}}`)) {
      return `{${variable.name}} never appears in the question.`;
    }
  }
  if (payload.distractors.length < 2) return "At least two wrong options are needed.";
  try {
    rollGenerated(payload);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}

/** The same check, keeping the diagnosis so a retry can be told what went wrong. */
export function diagnoseGenerated(payload: GeneratedPayload): RollDiagnosis | null {
  try {
    rollGenerated(payload);
    return null;
  } catch (error) {
    return error instanceof RollFailure ? error.diagnosis : null;
  }
}
