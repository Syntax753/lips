import { before, test } from "node:test";
import assert from "node:assert/strict";

import { preflightTool, type PreflightResult } from "./validators/preflight.js";
import { reduceTool, type ReduceResult } from "./reducers/algebra.js";
import { solveTool, type SolveResult } from "./solvers/algebra.js";
import { directEvaluate } from "./mcpClient.js";
import { ensureServerReady } from "./bootstrap.js";
import { parseExpression, substituteValue, isConstant } from "./algebra/linear.js";

/**
 * End-to-end test of the algebra pipeline on:
 *
 *   "Tony is my nephew and I am four times his age. 10 years ago I was double
 *    his age. How old is Tony?"   ->   M = 4T ;  M - 10 = 2(T - 10)
 *
 * It exercises the actual tools to:
 *   (a) confirm the system is solvable (validators/preflight),
 *   (b) solve for each unknown (solvers/solve),
 *   (c) verify each equation with a boolean comparator (the Go eq tool).
 *
 * As stated the problem yields T = -5 (a negative age) — mathematically sound,
 * which is exactly what the pipeline should report.
 */

const EQUATIONS = ["M = 4*T", "M - 10 = 2*(T - 10)"];

/** Pull structuredContent out of a tool handler's CallToolResult. */
async function structured<T>(p: Promise<unknown>): Promise<T> {
  const r = (await p) as { structuredContent?: unknown };
  return r.structuredContent as T;
}

/** Evaluate one side of an equation to a number given known variable values. */
function evalSide(side: string, values: Record<string, number>): number {
  let e = parseExpression(side);
  for (const [v, n] of Object.entries(values)) e = substituteValue(e, v, n);
  if (!isConstant(e)) throw new Error(`"${side}" still has unknowns`);
  return e.constant;
}

before(async () => {
  // The comparator check (c) calls the real Go MCP server, so ensure it's built.
  await ensureServerReady();
});

test("(a) preflight confirms the system is solvable", async () => {
  const r = await structured<PreflightResult>(
    preflightTool.handler({ equations: EQUATIONS }, undefined),
  );
  assert.equal(r.ok, true);
  assert.equal(r.equationCount, 2);
  assert.equal(r.unknownCount, 2);
  assert.deepEqual(r.unknowns, ["M", "T"]);
  assert.equal(r.connected, true);
});

test("(b) solvers solve for each unknown: T = -5, M = -20", async () => {
  // reducer expresses M in terms of T ...
  const mInT = await structured<ReduceResult>(
    reduceTool.handler({ equation: EQUATIONS[0], isolate: "M" }, undefined),
  );
  assert.equal(mInT.expression, "4*T");

  // ... substitute it into eq2 and SOLVE for T ...
  const eq2InT = EQUATIONS[1].replace("M", `(${mInT.expression})`);
  const tSol = await structured<SolveResult>(
    solveTool.handler({ equation: eq2InT, variable: "T" }, undefined),
  );
  assert.equal(tSol.value, -5);

  // ... then SOLVE for M using the now-known T.
  const mSol = await structured<SolveResult>(
    solveTool.handler({ equation: EQUATIONS[0], variable: "M", knowns: { T: tSol.value } }, undefined),
  );
  assert.equal(mSol.value, -20);
});

test("(c) comparators verify each equation holds at the solution", async () => {
  const solution = { T: -5, M: -20 };
  for (const eq of EQUATIONS) {
    const [lhs, rhs] = eq.split("=");
    const holds = await directEvaluate("eq", evalSide(lhs, solution), evalSide(rhs, solution));
    assert.equal(holds, true, `equation should hold at the solution: ${eq}`);
  }
});
