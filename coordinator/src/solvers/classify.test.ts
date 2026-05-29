import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "./classify.js";
import { evaluateBoolean } from "./boolean.js";
import { validate } from "./validate.js";

// A minimal solvable Sokoban: push the box one cell right onto its goal.
//   #####
//   #@+~#
//   #####
const TINY_GRID = ["#####", "#@+~#", "#####"].join("\n");

// The Tony word problem, but as explicit equations (the deterministic path).
const TONY = "M = 4*T\nM - 10 = 2*(T - 10)";

test("classify routes by input structure", () => {
  assert.equal(classify(TINY_GRID).kind, "grid");
  assert.equal(classify("12 > 14").kind, "boolean");
  assert.equal(classify("5 > 3 and 2 < 1").kind, "boolean");
  assert.equal(classify(TONY).kind, "algebraic");
  assert.equal(
    classify('[{"id":"A","intervals":[{"starttime":0,"endtime":5,"locationid":"P"}]}]').kind,
    "timeline",
  );
  // Free natural language with number-words is the agentic layer's job.
  assert.equal(classify("is the larger of three and eight over five?").kind, "unknown");
});

test('"5 = 5" is a numeric comparison, not algebra', () => {
  assert.equal(classify("5 = 5").kind, "boolean");
});

test("evaluateBoolean handles single comparisons and homogeneous chains", () => {
  assert.equal(evaluateBoolean("12 > 14")?.value, false);
  assert.equal(evaluateBoolean("is 14 >= 14?")?.value, true);
  assert.equal(evaluateBoolean("5 > 3 and 2 < 1")?.value, false);
  assert.equal(evaluateBoolean("5 > 3 or 2 < 1")?.value, true);
  // Mixed precedence and free NL are refused (-> agentic layer).
  assert.equal(evaluateBoolean("5 > 3 and 2 < 1 or 1 > 0"), null);
  assert.equal(evaluateBoolean("twelve greater than fourteen"), null);
});

test("validate(grid) solves and reports the uniform verdict", () => {
  const v = validate(TINY_GRID);
  assert.equal(v.kind, "grid");
  assert.equal(v.valid, true);
  assert.equal(v.metrics.moves, 1);
  assert.equal(v.metrics.pushes, 1);
  assert.equal(typeof v.witness, "string");
});

test("validate(algebraic) solves the system", () => {
  const v = validate(TONY);
  assert.equal(v.kind, "algebraic");
  assert.equal(v.valid, true);
  assert.deepEqual(v.witness, { T: -5, M: -20 });
});

test("validate(boolean) evaluates to a truth", () => {
  const v = validate("5 > 3 and 2 < 1");
  assert.equal(v.kind, "boolean");
  assert.equal(v.valid, false);
});

test("validate(unknown) defers to the agentic layer instead of guessing", () => {
  const v = validate("which character can reach everyone first?");
  assert.equal(v.kind, "unknown");
  assert.equal(v.valid, false);
});
