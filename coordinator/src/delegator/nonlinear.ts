/**
 * A NARROW, provably-sound nonlinear slice — the first step of "beyond linear".
 *
 * It parses a single (rational) polynomial equation in `^` power notation and `/`
 * division, and decides solvability with a DOMAIN-AWARE verdict (reals ℝ and
 * complex ℂ), explicitly DEFERRING ("unknown") only what it cannot prove — never
 * confidently wrong.
 *
 * Decidable:
 *   ℂ  — a non-constant polynomial always has a complex zero (fundamental theorem
 *        of algebra), so over ℂ it is solvable iff the polynomial is non-constant
 *        (a nonzero constant is unsolvable; the zero polynomial is trivially so).
 *   ℝ  — sum of single-variable EVEN powers with uniform-sign coefficients + a
 *        constant (a "sum of squares" form): a positive-coefficient sum is ≥ 0, so
 *        `… + c = 0` is real-solvable iff c ≤ 0 (mirror for all-negative);
 *      — a single-variable polynomial: linear and odd-degree are always real-
 *        solvable, a quadratic by its discriminant;
 *      — ANYTHING else: a bounded, witness-VERIFIED existence search (fix the other
 *        variables, solve the remaining univariate slice, then check the candidate
 *        against the original equation). It only ever upgrades unknown → solvable,
 *        and only with a concrete witness, so it stays sound. Genuinely hard forms
 *        that yield no witness remain DEFERRED.
 *
 * Division (`/`) is supported by treating a divisor as a negative exponent, then
 * CLEARING DENOMINATORS (multiplying through by the offending variables) into a
 * true polynomial — recording the domain restriction (each denominator ≠ 0) so the
 * verdict and any witness respect it.
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
  /** Variables that must be ≠ 0 for the equation to be defined (from `/`). */
  domain: string[];
  reason: string;
};

interface Monomial {
  coef: number;
  powers: Map<string, number>; // variable -> exponent (may be negative pre-clearing)
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
    } else if ("+-*/^=".includes(ch)) {
      tokens.push({ t: "op", v: ch });
      i++;
    } else {
      throw new Error(`unexpected character '${ch}'`);
    }
  }
  return tokens;
}

/** Parse one term: a chain of factors joined by `*` / `/` (division flips the
 *  factor to a reciprocal — numeric divide, or a negated exponent for a variable). */
function parseTerm(tokens: Token[], start: number): { mono: Monomial; next: number } {
  let coef = 1;
  const powers = new Map<string, number>();
  let i = start;
  let read = false;
  let div = false; // is the next factor a divisor?
  for (; i < tokens.length; ) {
    const tok = tokens[i];
    if (tok.t === "num") {
      if (div && tok.v === 0) throw new Error("division by zero");
      coef = div ? coef / tok.v : coef * tok.v;
      i++;
      read = true;
      div = false;
    } else if (tok.t === "id") {
      i++;
      let exp = 1;
      if (tokens[i]?.t === "op" && (tokens[i] as { v: string }).v === "^") {
        i++;
        let neg = false;
        if (tokens[i]?.t === "op" && (tokens[i] as { v: string }).v === "-") {
          neg = true;
          i++;
        }
        const e = tokens[i];
        if (!e || e.t !== "num" || !Number.isInteger(e.v) || e.v < 0) throw new Error("exponent must be an integer");
        exp = neg ? -e.v : e.v;
        i++;
      }
      const signed = div ? -exp : exp;
      powers.set(tok.v, (powers.get(tok.v) ?? 0) + signed);
      read = true;
      div = false;
    } else if (tok.t === "op" && (tok.v === "*" || tok.v === "/")) {
      div = tok.v === "/";
      i++;
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

/** Parse `lhs = rhs` into the (possibly Laurent) polynomial P = lhs - rhs. */
function parseEquation(eq: string): Monomial[] {
  if (eq.includes("(") || eq.includes(")")) throw new Error("parentheses are not supported in the nonlinear slice");
  const sides = eq.split("=");
  if (sides.length !== 2) throw new Error("expected a single '=' in the equation");
  const lhs = parseSide(tokenize(sides[0]));
  const rhs = parseSide(tokenize(sides[1])).map((m) => ({ coef: -m.coef, powers: m.powers }));
  return combine([...lhs, ...rhs]);
}

/** Clear denominators: if any variable appears with a negative exponent, multiply
 *  the whole polynomial through by that variable to its lowest (negative) power, so
 *  every exponent becomes ≥ 0. Returns the cleared polynomial and the variables
 *  that were in a denominator (each must be ≠ 0 for the original to be defined). */
function clearDenominators(monos: Monomial[]): { poly: Monomial[]; denominators: string[] } {
  const minExp = new Map<string, number>();
  for (const m of monos) for (const [v, e] of m.powers) minExp.set(v, Math.min(minExp.get(v) ?? 0, e));
  const denominators = [...minExp].filter(([, e]) => e < 0).map(([v]) => v).sort();
  if (denominators.length === 0) return { poly: monos, denominators: [] };
  const shifted = monos.map((m) => {
    const p = new Map(m.powers);
    for (const v of denominators) p.set(v, (p.get(v) ?? 0) - minExp.get(v)!);
    return { coef: m.coef, powers: new Map([...p].filter(([, e]) => e !== 0)) };
  });
  return { poly: combine(shifted), denominators };
}

const isConstant = (m: Monomial): boolean => m.powers.size === 0;
const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(3));
const fmtAssign = (vals: Record<string, number>): string =>
  Object.keys(vals).sort().map((v) => `${v} = ${fmt(vals[v])}`).join(", ");

/** Evaluate a (Laurent) polynomial at a point; NaN if a denominator variable is 0. */
function evalLaurent(monos: Monomial[], vals: Record<string, number>): number {
  let sum = 0;
  for (const m of monos) {
    let term = m.coef;
    for (const [v, e] of m.powers) {
      const x = vals[v];
      if (e < 0 && x === 0) return NaN;
      term *= Math.pow(x, e);
    }
    sum += term;
  }
  return sum;
}

/** A real root of a univariate polynomial (coeffs[i] is the degree-i coefficient),
 *  or null when none is provably/numerically found. Exact for degree ≤ 2; numeric
 *  (Cauchy-bounded sampling + bisection) above. */
function realRootOfPoly(coeffs: number[]): number | null {
  let d = -1;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    if (Math.abs(coeffs[i] ?? 0) > 1e-12) {
      d = i;
      break;
    }
  }
  if (d < 0) return 1; // identically zero → any value works (caller still verifies + domain)
  if (d === 0) return null; // nonzero constant → no root
  if (d === 1) return -(coeffs[0] ?? 0) / coeffs[1];
  if (d === 2) {
    const [c0, c1, c2] = [coeffs[0] ?? 0, coeffs[1] ?? 0, coeffs[2]];
    const disc = c1 * c1 - 4 * c2 * c0;
    if (disc < -1e-12) return null;
    return (-c1 + Math.sqrt(Math.max(0, disc))) / (2 * c2);
  }
  // degree ≥ 3: every real root lies within the Cauchy bound; sample for a sign
  // change and bisect. Odd degree always has one; even degree may or may not.
  const lead = coeffs[d];
  let maxAbs = 0;
  for (let i = 0; i < d; i++) maxAbs = Math.max(maxAbs, Math.abs(coeffs[i] ?? 0));
  const bound = 1 + maxAbs / Math.abs(lead);
  const evalAt = (x: number): number => {
    let s = 0;
    for (let i = d; i >= 0; i--) s = s * x + (coeffs[i] ?? 0);
    return s;
  };
  const steps = 4000;
  let prevX = -bound;
  let prevY = evalAt(prevX);
  if (Math.abs(prevY) < 1e-12) return prevX;
  for (let k = 1; k <= steps; k++) {
    const x = -bound + (2 * bound * k) / steps;
    const y = evalAt(x);
    if (Math.abs(y) < 1e-12) return x;
    if ((prevY < 0 && y > 0) || (prevY > 0 && y < 0)) {
      let lo = prevX;
      let hi = x;
      let flo = prevY;
      for (let it = 0; it < 80; it++) {
        const mid = (lo + hi) / 2;
        const fm = evalAt(mid);
        if (Math.abs(fm) < 1e-13) return mid;
        if ((flo < 0 && fm < 0) || (flo > 0 && fm > 0)) {
          lo = mid;
          flo = fm;
        } else hi = mid;
      }
      return (lo + hi) / 2;
    }
    prevX = x;
    prevY = y;
  }
  return null;
}

/** Bounded existence search: pick a target variable, assign the others to small
 *  values, solve the univariate slice, and VERIFY the candidate against the
 *  original (Laurent) equation — respecting the domain. Returns a witness or null. */
function searchWitness(cleared: Monomial[], original: Monomial[], denominators: string[]): Record<string, number> | null {
  const vars = [...new Set(cleared.flatMap((m) => [...m.powers.keys()]))].sort();
  if (vars.length === 0) return null;
  const CAND = [0, 1, -1, 2, -2, 3, -3];
  const denomSet = new Set(denominators);
  let budget = 3000; // total slices tried, across all targets

  for (const target of vars) {
    const others = vars.filter((v) => v !== target);
    for (const assign of enumerateAssignments(others, CAND, denomSet)) {
      if (budget-- <= 0) return null;
      const coeffs: number[] = [];
      for (const m of cleared) {
        let c = m.coef;
        let deg = 0;
        for (const [v, e] of m.powers) {
          if (v === target) deg = e;
          else c *= Math.pow(assign[v], e);
        }
        coeffs[deg] = (coeffs[deg] ?? 0) + c;
      }
      const root = realRootOfPoly(coeffs);
      if (root === null) continue;
      const vals = { ...assign, [target]: root };
      if (denominators.some((v) => vals[v] === 0)) continue;
      const val = evalLaurent(original, vals);
      if (Number.isFinite(val) && Math.abs(val) < 1e-6) return vals;
    }
  }
  return null;
}

/** Enumerate numeric assignments of `vars` over `cand` (denominator vars skip 0),
 *  capped to keep the search bounded. */
function* enumerateAssignments(vars: string[], cand: number[], denom: Set<string>): Generator<Record<string, number>> {
  if (vars.length === 0) {
    yield {};
    return;
  }
  const cap = 2000;
  let count = 0;
  const rec = function* (i: number, acc: Record<string, number>): Generator<Record<string, number>> {
    if (count >= cap) return;
    if (i === vars.length) {
      count++;
      yield { ...acc };
      return;
    }
    for (const c of cand) {
      if (denom.has(vars[i]) && c === 0) continue;
      yield* rec(i + 1, { ...acc, [vars[i]]: c });
    }
  };
  yield* rec(0, {});
}

export function analyzeNonlinear(equation: string): NonlinearResult {
  let laurent: Monomial[];
  try {
    laurent = parseEquation(equation);
  } catch (e) {
    return { ok: false, reals: "unknown", complex: "unknown", witness: null, domain: [], reason: `could not parse: ${e instanceof Error ? e.message : String(e)}` };
  }
  const { poly, denominators } = clearDenominators(laurent);

  const constant = poly.filter(isConstant).reduce((s, m) => s + m.coef, 0);
  const varTerms = poly.filter((m) => !isConstant(m));
  const vars = new Set<string>();
  for (const m of varTerms) for (const v of m.powers.keys()) vars.add(v);

  // Constant equation: solvable iff it reduces to 0 = 0.
  if (varTerms.length === 0) {
    const solv: Decidable = Math.abs(constant) < 1e-9 ? "solvable" : "unsolvable";
    const witness = solv === "solvable" ? (denominators.length ? `any values (${denominators.join(", ")} ≠ 0)` : "any values") : null;
    return { ok: true, reals: solv, complex: solv, witness, domain: denominators, reason: explain(solv, solv, witness, denominators) };
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

  // ℝ — form 3: anything still undecided → bounded, witness-verified existence
  // search. Only ever upgrades unknown → solvable, and only with a checked witness.
  if (reals === "unknown") {
    const found = searchWitness(poly, laurent, denominators);
    if (found) {
      reals = "solvable";
      witness = fmtAssign(found);
    }
  }

  // Complex witness for the common all-square form when ℝ has no solution.
  if (witness === null && complex === "solvable" && reals === "unsolvable" && pureEven && varTerms.every((m) => [...m.powers.values()][0] === 2)) {
    const first = varTerms[0];
    const v = [...first.powers.keys()][0];
    const val = -constant / first.coef; // need v² = val; val < 0 here
    witness = `${v} = ${fmt(Math.sqrt(-val))}i` + (varTerms.length > 1 ? " (others 0)" : "");
  }

  return { ok: true, reals, complex, witness, domain: denominators, reason: explain(reals, complex, witness, denominators) };
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

function explain(reals: Decidable, complex: Decidable, witness: string | null, denominators: string[]): string {
  const dom = denominators.length ? ` [requires ${denominators.join(", ")} ≠ 0]` : "";
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
  return `${r}; ${c}${dom}`;
}
