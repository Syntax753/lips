import { test } from "node:test";
import assert from "node:assert/strict";
import { gridValid } from "./grid.js";

test("gridValid: well-formed grid", () => {
  const r = gridValid("   \n @ \n   ");
  assert.equal(r.ok, true);
  assert.equal(r.width, 3);
  assert.equal(r.height, 3);
  assert.equal(r.players, 1);
});

test("gridValid: rejects wrong player count and ragged rows", () => {
  assert.equal(gridValid("   \n @ \n @ ").ok, false); // two players
  assert.equal(gridValid("   \n   ").ok, false); // no player
  assert.equal(gridValid("   \n @").ok, false); // ragged
});

test("gridValid: preflight rejects more box goals than boxes", () => {
  const bad = gridValid("@$.."); // 2 goals, 1 box
  assert.equal(bad.ok, false);
  assert.equal(bad.boxGoals, 2);
  assert.equal(bad.boxes, 1);
  assert.match(bad.reason, /box goal/);

  const ok = gridValid("@$$.."); // 2 goals, 2 boxes
  assert.equal(ok.ok, true);
  assert.equal(ok.boxGoals, 2);
  assert.equal(ok.boxes, 2);

  // A covered goal '*' counts as both a goal and a box.
  const covered = gridValid("@ *.$"); // goals: * and . = 2 ; boxes: * and $ = 2
  assert.equal(covered.boxGoals, 2);
  assert.equal(covered.boxes, 2);
  assert.equal(covered.ok, true);
});
