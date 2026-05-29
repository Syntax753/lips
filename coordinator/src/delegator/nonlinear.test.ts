import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeNonlinear } from "./nonlinear.js";
import { validate } from "../solvers/validate.js";

test("sum of squares = negative: no real solution, complex yes", () => {
  const r = analyzeNonlinear("x^2 + y^2 = -1");
  assert.equal(r.reals, "unsolvable");
  assert.equal(r.complex, "solvable");
  assert.match(r.witness ?? "", /i/); // a complex sample like "y = 1i"
});

test("sum of squares = positive: real solvable", () => {
  const r = analyzeNonlinear("x^2 + y^2 = 5");
  assert.equal(r.reals, "solvable");
  assert.equal(r.complex, "solvable");
});

test("sum of squares = 0: real solvable (the origin)", () => {
  assert.equal(analyzeNonlinear("x^2 + y^2 = 0").reals, "solvable");
});

test("single-variable quadratic decided by the discriminant", () => {
  assert.equal(analyzeNonlinear("x^2 = 4").reals, "solvable"); // x = ±2
  assert.equal(analyzeNonlinear("x^2 = -4").reals, "unsolvable"); // no real root
  assert.equal(analyzeNonlinear("x^2 = -4").complex, "solvable");
});

test("odd-degree univariate always has a real root", () => {
  assert.equal(analyzeNonlinear("x^3 = 8").reals, "solvable");
});

test("mixed-sign multivariate is DEFERRED over ℝ, not guessed", () => {
  const r = analyzeNonlinear("x^2 - y^2 = -1"); // actually real-solvable, but our slice doesn't prove it
  assert.equal(r.reals, "unknown");
  assert.equal(r.complex, "solvable");
});

test("parentheses are deferred, not mis-parsed", () => {
  assert.equal(analyzeNonlinear("(x+1)^2 = 4").reals, "unknown");
});

test("validate routes ^ to the nonlinear slice (real default, complex in witness)", () => {
  const v = validate("x^2 + y^2 = -1");
  assert.equal(v.kind, "algebraic");
  assert.equal(v.valid, false); // default domain ℝ: no solution
  const w = v.witness as { reals: string; complex: string };
  assert.equal(w.reals, "unsolvable");
  assert.equal(w.complex, "solvable");
});
