import { test } from "node:test";
import assert from "node:assert/strict";
import { gridValid } from "./grid.js";

test("gridValid: well-formed grid", () => {
  const r = gridValid("...\n.@.\n...");
  assert.equal(r.ok, true);
  assert.equal(r.width, 3);
  assert.equal(r.height, 3);
  assert.equal(r.players, 1);
});

test("gridValid: rejects wrong player count and ragged rows", () => {
  assert.equal(gridValid("...\n.@.\n.@.").ok, false); // two players
  assert.equal(gridValid("...\n...").ok, false); // no player
  assert.equal(gridValid("...\n.@").ok, false); // ragged
});
