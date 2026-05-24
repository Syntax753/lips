import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import * as L from "../algebra/linear.js";
import type { Cmp } from "./types.js";

/**
 * The ALGEBRAIC delegator. It owns the domain's reducer/evaluator/solver logic
 * and resolves a whole linear system deterministically — preflight (evaluate
 * solvability) → reduce (isolate + substitute) → solve — so the coordinator
 * does not have to drive those steps tool-by-tool.
 *
 *   evaluator : preflight()      — is the RDR list solvable?
 *   reducer   : reduce()         — isolate / substitute (solving folds in here)
 *   system    : solveSystem()    — the deterministic end-to-end entry
 */

// --- evaluator: preflight (solvability of an RDR list) -----------------------

export type PreflightResult = {
  ok: boolean;
  equationCount: number;
  unknownCount: number;
  unknowns: string[];
  connected: boolean;
  determined: boolean;
  reason: string;
};

export function preflight(equations: string[]): PreflightResult {
  const varsPerEq = equations.map(L.equationVariables);
  const unknownSet = new Set<string>();
  for (const vs of varsPerEq) for (const v of vs) unknownSet.add(v);
  const unknowns = [...unknownSet].sort();
  const equationCount = equations.length;
  const unknownCount = unknowns.length;

  const parent = new Map<string, string>(unknowns.map((v) => [v, v]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const vs of varsPerEq) for (let i = 1; i < vs.length; i++) union(vs[0], vs[i]);
  const connected = unknownCount <= 1 ? true : new Set(unknowns.map(find)).size === 1;

  const determined = equationCount === unknownCount;
  const ok = unknownCount > 0 && connected && equationCount >= unknownCount;

  const reason = ok
    ? determined
      ? `solvable: ${equationCount} equations, ${unknownCount} unknowns, all connected`
      : `overdetermined but connected: ${equationCount} equations, ${unknownCount} unknowns`
    : unknownCount === 0
      ? "no unknowns found"
      : !connected
        ? "the unknowns are not all connected through shared equations"
        : `underdetermined: ${equationCount} equation(s) for ${unknownCount} unknown(s)`;

  return { ok, equationCount, unknownCount, unknowns, connected, determined, reason };
}

// --- reducer: isolate one variable, optionally substituting known relations --

export type ReduceResult = {
  variable: string;
  expression: string;
  remainingVariables: string[];
  value: number | null;
};

export function reduce(
  equation: string,
  isolateVar: string,
  substitutions?: Record<string, string>,
): ReduceResult {
  let residual = L.parseEquation(equation);
  if (substitutions) {
    for (const [v, exprStr] of Object.entries(substitutions)) {
      residual = L.substituteExpr(residual, v, L.parseExpression(exprStr));
    }
  }
  const expr = L.isolate(residual, isolateVar);
  const remaining = L.variablesOf(expr);
  return {
    variable: isolateVar,
    expression: L.formatExpr(expr),
    remainingVariables: remaining,
    value: remaining.length === 0 ? expr.constant : null,
  };
}

// --- the deterministic system solve (evaluator -> reducer/solver) ------------

/** One internal operation the delegator performed, with its inputs and output. */
export type OpTrace = { name: string; input: string; output: string };

export type AlgebraicResult = {
  ok: boolean;
  preflight: PreflightResult;
  solution: Record<string, number>;
  /** Each original equation rendered with the solution substituted in, as a
   *  CMP to send to the `eq` comparator to confirm the solution holds. */
  comparables: Cmp[];
  /** Structured trace of each internal op (preflight, reduce, solve). */
  trace: OpTrace[];
  reason: string;
};

function evalToNumber(side: string, values: Record<string, number>): number {
  let e = L.parseExpression(side);
  for (const [v, n] of Object.entries(values)) e = L.substituteValue(e, v, n);
  if (!L.isConstant(e)) throw new Error(`"${side.trim()}" still has unknowns`);
  return e.constant;
}

export function solveSystem(equations: string[]): AlgebraicResult {
  const pf = preflight(equations);
  const trace: OpTrace[] = [
    {
      name: "preflight",
      input: `equations: ${JSON.stringify(equations)}`,
      output: pf.reason,
    },
  ];
  const solution: Record<string, number> = {};
  const fail = (reason: string): AlgebraicResult => ({
    ok: false,
    preflight: pf,
    solution,
    comparables: [],
    trace,
    reason,
  });

  if (!pf.ok) return fail(pf.reason);

  // Forward elimination by substitution: isolate a variable, substitute it into
  // the rest, repeat. Each step removes one equation and one unknown.
  let working = equations.map((e) => L.parseEquation(e));
  const chain: { variable: string; expr: L.LinearExpr }[] = [];
  while (working.some((e) => L.variablesOf(e).length > 0)) {
    const idx = working.findIndex((e) => L.variablesOf(e).length > 0);
    const v = L.variablesOf(working[idx])[0];
    const expr = L.isolate(working[idx], v);
    trace.push({
      name: "reduce",
      input: `isolate ${v} in ${L.formatExpr(working[idx])} = 0`,
      output: `${v} = ${L.formatExpr(expr)}`,
    });
    chain.push({ variable: v, expr });
    working = working.filter((_, i) => i !== idx).map((other) => L.substituteExpr(other, v, expr));
  }

  // Leftover equations are pure constants; a nonzero one means no solution.
  if (working.some((e) => Math.abs(e.constant) > 1e-9)) {
    return fail("system is inconsistent (no solution)");
  }

  // Back-substitution: resolve each isolated variable using already-known values.
  for (let i = chain.length - 1; i >= 0; i--) {
    const { variable, expr } = chain[i];
    const knowns = { ...solution };
    let e = expr;
    for (const [kv, val] of Object.entries(knowns)) e = L.substituteValue(e, kv, val);
    if (!L.isConstant(e)) return fail(`dependent system: cannot resolve ${variable}`);
    solution[variable] = e.constant;
    const known = Object.entries(knowns)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    trace.push({
      name: "solve",
      input: `${variable} = ${L.formatExpr(expr)}${known ? ` with ${known}` : ""}`,
      output: `${variable} = ${e.constant}`,
    });
  }

  const missing = pf.unknowns.filter((u) => !(u in solution));
  if (missing.length > 0) return fail(`unsolved: ${missing.join(", ")}`);

  // Reduce each equation to a CMP (eq) the coordinator can use to verify the solution.
  const comparables: Cmp[] = equations.map((eq) => {
    const [lhs, rhs] = eq.split("=");
    return {
      type: "CMP",
      lhs: String(evalToNumber(lhs, solution)),
      rhs: String(evalToNumber(rhs, solution)),
      comparator: "eq",
    };
  });

  return { ok: true, preflight: pf, solution, comparables, trace, reason: "solved" };
}

// --- the delegator tool ------------------------------------------------------

export const algebraicTool = tool(
  "algebraic",
  "Solve a LINEAR system end-to-end. Give it the list of equations (RDR forms). It evaluates solvability (preflight), then reduces and solves deterministically, returning { ok, solution, comparables, steps }. Each `comparable` is a CMP (lhs, rhs, comparator='eq') you can send to the eq comparator to confirm the solution.",
  {
    equations: z
      .array(z.string())
      .describe('linear equations, e.g. ["M = 4*T", "M - 10 = 2*(T - 10)"]'),
  },
  async (args) => {
    const result = solveSystem(args.equations);
    const text = result.ok
      ? `solution: ${Object.entries(result.solution)
          .map(([k, v]) => `${k} = ${v}`)
          .join(", ")}`
      : `not solvable: ${result.reason}`;
    return { content: [{ type: "text", text }], structuredContent: result };
  },
);
