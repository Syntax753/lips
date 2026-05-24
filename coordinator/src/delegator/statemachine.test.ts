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
    new Set(r.states),
    new Set([
      ".@.\n...\n...", // up
      "...\n@..\n...", // left
      "...\n..@\n...", // right
      "...\n...\n.@.", // down
    ]),
  );
});

test("expand respects edges — a corner @ has two moves", () => {
  const r = expand("@.\n..");
  assert.equal(r.count, 2); // right and down only
});

test("expand rejects a ragged grid", () => {
  const r = expand("...\n.@");
  assert.equal(r.ok, false);
  assert.match(r.reason, /same width/);
});
