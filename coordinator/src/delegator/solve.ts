import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { expand } from "./statemachine.js";
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
  reason: string;
};

/** Normalise a grid to the form expand() emits, so visited keys match. */
function normalize(grid: string): string {
  const rows = grid.replace(/\r/g, "").split("\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  return rows.join("\n");
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
    reason,
  });

  while (head < queue.length) {
    const current = queue[head++];
    explored++;
    const exp = expand(current, ruleset.name);
    if (!exp.ok) return fail(exp.reason, false);

    // BFS processes by increasing depth, so the first winning move is shortest.
    const win = exp.states.find((s) => s.success);
    if (win) {
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
        reason: "goal reached",
      };
    }

    for (const s of exp.states) {
      if (visited.has(s.grid)) {
        pruned++;
        continue;
      }
      visited.add(s.grid);
      parent.set(s.grid, current);
      queue.push(s.grid);
      pushed++;
    }
  }

  return fail("frontier exhausted — no path to the goal");
}

export const solveTool = tool(
  "solve",
  "Deterministically decide whether the player '@' can reach the goal 'x' in a grid (ruleset default 'sokoban'), and in how many moves. Breadth-first search in code, so `moves` is the MINIMUM. Pruned by a visited set (a state already on the frontier/seen is never reprocessed). Returns { solvable, moves, path (start..win), winning, explored, pushed, pruned }.",
  {
    grid: z.string().describe("the start state as an ASCII grid"),
    ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
  },
  async (args) => {
    const r = solve(args.grid, args.ruleset ?? DEFAULT_RULESET);
    const text = r.solvable
      ? `solvable in ${r.moves} move(s) (explored ${r.explored}, pruned ${r.pruned})`
      : `not solvable — ${r.reason} (explored ${r.explored}, pruned ${r.pruned})`;
    return { content: [{ type: "text", text }], structuredContent: r };
  },
);
