import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMicroban } from "./microban.js";
import { solve } from "../../delegator/solve.js";

/**
 * Difficulty-graded validation against the vendored Microban set (155 puzzles,
 * all solvable). The loader is validated fully and fast; the solver is asserted
 * correct over an easy/medium prefix (a fast regression lock). The FULL curve —
 * 145/155 solved within the default cap, the rest cap-limited (genuinely hard,
 * not bugs) — lives in the bench (npm run bench -- microban).
 *
 * History: this harness caught a real bug — the tunnel-macro push optimization
 * was unsound (it slid a box past intermediate rest cells the player needs,
 * reporting 35 solvable levels as unsolvable). The macro was removed; the prefix
 * below now asserts cleanly with no skips.
 */

const levels = loadMicroban();

// The first level the OPTIMAL search can't crack within the default state cap
// (genuinely hard, not a correctness failure). The prefix before it must solve.
const PREFIX = 40;

test("loads all 155 Microban levels, each well-formed", () => {
  assert.equal(levels.length, 155);
  for (const lv of levels) {
    const rows = lv.grid.split("\n");
    const w = rows[0].length;
    assert.ok(rows.every((r) => r.length === w), `level ${lv.number}: rows not rectangular`);
    const players = (lv.grid.match(/[@X+]/g) ?? []).length;
    assert.equal(players, 1, `level ${lv.number}: expected exactly one player`);
    const boxes = (lv.grid.match(/[$*]/g) ?? []).length;
    const goals = (lv.grid.match(/[.*+]/g) ?? []).length;
    assert.ok(boxes >= 1, `level ${lv.number}: no boxes`);
    assert.equal(boxes, goals, `level ${lv.number}: ${boxes} boxes vs ${goals} goals`);
  }
});

// Regression lock: the easy/medium prefix must all solve optimally.
for (const lv of levels.slice(0, PREFIX)) {
  test(`solves Microban #${lv.number}`, () => {
    const r = solve(lv.grid);
    assert.equal(r.solvable, true, `level ${lv.number}: ${r.reason}`);
    assert.ok((r.moves ?? 0) > 0, `level ${lv.number}: expected a positive move count`);
  });
}
