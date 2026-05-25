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
  assert.equal(r2.move, "..X\n...\n..."); // player standing on the goal is 'X'
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

test("solve: pushes a '+' box out of the way to reach the goal", () => {
  // Walls leave only ONE first move — pushing the box down — then 3 more. 4 total.
  const r = solve("#@##\n#+.#\n#..#\n#.x#");
  assert.equal(r.solvable, true);
  assert.equal(r.moves, 4);
  // The first step pushed the box down: player onto the box's old square, box one further.
  assert.equal(r.path?.[1], "#.##\n#@.#\n#+.#\n#.x#");
  assert.equal((r.path![1].match(/\+/g) ?? []).length, 1); // still exactly one box
});

test("solve: a box that can't be pushed onto the goal seals it off", () => {
  // 1-wide corridor; the box sits between @ and x and can't be pushed onto 'x'.
  const r = solve("###\n@+x\n###");
  assert.equal(r.solvable, false);
  assert.equal(r.moves, null);
});

test("solve: covers a box goal '~' to win (box-goal mode)", () => {
  // Pushing the box one step right covers the only box goal.
  const r = solve("@+~");
  assert.equal(r.solvable, true);
  assert.equal(r.moves, 1);
  assert.equal(r.winning, ".@*"); // the box now sits on the goal
});

test("solve: preflight rejects more box goals than boxes", () => {
  const r = solve("@+~~"); // 2 goals, 1 box
  assert.equal(r.solvable, false);
  assert.equal(r.moves, null);
  assert.match(r.reason, /preflight/);
});

test("solve: a grid with all box goals already covered needs 0 moves", () => {
  const r = solve("@.*"); // the single goal is already covered
  assert.equal(r.solvable, true);
  assert.equal(r.moves, 0);
});

test("solve: walls + boxes maze reaches the goal in the minimum 18 moves", () => {
  // Boxes must be pushed out of the way (the start is otherwise sealed). BFS
  // finds the shortest legal play; the minimum is 18 moves.
  const r = solve("@.#...#\n#+#...#\n..#+#+#\n..#.#..\n....#.x");
  assert.equal(r.solvable, true);
  assert.equal(r.moves, 18);
});

test("solve: covers all box goals AND the player reaches 'x' in a walled room", () => {
  // 3 boxes, 2 box goals '~', plus the player goal 'x' (spaces are floor). The
  // win needs BOTH every '~' covered AND the player on 'x', so the player covers
  // the top & bottom goals, then pushes the middle box aside to clear 'x' and
  // steps onto it. Minimum 7 moves.
  const r = solve("#####\n#@+~#\n# +x#\n# +~#\n#####");
  assert.equal(r.solvable, true);
  assert.equal(r.moves, 7);
  assert.equal((r.winning!.match(/~/g) ?? []).length, 0); // every box goal covered
  assert.equal((r.winning!.match(/\*/g) ?? []).length, 2); // both shown as '*'
  assert.equal((r.winning!.match(/X/g) ?? []).length, 1); // player stands on the goal
  assert.equal((r.winning!.match(/x/g) ?? []).length, 0); // no uncovered player goal
});

test("solve: a grid with no goal is not solvable", () => {
  const r = solve("@..\n...\n...");
  assert.equal(r.solvable, false);
  assert.equal(r.moves, null);
  assert.match(r.reason, /no goal/);
});

test("solve: A* still reports the MINIMUM moves on a multi-box board", () => {
  // Three boxes, three '~' goals: the heuristic guides the search but must not
  // change the optimum. 12 player moves / 7 pushes (verified against the
  // exhaustive uniform-cost search).
  const r = solve("#######\n#@..~.#\n#.+.+.#\n#..+..#\n#~...~#\n#.....#\n#######");
  assert.equal(r.solvable, true);
  assert.equal(r.moves, 12);
  assert.equal(r.pushes, 7);
});

test("solve: a box that can only be shoved into a dead corner is unsolvable", () => {
  // The lone box can only ever be pushed down into the bottom-left corner — a
  // square from which no push can ever reach the goal '~'. Deadlock detection
  // rejects it instead of searching.
  const r = solve("####\n#@.#\n#+.#\n#.~#\n####");
  assert.equal(r.solvable, false);
  assert.equal(r.moves, null);
});
