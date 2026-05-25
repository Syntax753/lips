import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { evaluateMoves } from "../evaluators/grid.js";
import { getRuleSet, DEFAULT_RULESET } from "../rules/index.js";

/**
 * Deterministic resolver. Searches a grid's state space in code to decide
 * whether the player can reach the goal under the ruleset, and in how many
 * moves. It is a breadth-first search, so the first time it reaches the goal is
 * the SHORTEST solution — the move count is the true minimum. Pruning via a
 * visited Set means a state already on the frontier (or seen) is never
 * re-queued or re-processed, keeping the search exhaustive, terminating, and
 * fast as new grid elements/interactions are added.
 */

/** What happened to one candidate next tile when a state was expanded. */
export type MoveDisposition = {
  grid: string; // the next state, rows joined with " / "
  status: "queued" | "seen" | "goal"; // added to queue / already seen / wins
};

/** One iteration of the search loop: a state popped off the frontier. */
export type SearchStep = {
  step: number; // pop order (1-based)
  grid: string; // the dequeued state, rows joined with " / "
  depth: number; // moves from the start
  moves: MoveDisposition[]; // EVERY possible next tile and what happened to it
  goal: boolean; // this pop produced the winning move
};

export type SolveResult = {
  ok: boolean;
  solvable: boolean;
  ruleset: string;
  moves: number | null; // minimum moves to reach the goal (null if unsolvable)
  explored: number; // states dequeued and expanded
  pushed: number; // states added to the frontier
  pruned: number; // states skipped because already seen
  path: string[] | null; // start .. winning grid
  winning: string | null;
  trace: SearchStep[]; // the queue pops, in order — the search made visible
  reason: string;
};

/** Normalise a grid to the form expand() emits, so visited keys match. */
function normalize(grid: string): string {
  const rows = grid.replace(/\r/g, "").split("\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  return rows.join("\n");
}

/** Collapse a grid's rows onto one line so a pop fits a single trace line. */
function compact(grid: string): string {
  return grid.split("\n").join(" / ");
}

function reconstruct(parent: Map<string, string | null>, node: string): string[] {
  const path: string[] = [];
  let cur: string | null = node;
  while (cur !== null) {
    path.push(cur);
    cur = parent.get(cur) ?? null;
  }
  return path.reverse();
}

export function solve(grid: string, rulesetName: string = DEFAULT_RULESET): SolveResult {
  const ruleset = getRuleSet(rulesetName);
  const start = normalize(grid);

  const queue: string[] = [start]; // BFS frontier (head index avoids O(n) shifts)
  let head = 0;
  const visited = new Set<string>([start]);
  const parent = new Map<string, string | null>([[start, null]]);
  const depthOf = new Map<string, number>([[start, 0]]);
  const trace: SearchStep[] = [];
  let explored = 0;
  let pushed = 1;
  let pruned = 0;

  const fail = (reason: string, ok = true): SolveResult => ({
    ok,
    solvable: false,
    ruleset: ruleset.name,
    moves: null,
    explored,
    pushed,
    pruned,
    path: null,
    winning: null,
    trace,
    reason,
  });

  // Keep popping the frontier until the goal is reached or the queue drains.
  while (head < queue.length) {
    const current = queue[head++];
    explored++;
    const depth = depthOf.get(current) ?? 0;

    // The grid evaluator enumerates EVERY possible next tile, then tells us which
    // are not yet in the queue or processed (`fresh`) versus already seen.
    const ev = evaluateMoves(current, (s) => visited.has(s), ruleset.name);
    if (!ev.ok) return fail(ev.reason, false);

    // BFS processes by increasing depth, so the first winning move is shortest.
    const win = ev.candidates.find((s) => s.success);
    if (win) {
      trace.push({
        step: explored,
        grid: compact(current),
        depth,
        goal: true,
        moves: ev.candidates.map((s) => ({
          grid: compact(s.grid),
          status: s.success ? "goal" : visited.has(s.grid) ? "seen" : "queued",
        })),
      });
      const path = reconstruct(parent, current).concat(win.grid);
      return {
        ok: true,
        solvable: true,
        ruleset: ruleset.name,
        moves: path.length - 1,
        explored,
        pushed,
        pruned,
        path,
        winning: win.grid,
        trace,
        reason: "goal reached",
      };
    }

    // Add every fresh next tile to the queue; skip (prune) the already-seen ones.
    for (const s of ev.fresh) {
      visited.add(s.grid);
      parent.set(s.grid, current);
      depthOf.set(s.grid, depth + 1);
      queue.push(s.grid);
      pushed++;
    }
    pruned += ev.seen.length;
    trace.push({
      step: explored,
      grid: compact(current),
      depth,
      goal: false,
      moves: [
        ...ev.fresh.map((s) => ({ grid: compact(s.grid), status: "queued" as const })),
        ...ev.seen.map((s) => ({ grid: compact(s.grid), status: "seen" as const })),
      ],
    });
  }

  return fail("frontier exhausted — no path to the goal");
}

export type BestMoveResult = {
  ok: boolean;
  solvable: boolean;
  ruleset: string;
  move: string | null; // the grid AFTER the best move (null if unsolvable)
  reachedGoal: boolean; // this move lands the player on the goal
  movesRemaining: number; // optimal moves from the INPUT grid to the goal
  reason: string;
};

/**
 * The single BEST next move from a grid: the first step of the shortest path to
 * the goal. Re-apply it to the returned grid to play out the optimal sequence.
 */
export function bestMove(grid: string, rulesetName: string = DEFAULT_RULESET): BestMoveResult {
  const s = solve(grid, rulesetName);
  if (!s.ok) {
    return { ok: false, solvable: false, ruleset: s.ruleset, move: null, reachedGoal: false, movesRemaining: 0, reason: s.reason };
  }
  if (!s.solvable || !s.path || s.path.length < 2) {
    return {
      ok: true,
      solvable: false,
      ruleset: s.ruleset,
      move: null,
      reachedGoal: false,
      movesRemaining: 0,
      reason: s.solvable ? "already at the goal — no move needed" : s.reason,
    };
  }
  return {
    ok: true,
    solvable: true,
    ruleset: s.ruleset,
    move: s.path[1],
    reachedGoal: s.path.length === 2, // a single move reaches the goal
    movesRemaining: s.moves ?? 0,
    reason: "optimal next move",
  };
}

export const bestmoveTool = tool(
  "bestmove",
  "Return the single BEST next move toward the goal for a grid (the first step of the shortest solution): the resulting grid, whether that move reaches the goal, and how many optimal moves remain. Re-apply it to the returned grid to play out the optimal sequence.",
  {
    grid: z.string().describe("the current state as an ASCII grid"),
    ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
  },
  async (args) => {
    const r = bestMove(args.grid, args.ruleset ?? DEFAULT_RULESET);
    const text = !r.solvable
      ? `no best move — ${r.reason}`
      : `${r.reachedGoal ? "winning move" : "best move"} (${r.movesRemaining} move(s) to goal):\n${r.move}`;
    return { content: [{ type: "text", text }], structuredContent: r };
  },
);

export const solveTool = tool(
  "solve",
  "Deterministically decide whether the player '@' can reach the goal 'x' in a grid (ruleset default 'sokoban'), and in how many moves. Breadth-first search in code, so `moves` is the MINIMUM. Pruned by a visited set (a state already on the frontier/seen is never reprocessed). Returns { solvable, moves, path (start..win), winning, explored, pushed, pruned }.",
  {
    grid: z.string().describe("the start state as an ASCII grid"),
    ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
  },
  async (args) => {
    const r = solve(args.grid, args.ruleset ?? DEFAULT_RULESET);
    const path = r.path ? r.path.map(compact) : [];
    const text = r.solvable
      ? `solvable in ${r.moves} move(s) (popped ${r.explored} off the queue, pruned ${r.pruned}); optimal path: ${path.join("  =>  ")}`
      : `not solvable — ${r.reason} (popped ${r.explored} off the queue, pruned ${r.pruned})`;
    return { content: [{ type: "text", text }], structuredContent: r };
  },
);
