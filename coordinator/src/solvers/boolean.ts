import { NumericComparator } from "../cmp/numeric.js";
import { parseExpression } from "../parser.js";
import { metrics, type Verdict } from "./contract.js";

/**
 * The deterministic SYMBOLIC boolean evaluator — the leaf of the boolean path.
 *
 * It evaluates a single numeric comparison ("12 > 14") or a HOMOGENEOUS and/or
 * chain ("5 > 3 and 2 < 1"). It deliberately refuses anything it cannot decide
 * deterministically — mixed and/or (ambiguous precedence) and free natural
 * language ("is the larger of 3 and 8 over 5?") return null, which is the signal
 * to hand the request up to the agentic coordinator instead. Numbers only: this
 * is the deterministic core, not the model.
 */

export interface BoolAtom {
  /** The atom as written. */
  expr: string;
  /** Canonical comparator name (gt/lt/gte/lte/eq/neq) — matches the Go tool. */
  operator: string;
  lhs: number;
  rhs: number;
  result: boolean;
}

export interface BooleanResult {
  value: boolean;
  op: "single" | "and" | "or";
  atoms: BoolAtom[];
}

const cmp = new NumericComparator();

/** Evaluate a single `<num> <op> <num>` atom, or null if it isn't one. */
function evalAtom(text: string): BoolAtom | null {
  const p = parseExpression(text);
  if (!p) return null;
  const o = cmp.compare(String(p.lhs), String(p.rhs)); // -1 | 0 | 1
  const result =
    p.operator === "gt"
      ? o > 0
      : p.operator === "lt"
        ? o < 0
        : p.operator === "gte"
          ? o >= 0
          : p.operator === "lte"
            ? o <= 0
            : p.operator === "eq"
              ? o === 0
              : /* neq */ o !== 0;
  return { expr: text.trim(), operator: p.operator, lhs: p.lhs, rhs: p.rhs, result };
}

/** Strip a leading "is/are/does/do" and a trailing "?" so phrasings parse. */
function normalize(input: string): string {
  return input
    .trim()
    .replace(/\?+\s*$/, "")
    .replace(/^(is|are|does|do)\b\s*/i, "")
    .trim();
}

/**
 * Deterministically evaluate a symbolic boolean expression, or return null if it
 * is not one (free NL, or mixed-precedence and/or — both belong to the agentic
 * layer).
 */
export function evaluateBoolean(input: string): BooleanResult | null {
  const text = normalize(input);

  const single = evalAtom(text);
  if (single) return { value: single.result, op: "single", atoms: [single] };

  const lower = text.toLowerCase();
  const hasAnd = /\band\b/.test(lower);
  const hasOr = /\bor\b/.test(lower);
  if (hasAnd === hasOr) return null; // neither, or both (ambiguous) -> not deterministic
  const op: "and" | "or" = hasAnd ? "and" : "or";

  const atoms: BoolAtom[] = [];
  for (const part of text.split(new RegExp(`\\b${op}\\b`, "i"))) {
    const a = evalAtom(part);
    if (!a) return null; // a non-atomic part -> can't decide deterministically
    atoms.push(a);
  }
  const value = op === "and" ? atoms.every((a) => a.result) : atoms.some((a) => a.result);
  return { value, op, atoms };
}

/** Adapt a boolean result into the uniform verdict. */
export function fromBoolean(r: BooleanResult): Verdict {
  const joined = r.atoms.map((a) => `${a.lhs} ${a.operator} ${a.rhs}=${a.result}`).join(` ${r.op} `);
  return {
    kind: "boolean",
    valid: r.value,
    witness: r.atoms,
    metrics: metrics({ atoms: r.atoms.length }),
    reason: `${joined} -> ${r.value}`,
  };
}
