import { before, test } from "node:test";
import assert from "node:assert/strict";

import { solveSystem, preflight } from "./delegator/algebraic.js";
import { directEvaluate } from "./mcpClient.js";
import { ensureServerReady } from "./bootstrap.js";

/**
 * End-to-end test of the algebraic delegator on:
 *
 *   "Tony is my nephew and I am four times his age. 10 years ago I was double
 *    his age. How old is Tony?"   ->   M = 4T ;  M - 10 = 2(T - 10)
 *
 * The delegator resolves the system deterministically; this test confirms the
 * tools are exercised to:
 *   (a) confirm it's solvable     — evaluator / preflight,
 *   (b) solve for each unknown    — reducer + solver, one solve per unknown,
 *   (c) check each boolean truth  — the Go `eq` comparator on each CMP.
 *
 * As stated the problem yields T = -5 (a negative age) — mathematically sound.
 */

const EQUATIONS = ["M = 4*T", "M - 10 = 2*(T - 10)"];

before(async () => {
  // (c) calls the real Go MCP server, so make sure the binary is built.
  await ensureServerReady();
});

test("(a) the evaluator confirms the system is solvable", () => {
  const pf = preflight(EQUATIONS);
  assert.equal(pf.ok, true);
  assert.equal(pf.equationCount, 2);
  assert.equal(pf.unknownCount, 2);
  assert.deepEqual(pf.unknowns, ["M", "T"]);
  assert.equal(pf.connected, true);
});

test("(b) the delegator solves for each unknown: T = -5, M = -20", () => {
  const r = solveSystem(EQUATIONS);
  assert.equal(r.ok, true);
  assert.equal(r.preflight.ok, true); // (a) ran inside the delegator
  assert.equal(r.solution.T, -5);
  assert.equal(r.solution.M, -20);
  // one solve op per unknown, and a preflight op up front
  assert.equal(r.trace.filter((op) => op.name === "solve").length, 2);
  assert.equal(r.trace[0]?.name, "preflight");
});

test("(c) comparators confirm each equation holds at the solution", async () => {
  const r = solveSystem(EQUATIONS);
  assert.equal(r.comparables.length, EQUATIONS.length);
  for (const c of r.comparables) {
    assert.equal(c.type, "CMP");
    assert.equal(c.comparator, "eq");
    const holds = await directEvaluate(c.comparator, Number(c.lhs), Number(c.rhs));
    assert.equal(holds, true);
  }
});
