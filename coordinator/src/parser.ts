/**
 * Operator catalog and a small parser for single-pair expressions of the form
 * `<lhs> <operator> <rhs>` (e.g. "12 GT 14" or "12 > 14").
 *
 * The canonical name of each operator matches the Go MCP tool name exactly.
 */

export interface Operator {
  /** Canonical name — identical to the Go MCP tool name (e.g. "gt"). */
  canonical: string;
  /** Human label used in prompts and help text. */
  label: string;
  /** The enum keyword from the spec (e.g. "GT"). */
  keyword: string;
  /** Accepted surface forms, lowercased, used by the parser. */
  forms: string[];
}

export const OPERATORS: Operator[] = [
  { canonical: "gt", label: "greater-than", keyword: "GT", forms: [">", "gt"] },
  { canonical: "lt", label: "less-than", keyword: "LT", forms: ["<", "lt"] },
  { canonical: "gte", label: "greater-than-or-equal", keyword: "GTE", forms: [">=", "gte"] },
  { canonical: "lte", label: "less-than-or-equal", keyword: "LTE", forms: ["<=", "lte"] },
  { canonical: "eq", label: "equal", keyword: "EQ", forms: ["==", "=", "eq"] },
  { canonical: "neq", label: "not-equal", keyword: "NEQ", forms: ["!=", "<>", "neq"] },
];

const FORM_TO_CANONICAL = new Map<string, string>();
for (const op of OPERATORS) {
  for (const form of op.forms) FORM_TO_CANONICAL.set(form, op.canonical);
}

export interface ParsedExpression {
  lhs: number;
  rhs: number;
  /** Canonical operator / Go tool name. */
  operator: string;
}

// number  operator  number — operators ordered so multi-char forms win.
const EXPRESSION_RE =
  /^\s*(-?\d+(?:\.\d+)?)\s*(>=|<=|==|!=|<>|>|<|=|gte|gt|lte|lt|eq|neq)\s*(-?\d+(?:\.\d+)?)\s*$/i;

/**
 * Parse a single comparison expression. Returns null if it does not match the
 * `<lhs> <operator> <rhs>` grammar (the coordinator is then free to interpret
 * the raw text itself — useful once larger symbolic statements are supported).
 */
export function parseExpression(input: string): ParsedExpression | null {
  const match = EXPRESSION_RE.exec(input);
  if (!match) return null;

  const [, lhsRaw, opRaw, rhsRaw] = match;
  const operator = FORM_TO_CANONICAL.get(opRaw.toLowerCase());
  if (!operator) return null;

  return { lhs: Number(lhsRaw), rhs: Number(rhsRaw), operator };
}

/** Look up an operator by its canonical name. */
export function operatorByCanonical(canonical: string): Operator | undefined {
  return OPERATORS.find((o) => o.canonical === canonical);
}
