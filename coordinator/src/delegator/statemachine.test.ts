import { test } from "node:test";
import assert from "node:assert/strict";
import { expand, goalMet } from "./statemachine.js";
import { parseRule } from "../rules/index.js";

test("parseRule reads PuzzleScript-ish notation", () => {
  assert.deepEqual(parseRule("@ MOV ."), { subject: "@", verb: "MOV", object: "." });
  assert.throws(() => parseRule("@ PUSH ."), /unsupported verb/);
});

test("sokoban expand returns all four moves from the centre", () => {
  const r = expand("   \n @ \n   ");
  assert.equal(r.ok, true);
  assert.equal(r.count, 4);
  assert.deepEqual(
    new Set(r.states.map((s) => s.grid)),
    new Set([
      " @ \n   \n   ", // up
      "   \n@  \n   ", // left
      "   \n  @\n   ", // right
      "   \n   \n @ ", // down
    ]),
  );
  assert.equal(r.success, false); // no goal in this grid
});

test("expand respects edges — a corner @ has two moves", () => {
  const r = expand("@ \n  ");
  assert.equal(r.count, 2); // right and down only
});

test("expand flags success and scores proximity to the goal", () => {
  // @ next to the goal: stepping right wins; stepping down does not.
  const r = expand("@x\n  ");
  assert.equal(r.success, true);
  const win = r.states.find((s) => s.success);
  assert.ok(win, "a winning move exists");
  assert.equal(win!.score, 0);
  const miss = r.states.find((s) => !s.success);
  assert.ok(miss && typeof miss.score === "number", "a non-winning move is scored");
  assert.equal(miss!.score, 2); // moved down to (1,0); goal at (0,1) -> Manhattan 2
});

test("expand treats '#' walls as impassable", () => {
  // Walls sit directly above and left of @. Only right and down are legal.
  const r = expand(" # \n#@ \n   ");
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.deepEqual(
    new Set(r.states.map((s) => s.grid)),
    new Set([
      " # \n# @\n   ", // right
      " # \n#  \n @ ", // down
    ]),
  );
  // Every next state keeps both walls intact (none was overwritten by the move).
  assert.ok(r.states.every((s) => (s.grid.match(/#/g) ?? []).length === 2));
});

test("expand pushes a '$' box when empty floor is beyond it", () => {
  // @$  : the box slides right onto the floor; @ takes the box's old square.
  const r = expand("@$ ");
  assert.equal(r.count, 1);
  assert.equal(r.states[0].grid, " @$");
  assert.equal((r.states[0].grid.match(/\$/g) ?? []).length, 1); // still exactly one box
});

test("expand will not push a box without empty floor beyond it", () => {
  assert.equal(expand("@$#").count, 0); // far tile is a wall
  assert.equal(expand("@$x").count, 0); // far tile is the player goal, not floor
  assert.equal(expand("@$$").count, 0); // far tile is another box
  assert.equal(expand("@$").count, 0); // box at the edge: nothing beyond to push into
});

test("expand pushes a box onto a box goal '.' and flags the win", () => {
  // @$. : pushing the box right covers the only goal -> '*', which wins.
  const r = expand("@$.");
  assert.equal(r.count, 1);
  assert.equal(r.states[0].grid, " @*"); // box covered the goal
  assert.equal(r.states[0].success, true); // all box goals covered
  assert.equal(r.states[0].score, 0); // zero uncovered goals
});

test("expand: covering only one of two box goals is not yet a win", () => {
  // @$.$. : push the first box onto its goal; one goal still uncovered.
  const r = expand("@$.$.");
  const covered = r.states.find((s) => s.grid === " @*$.");
  assert.ok(covered, "the first box can be pushed onto its goal");
  assert.equal(covered!.success, false); // a '.' remains uncovered
  assert.equal(covered!.score, 1); // one uncovered goal
});

test("expand (full Sokoban): a box on a goal '*' can be pushed off again", () => {
  // Pushing the '*' right frees its goal ('.'), the box lands on floor ('$'),
  // and the player ends standing on the freed box goal ('+').
  assert.deepEqual(
    expand("@* ").states.map((s) => s.grid),
    [" +$"],
  );
});

test("expand: the player can walk across an empty box goal '.' (-> '+')", () => {
  assert.deepEqual(
    expand("@. ").states.map((s) => s.grid),
    [" + "],
  );
});

test("goalMet: win = all box goals covered AND the player on 'x'", () => {
  assert.equal(goalMet("  X").met, true); // player on goal, no box goals
  assert.equal(goalMet("  @").met, false); // no goals at all is not a win
  assert.equal(goalMet(" @*").met, true); // box on goal, no player goal
  assert.equal(goalMet(" @.").met, false); // an uncovered box goal remains
  assert.equal(goalMet("#X *").met, true); // player on goal AND box on goal
  assert.equal(goalMet("#@x*").met, false); // player has not reached 'x'
  assert.equal(goalMet("#X .").met, false); // player on 'x' but a '.' uncovered
});

test("expand rejects a ragged grid", () => {
  const r = expand("   \n @");
  assert.equal(r.ok, false);
  assert.match(r.reason, /same width/);
});
