/**
 * A NARROW, provably-sound nonlinear slice — the first step of "beyond linear".
 *
 * It parses a single polynomial equation in `^` power notation and decides
 * solvability ONLY for forms it can prove, reporting a DOMAIN-AWARE verdict
 * (reals ℝ and complex ℂ) and explicitly DEFERRING ("unknown") anything outside
 * the decidable slice — never confidently wrong.
 *
 * Decidable:
 *   ℂ  — a non-constant polynomial always has a complex zero (fundamental theorem
 *        of algebra), so over ℂ it is solvable iff the polynomial is non-constant
 *        (a nonzero constant is unsolvable; the zero polynomial is trivially so).
 *   ℝ  — sum of single-variable EVEN powers with uniform-sign coefficients + a
 *        constant (a "sum of squares" form): a positive-coefficient sum is ≥ 0, so
 *        `… + c = 0` is real-solvable iff c ≤ 0 (mirror for all-negative);
 *      — a single-variable polynomial: linear and odd-degree are always real-
 *        solvable, a quadratic by its discriminant.
 *   Everything else over ℝ (mixed-sign cross terms, multivariate non-uniform,
 *   even degree > 2 that isn't a pure power) is DEFERRED.
 *
 * No parentheses in v1: an input with '(' is deferred rather than mis-parsed.
 */

export type Decidable = "solvable" | "unsolvable" | "unknown";

export type NonlinearResult = {
  ok: boolean;
  reals: Decidable;
  complex: Decidable;
  /** A sample solution when one is cheaply constructible, else null. */
  witness: string | null;
  reason: string;
};

interface Monomial {
  coef: number;
  powers: Map<string, number>; // variable -> exponent
}

type Token = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      tokens.push({ t: "num", v: Number(s.slice(i, j)) });
      i = j;
    } else if (/[a-zA-Z_]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      tokens.push({ t: "id", v: s.slice(i, j) });
      i = j;
    } else if ("+-*^=".includes(ch)) {
      tokens.push({ t: "op", v: ch });
      i++;
    } else {
      throw new Error(`unexpected character '${ch}'`);
    }
  }
  return tokens;
}

/** Parse one term (a product of numeric/variable factors). */
function parseTerm(tokens: Token[], start: number): { mono: Monomial; next: number } {
  let coef = 1;
  const powers = new Map<string, number>();
  let i = start;
  let read = false;
  for (; i < tokens.length; ) {
    const tok = tokens[i];
    if (tok.t === "num") {
      coef *= tok.v;
      i++;
      read = true;
    } else if (tok.t === "id") {
      i++;
      let exp = 1;
      if (tokens[i]?.t === "op" && (tokens[i] as { v: string }).v === "^") {
        i++;
        const e = tokens[i];
        if (!e || e.t !== "num" || !Number.isInteger(e.v) || e.v < 0) throw new Error("exponent must be a non-negative integer");
        exp = e.v;
        i++;
      }
      powers.set(tok.v, (powers.get(tok.v) ?? 0) + exp);
      read = true;
    } else if (tok.t === "op" && tok.v === "*") {
      i++; // explicit factor separator
    } else {
      break; // +, -, =, or end
    }
  }
  if (!read) throw new Error("empty term");
  return { mono: { coef, powers }, next: i };
}

/** Parse a side of the equation into a list of monomials. */
function parseSide(tokens: Token[]): Monomial[] {
  const monos: Monomial[] = [];
  let i = 0;
  let sign = 1;
  if (tokens[i]?.t === "op" && ((tokens[i] as { v: string }).v === "+" || (tokens[i] as { v: string }).v === "-")) {
    sign = (tokens[i] as { v: string }).v === "-" ? -1 : 1;
    i++;
  }
  for (;;) {
    const { mono, next } = parseTerm(tokens, i);
    mono.coef *= sign;
    monos.push(mono);
    i = next;
    if (i >= tokens.length) break;
    const op = tokens[i];
    if (op.t === "op" && (op.v === "+" || op.v === "-")) {
      sign = op.v === "-" ? -1 : 1;
      i++;
      continue;
    }
    throw new Error(`unexpected token '${op.t === "op" ? op.v : op.v}'`);
  }
  return monos;
}

const powersKey = (p: Map<string, number>): string =>
  [...p.entries()].filter(([, e]) => e !== 0).sort(([a], [b]) => (a < b ? -1 : 1)).map(([v, e]) => `${v}^${e}`).join("*");

/** Combine like terms; drop (near-)zero coefficients. */
function combine(monos: Monomial[]): Monomial[] {
  const byKey = new Map<string, Monomial>();
  for (const m of monos) {
    const key = powersKey(m.powers);
    const ex = byKey.get(key);
    if (ex) ex.coef += m.coef;
    else byKey.set(key, { coef: m.coef, powers: new Map([...m.powers].filter(([, e]) => e !== 0)) });
  }
  return [...byKey.values()].filter((m) => Math.abs(m.coef) > 1e-9);
}

/** Parse `lhs = rhs` into the polynomial P = lhs - rhs (so the equation is P = 0). */
function parseEquation(eq: string): Monomial[] {
  if (eq.includes("(") || eq.includes(")")) throw new Error("parentheses are not supported in the nonlinear slice");
  const sides = eq.split("=");
  if (sides.length !== 2) throw new Error("expected a single '=' in the equation");
  const lhs = parseSide(tokenize(sides[0]));
  const rhs = parseSide(tokenize(sides[1])).map((m) => ({ coef: -m.coef, powers: m.powers }));
  return combine([...lhs, ...rhs]);
}

const isConstant = (m: Monomial): boolean => m.powers.size === 0;
const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(3));

export function analyzeNonlinear(equation: string): NonlinearResult {
  let poly: Monomial[];
  try {
    poly = parseEquation(equation);
  } catch (e) {
    return { ok: false, reals: "unknown", complex: "unknown", witness: null, reason: `could not parse: ${e instanceof Error ? e.message : String(e)}` };
  }

  const constant = poly.filter(isConstant).reduce((s, m) => s + m.coef, 0);
  const varTerms = poly.filter((m) => !isConstant(m));
  const vars = new Set<string>();
  for (const m of varTerms) for (const v of m.powers.keys()) vars.add(v);

  // Constant equation: solvable iff it reduces to 0 = 0.
  if (varTerms.length === 0) {
    const solv: Decidable = Math.abs(constant) < 1e-9 ? "solvable" : "unsolvable";
    return { ok: true, reals: solv, complex: solv, witness: solv === "solvable" ? "any values" : null, reason: solv === "solvable" ? "identity (0 = 0)" : `reduces to ${fmt(constant)} = 0, impossible` };
  }

  // Over ℂ: a non-constant polynomial always has a zero (fundamental theorem of algebra).
  const complex: Decidable = "solvable";

  // ℝ — form 1: sum of single-variable EVEN powers with uniform-sign coefficients.
  const pureEven = varTerms.every((m) => m.powers.size === 1 && [...m.powers.values()][0] % 2 === 0);
  let reals: Decidable = "unknown";
  let witness: string | null = null;
  if (pureEven) {
    const allPos = varTerms.every((m) => m.coef > 0);
    const allNeg = varTerms.every((m) => m.coef < 0);
    if (allPos || allNeg) {
      // Σ a·xᵢ^even has range [0,∞) (allPos) or (-∞,0]; solve Σ = -constant.
      reals = allPos ? (constant <= 1e-9 ? "solvable" : "unsolvable") : constant >= -1e-9 ? "solvable" : "unsolvable";
      witness = realWitness(varTerms, constant, reals);
    }
  }

  // ℝ — form 2: a single-variable polynomial (linear / odd-degree / quadratic).
  if (reals === "unknown" && vars.size === 1) {
    const v = [...vars][0];
    const degree = Math.max(...varTerms.map((m) => m.powers.get(v) ?? 0));
    if (degree % 2 === 1 || degree === 1) {
      reals = "solvable"; // odd-degree univariate always has a real root
    } else if (degree === 2) {
      const a = coefOf(poly, v, 2);
      const b = coefOf(poly, v, 1);
      const disc = b * b - 4 * a * constant;
      reals = disc >= -1e-9 ? "solvable" : "unsolvable";
      if (reals === "solvable") {
        const r = (-b + Math.sqrt(Math.max(0, disc))) / (2 * a);
        witness = `${v} = ${fmt(r)}`;
      }
    }
  }

  // Complex witness for the common all-square form when ℝ has no solution.
  if (witness === null && complex === "solvable" && reals === "unsolvable" && pureEven && varTerms.every((m) => [...m.powers.values()][0] === 2)) {
    const first = varTerms[0];
    const v = [...first.powers.keys()][0];
    const val = -constant / first.coef; // need v² = val; val < 0 here
    witness = `${v} = ${fmt(Math.sqrt(-val))}i` + (varTerms.length > 1 ? " (others 0)" : "");
  }

  const reason = explain(reals, complex, witness);
  return { ok: true, reals, complex, witness, reason };
}

function coefOf(poly: Monomial[], v: string, deg: number): number {
  return poly.filter((m) => (m.powers.get(v) ?? 0) === deg && [...m.powers.keys()].every((k) => k === v)).reduce((s, m) => s + m.coef, 0);
}

function realWitness(varTerms: Monomial[], constant: number, reals: Decidable): string | null {
  if (reals !== "solvable") return null;
  // Put all the "weight" on the first variable, others zero — only clean for exponent 2.
  const first = varTerms[0];
  const [v, e] = [...first.powers.entries()][0];
  if (e !== 2) return null;
  const val = -constant / first.coef; // need v² = val ≥ 0 here
  if (val < 0) return null;
  return `${v} = ${fmt(Math.sqrt(val))}` + (varTerms.length > 1 ? " (others 0)" : "");
}

function explain(reals: Decidable, complex: Decidable, witness: string | null): string {
  const r =
    reals === "solvable"
      ? `solvable over ℝ${witness ? ` (e.g. ${witness})` : ""}`
      : reals === "unsolvable"
        ? "no real solution"
        : "real solvability undetermined (outside the provable slice)";
  const c =
    complex === "solvable"
      ? reals === "unsolvable" && witness
        ? `solvable over ℂ (e.g. ${witness})`
        : "solvable over ℂ"
      : complex === "unsolvable"
        ? "no complex solution"
        : "complex solvability undetermined";
  return `${r}; ${c}`;
}
