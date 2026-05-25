import { test } from "node:test";
import assert from "node:assert/strict";
import { expand } from "./statemachine.js";
import { parseRule } from "../rules/index.js";

test("parseRule reads PuzzleScript-ish notation", () => {
  assert.deepEqual(parseRule("@ MOV ."), { subject: "@", verb: "MOV", object: "." });
  assert.throws(() => parseRule("@ PUSH ."), /unsupported verb/);
});

test("sokoban expand returns all four moves from the centre", () => {
  const r = expand("...\n.@.\n...");
  assert.equal(r.ok, true);
  assert.equal(r.count, 4);
  assert.deepEqual(
    new Set(r.states.map((s) => s.grid)),
    new Set([
      ".@.\n...\n...", // up
      "...\n@..\n...", // left
      "...\n..@\n...", // right
      "...\n...\n.@.", // down
    ]),
  );
  assert.equal(r.success, false); // no goal in this grid
});

test("expand respects edges — a corner @ has two moves", () => {
  const r = expand("@.\n..");
  assert.equal(r.count, 2); // right and down only
});

test("expand flags success and scores proximity to the goal", () => {
  // @ next to the goal: stepping right wins; stepping down does not.
  const r = expand("@x\n..");
  assert.equal(r.success, true);
  const win = r.states.find((s) => s.success);
  assert.ok(win, "a winning move exists");
  assert.equal(win!.score, 0);
  const miss = r.states.find((s) => !s.success);
  assert.ok(miss && typeof miss.score === "number", "a non-winning move is scored");
  assert.equal(miss!.score, 2); // moved down to (1,0); goal at (0,1) -> Manhattan 2
});

test("expand rejects a ragged grid", () => {
  const r = expand("...\n.@");
  assert.equal(r.ok, false);
  assert.match(r.reason, /same width/);
});
