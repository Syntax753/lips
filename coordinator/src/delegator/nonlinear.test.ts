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

test("mixed-sign multivariate is solved by the witness search (was deferred)", () => {
  const r = analyzeNonlinear("x^2 - y^2 = -1"); // real-solvable, e.g. x=0, y=1
  assert.equal(r.reals, "solvable");
  assert.equal(r.complex, "solvable");
  assert.ok(r.witness, "a concrete witness is produced");
});

test("under-determined multivariate gets a verified existence witness", () => {
  const r = analyzeNonlinear("x^2 + y^3 = x + y + 17");
  assert.equal(r.reals, "solvable");
  assert.equal(r.complex, "solvable");
  assert.ok(r.witness, "a concrete witness is produced");
});

test("division (/) parses: rational equation cleared and solved", () => {
  const r = analyzeNonlinear("x^2 + y^3 = x/y");
  assert.equal(r.complex, "solvable");
  assert.equal(r.reals, "solvable"); // e.g. x=(√5-1)/2, y=-1
  assert.deepEqual(r.domain, ["y"]); // y ≠ 0 recorded from the denominator
  assert.ok(r.witness);
});

test("1/x = 0 has no solution (cleared to a nonzero constant)", () => {
  const r = analyzeNonlinear("1/x = 0");
  assert.equal(r.reals, "unsolvable");
  assert.deepEqual(r.domain, ["x"]);
});

test("witness search never fakes an unsolvable form (sum of squares = -1)", () => {
  const r = analyzeNonlinear("x^2 + y^2 = -1");
  assert.equal(r.reals, "unsolvable"); // search must not override a proven 'unsolvable'
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
