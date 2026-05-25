import { test } from "node:test";
import assert from "node:assert/strict";
import { solve, bestMove } from "./solve.js";

test("solve: finds the goal and reports the MINIMUM move count", () => {
  // @ at (0,0), x at (0,2): two moves right.
  const r = solve("@.x\n...\n...");
  assert.equal(r.solvable, true);
  assert.equal(r.moves, 2);
  assert.equal(r.path?.[0], "@.x\n...\n...");
  assert.equal(r.path?.[r.path.length - 1], r.winning);
});

test("solve: shortest path even when a longer one exists", () => {
  // @ at top-left, x at bottom-right of a 3x3: Manhattan distance 4.
  const r = solve("@..\n...\n..x");
  assert.equal(r.solvable, true);
  assert.equal(r.moves, 4);
});

test("bestMove: optimal next step, and re-applying plays it out", () => {
  const r = bestMove("@.x\n...\n...");
  assert.equal(r.solvable, true);
  assert.equal(r.move, ".@x\n...\n..."); // step right toward x
  assert.equal(r.movesRemaining, 2);
  assert.equal(r.reachedGoal, false);

  // Re-apply on the returned grid: now one move reaches the goal.
  const r2 = bestMove(r.move!);
  assert.equal(r2.reachedGoal, true);
  assert.equal(r2.movesRemaining, 1);
  assert.equal(r2.move, "..@\n...\n...");
});

test("solve: routes around '#' walls and reports the detour length", () => {
  // A wall column between @ and x: the straight path is blocked, so the player
  // detours down, across the open bottom row, and back up — 6 moves.
  const r = solve("@#x\n.#.\n...");
  assert.equal(r.solvable, true);
  assert.equal(r.moves, 6);
  // The walls are never stepped on: every grid on the path keeps both '#'.
  assert.ok(r.path!.every((g) => (g.match(/#/g) ?? []).length === 2));
});

test("solve: walls can make the goal unreachable", () => {
  // '#' fully walls the goal off from the player.
  const r = solve("@..\n###\n..x");
  assert.equal(r.solvable, false);
  assert.equal(r.moves, null);
});

test("solve: no goal -> not solvable, and pruning skips revisited states", () => {
  const r = solve("@..\n...\n...");
  assert.equal(r.solvable, false);
  assert.equal(r.moves, null);
  assert.ok(r.explored <= 9, "explores at most the 9 reachable cells");
  assert.ok(r.pruned > 0, "revisited states are pruned");
});
