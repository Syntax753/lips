/**
 * A tiny linear-algebra engine: parse linear equations into coefficient form,
 * then isolate / substitute / solve. Everything is linear in each variable —
 * a product or quotient of two variables is rejected as nonlinear.
 *
 * An expression is represented as `sum(coeff_i * var_i) + constant`.
 * An equation `L = R` is stored as its residual `L - R`, understood to equal 0.
 */

export interface LinearExpr {
  coeffs: Map<string, number>;
  constant: number;
}

const EPS = 1e-9;

/** Round values that are within EPS of an integer (kills float fuzz). */
function tidy(n: number): number {
  const r = Math.round(n);
  return Math.abs(n - r) < EPS ? r : n;
}

// --- constructors ------------------------------------------------------------

export function constant(n: number): LinearExpr {
  return { coeffs: new Map(), constant: n };
}

export function variable(name: string): LinearExpr {
  return { coeffs: new Map([[name, 1]]), constant: 0 };
}

// --- arithmetic (results are always pruned of zero coefficients) -------------

function prune(e: LinearExpr): LinearExpr {
  for (const [k, v] of [...e.coeffs]) if (Math.abs(v) < EPS) e.coeffs.delete(k);
  return e;
}

export function add(a: LinearExpr, b: LinearExpr): LinearExpr {
  const coeffs = new Map(a.coeffs);
  for (const [k, v] of b.coeffs) coeffs.set(k, (coeffs.get(k) ?? 0) + v);
  return prune({ coeffs, constant: a.constant + b.constant });
}

export function neg(a: LinearExpr): LinearExpr {
  return scale(a, -1);
}

export function sub(a: LinearExpr, b: LinearExpr): LinearExpr {
  return add(a, neg(b));
}

export function scale(a: LinearExpr, k: number): LinearExpr {
  const coeffs = new Map<string, number>();
  for (const [key, v] of a.coeffs) coeffs.set(key, v * k);
  return prune({ coeffs, constant: a.constant * k });
}

export function isConstant(e: LinearExpr): boolean {
  return e.coeffs.size === 0;
}

export function variablesOf(e: LinearExpr): string[] {
  return [...e.coeffs.keys()].sort();
}

// --- parsing -----------------------------------------------------------------

type Tok = { kind: "num" | "id" | "op" | "lp" | "rp"; text: string };

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      toks.push({ kind: "num", text: s.slice(i, j) });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      toks.push({ kind: "id", text: s.slice(i, j) });
      i = j;
    } else if (c === "(") {
      toks.push({ kind: "lp", text: c });
      i++;
    } else if (c === ")") {
      toks.push({ kind: "rp", text: c });
      i++;
    } else if ("+-*/".includes(c)) {
      toks.push({ kind: "op", text: c });
      i++;
    } else {
      throw new Error(`unexpected character '${c}'`);
    }
  }
  return toks;
}

/** Recursive-descent parser. Supports implicit multiplication (4T, 2(T-10)). */
export function parseExpression(input: string): LinearExpr {
  const toks = tokenize(input);
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const next = (): Tok => toks[pos++];
  const startsFactor = (t: Tok | undefined): boolean =>
    !!t && (t.kind === "num" || t.kind === "id" || t.kind === "lp");

  function multiply(a: LinearExpr, b: LinearExpr): LinearExpr {
    if (isConstant(a)) return scale(b, a.constant);
    if (isConstant(b)) return scale(a, b.constant);
    throw new Error("nonlinear term: product of two variables");
  }
  function divide(a: LinearExpr, b: LinearExpr): LinearExpr {
    if (!isConstant(b)) throw new Error("nonlinear term: division by a variable");
    if (Math.abs(b.constant) < EPS) throw new Error("division by zero");
    return scale(a, 1 / b.constant);
  }

  function parseFactor(): LinearExpr {
    const t = peek();
    if (!t) throw new Error("unexpected end of expression");
    if (t.kind === "op" && t.text === "-") {
      next();
      return neg(parseFactor());
    }
    if (t.kind === "op" && t.text === "+") {
      next();
      return parseFactor();
    }
    if (t.kind === "lp") {
      next();
      const e = parseExpr();
      const close = next();
      if (!close || close.kind !== "rp") throw new Error("missing ')'");
      return e;
    }
    if (t.kind === "num") {
      next();
      const n = Number(t.text);
      if (Number.isNaN(n)) throw new Error(`bad number '${t.text}'`);
      return constant(n);
    }
    if (t.kind === "id") {
      next();
      return variable(t.text);
    }
    throw new Error(`unexpected token '${t.text}'`);
  }

  function parseTerm(): LinearExpr {
    let left = parseFactor();
    for (;;) {
      const t = peek();
      if (t && t.kind === "op" && (t.text === "*" || t.text === "/")) {
        const op = next().text;
        const right = parseFactor();
        left = op === "*" ? multiply(left, right) : divide(left, right);
      } else if (startsFactor(t)) {
        left = multiply(left, parseFactor()); // implicit multiplication
      } else {
        break;
      }
    }
    return left;
  }

  function parseExpr(): LinearExpr {
    let left = parseTerm();
    while (peek()?.kind === "op" && (peek()!.text === "+" || peek()!.text === "-")) {
      const op = next().text;
      const right = parseTerm();
      left = op === "+" ? add(left, right) : sub(left, right);
    }
    return left;
  }

  const result = parseExpr();
  if (pos !== toks.length) throw new Error(`unexpected token '${peek()?.text}'`);
  return result;
}

/** Parse `lhs = rhs` into the residual `lhs - rhs` (which equals 0). */
export function parseEquation(s: string): LinearExpr {
  const parts = s.split("=");
  if (parts.length !== 2) {
    throw new Error(`equation must contain exactly one '=': "${s}"`);
  }
  return sub(parseExpression(parts[0]), parseExpression(parts[1]));
}

/** Distinct variables of an equation string. */
export function equationVariables(s: string): string[] {
  return variablesOf(parseEquation(s));
}

// --- manipulation ------------------------------------------------------------

/** Isolate `v` in `residual = 0`, returning the expression equal to `v`. */
export function isolate(residual: LinearExpr, v: string): LinearExpr {
  const c = residual.coeffs.get(v);
  if (c === undefined || Math.abs(c) < EPS) {
    throw new Error(`cannot isolate '${v}': it is not present in the equation`);
  }
  const rest = sub(residual, scale(variable(v), c)); // residual without the c*v term
  return scale(rest, -1 / c); // v = -rest / c
}

/** Replace `v` with a known numeric value throughout the residual. */
export function substituteValue(residual: LinearExpr, v: string, value: number): LinearExpr {
  const c = residual.coeffs.get(v);
  if (c === undefined) return residual;
  const without = sub(residual, scale(variable(v), c));
  return add(without, constant(c * value));
}

/** Replace `v` with another linear expression throughout the residual. */
export function substituteExpr(residual: LinearExpr, v: string, value: LinearExpr): LinearExpr {
  const c = residual.coeffs.get(v);
  if (c === undefined) return residual;
  const without = sub(residual, scale(variable(v), c));
  return add(without, scale(value, c));
}

export type SingleSolution = { variable: string; value: number };

/** Solve `residual = 0` for `v`, requiring no other variable to remain. */
export function solveSingle(residual: LinearExpr, v: string): SingleSolution {
  const others = variablesOf(residual).filter((x) => x !== v);
  if (others.length > 0) {
    throw new Error(`equation still has other unknowns: ${others.join(", ")}`);
  }
  const c = residual.coeffs.get(v) ?? 0;
  if (Math.abs(c) < EPS) {
    if (Math.abs(residual.constant) < EPS) {
      throw new Error(`'${v}' is unconstrained (infinitely many solutions)`);
    }
    throw new Error("no solution: the equation is contradictory");
  }
  return { variable: v, value: tidy(-residual.constant / c) };
}

// --- formatting --------------------------------------------------------------

/** Render a linear expression like "4*T - 10". */
export function formatExpr(e: LinearExpr): string {
  const parts: { coeff: number; label: string }[] = [];
  for (const v of variablesOf(e)) parts.push({ coeff: e.coeffs.get(v)!, label: `*${v}` });
  if (Math.abs(e.constant) >= EPS || parts.length === 0) {
    parts.push({ coeff: e.constant, label: "" });
  }
  return parts
    .map((p, i) => {
      const mag = tidy(Math.abs(p.coeff));
      const term = `${mag}${p.label}`;
      if (i === 0) return (p.coeff < 0 ? "-" : "") + term;
      return (p.coeff < 0 ? " - " : " + ") + term;
    })
    .join("");
}
