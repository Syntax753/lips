import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "./classify.js";
import { evaluateBoolean } from "./boolean.js";
import { validate } from "./validate.js";

// A minimal solvable Sokoban: push the box one cell right onto its goal.
//   #####
//   #@$.#
//   #####
const TINY_GRID = ["#####", "#@$.#", "#####"].join("\n");

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

test("classify tags geopolitical claims as political (web-research skill)", () => {
  assert.equal(classify("will world war one end in 1918").kind, "political");
  assert.equal(classify("Does UAE have more oil than the United States?").kind, "political");
  assert.equal(classify("find someone who fought in both world war I and world war II").kind, "political");
  assert.equal(classify("did the treaty of versailles end the war").kind, "political");
  // A people-relation question carries no geo signal → stays unknown (connect-people territory).
  assert.equal(classify("is jesus related to stallone").kind, "unknown");
  // A plain word problem stays unknown, not political.
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
  // witness now carries the winning grid + the push-vector plan + analysis.
  const w = v.witness as { winning: string; plan: unknown[] };
  assert.equal(typeof w.winning, "string");
  assert.ok(Array.isArray(w.plan));
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

test("validate(political) defers to the web-research skill instead of guessing", () => {
  const v = validate("does the UAE have more oil than the United States?");
  assert.equal(v.kind, "political");
  assert.equal(v.valid, false); // undecided here by design — the political skill resolves it
});
