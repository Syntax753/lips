import { test } from "node:test";
import assert from "node:assert/strict";
import { solve, optimize } from "./solve.js";

const CLASSIC = ["######", "#.  .#", "#.+@.#", "#.+ .#", "#. ~~#", "######"].join("\n");

test("condense tightens a satisficing plan without re-searching", () => {
  const sat = solve(CLASSIC, undefined, "decompose"); // a valid, non-minimal plan
  assert.equal(sat.solvable, true);
  const c = optimize(CLASSIC, sat.plan!); // local-condense only
  assert.equal(c.valid, true);
  assert.ok(c.moves! <= sat.moves!, `condensed ${c.moves} should be <= satisficing ${sat.moves}`);
  assert.equal(c.optimal, false); // not proven without re-search
});

test("proven re-search reaches the true optimum from a satisficing plan", () => {
  const optimalMoves = solve(CLASSIC, undefined, "optimal").moves!; // 16
  const sat = solve(CLASSIC, undefined, "decompose");
  const r = optimize(CLASSIC, sat.plan!, { proven: true });
  assert.equal(r.valid, true);
  assert.equal(r.optimal, true);
  assert.equal(r.moves, optimalMoves);
});

test("proven on an already-optimal plan confirms it, no improvement", () => {
  const opt = solve(CLASSIC, undefined, "optimal");
  const r = optimize(CLASSIC, opt.plan!, { proven: true });
  assert.equal(r.optimal, true);
  assert.equal(r.moves, opt.moves);
  assert.equal(r.improvedFromMoves, null); // nothing cheaper exists
});

test("an invalid plan is reported, not mis-rendered", () => {
  const r = optimize(CLASSIC, [{ box: 0, row: 0, col: 0, dir: "R", len: 1, ontoGoal: false }]);
  assert.equal(r.valid, false);
});
