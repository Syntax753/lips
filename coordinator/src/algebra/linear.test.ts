import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEquation,
  parseExpression,
  isolate,
  substituteExpr,
  solveSingle,
  equationVariables,
  formatExpr,
} from "./linear.js";

test("parses implicit multiplication and finds variables", () => {
  assert.deepEqual(equationVariables("M = 4T"), ["M", "T"]);
  assert.deepEqual(equationVariables("M - 10 = 2(T - 10)"), ["M", "T"]);
});

test("isolate + substitute + solve (Tony system)", () => {
  const mInT = isolate(parseEquation("M = 4T"), "M");
  assert.equal(formatExpr(mInT), "4*T");

  const eq2 = substituteExpr(parseEquation("M - 10 = 2(T - 10)"), "M", mInT);
  assert.equal(formatExpr(eq2), "2*T + 10"); // residual = 0
  assert.equal(solveSingle(eq2, "T").value, -5);
});

test("rejects nonlinear products", () => {
  assert.throws(() => parseExpression("T*T"), /nonlinear/);
});

test("detects contradictory and unconstrained equations", () => {
  assert.throws(() => solveSingle(parseEquation("2 = 3"), "x"), /no solution/);
  assert.throws(() => solveSingle(parseEquation("0 = 0"), "x"), /unconstrained/);
});
