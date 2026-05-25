import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { getRuleSet, DEFAULT_RULESET } from "../rules/index.js";

/**
 * State-machine delegator: given a game state as an ASCII grid and a ruleset,
 * deterministically enumerate ALL legal next states. Each next state is scored
 * by proximity of the player to the goal (lower = closer) and flagged `success`
 * when the move lands the player on the goal glyph.
 */

export type NextState = {
  grid: string;
  /** True when this move landed the player on the goal. */
  success: boolean;
  /** Manhattan distance from the player to the goal in this state (0 on win,
   *  null when there is no goal to measure against). Lower is closer. */
  score: number | null;
};

export type ExpandResult = {
  ok: boolean;
  ruleset: string;
  count: number;
  success: boolean; // any next state is a win
  states: NextState[];
  reason: string;
};

function parseGrid(grid: string): string[] {
  const rows = grid.replace(/\r/g, "").split("\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  if (rows.length === 0) throw new Error("empty grid");
  const width = rows[0].length;
  if (!rows.every((r) => r.length === width)) throw new Error("grid rows must all be the same width");
  return rows;
}

function findGlyph(rows: string[], glyph: string): [number, number] | null {
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].indexOf(glyph);
    if (c >= 0) return [r, c];
  }
  return null;
}

/** Manhattan distance between two glyphs in a grid, or null if either is absent. */
function distance(gridStr: string, a: string, b: string): number | null {
  const rows = gridStr.split("\n");
  const pa = findGlyph(rows, a);
  const pb = findGlyph(rows, b);
  if (!pa || !pb) return null;
  return Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]);
}

// Orthogonal neighbours: up, left, right, down.
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, 0],
];

export function expand(grid: string, rulesetName: string = DEFAULT_RULESET): ExpandResult {
  const ruleset = getRuleSet(rulesetName);
  let rows: string[];
  try {
    rows = parseGrid(grid);
  } catch (err) {
    return { ok: false, ruleset: ruleset.name, count: 0, success: false, states: [], reason: (err as Error).message };
  }

  const height = rows.length;
  const width = rows[0].length;
  const states: NextState[] = [];
  const inBounds = (rr: number, cc: number): boolean => rr >= 0 && rr < height && cc >= 0 && cc < width;

  // Glyphs each subject may step directly onto (floor / goal), keyed by subject.
  const targetsBySubject = new Map<string, Set<string>>();
  for (const rule of ruleset.rules) {
    let set = targetsBySubject.get(rule.subject);
    if (!set) targetsBySubject.set(rule.subject, (set = new Set()));
    set.add(rule.object);
  }

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const subject = rows[r][c];
      const moveTargets = targetsBySubject.get(subject);
      if (!moveTargets) continue; // this cell is not a movable subject

      for (const [dr, dc] of DIRECTIONS) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        const target = rows[nr][nc];

        // Walls are impassable — the subject may never move onto one.
        if (ruleset.wall && target === ruleset.wall) continue;

        // Box: moving onto it is legal ONLY if it can be pushed. The tile one
        // step further in the same direction must be empty floor; the box slides
        // there and the subject takes the box's old square.
        if (ruleset.box && target === ruleset.box) {
          const fr = nr + dr;
          const fc = nc + dc;
          if (!inBounds(fr, fc)) continue; // nothing beyond the box to push into
          if (rows[fr][fc] !== ruleset.floor) continue; // far side is not empty floor
          const next = rows.map((row) => row.split(""));
          next[r][c] = ruleset.floor; // subject leaves floor behind
          next[nr][nc] = subject; // subject moves onto the box's old square
          next[fr][fc] = ruleset.box; // box pushed one step further
          const grid2 = next.map((row) => row.join("")).join("\n");
          // A push lands the subject where the box was, never on the goal.
          states.push({ grid: grid2, success: false, score: distance(grid2, subject, ruleset.goal) });
          continue;
        }

        // Plain move onto a floor / goal tile.
        if (moveTargets.has(target)) {
          const next = rows.map((row) => row.split(""));
          next[r][c] = ruleset.floor; // subject leaves floor behind
          next[nr][nc] = subject;
          const grid2 = next.map((row) => row.join("")).join("\n");
          const success = target === ruleset.goal; // landed on the goal
          states.push({ grid: grid2, success, score: success ? 0 : distance(grid2, subject, ruleset.goal) });
        }
      }
    }
  }

  const success = states.some((s) => s.success);
  return {
    ok: true,
    ruleset: ruleset.name,
    count: states.length,
    success,
    states,
    reason: success ? "a move reaches the goal" : `${states.length} next state(s)`,
  };
}

export const statemachineTool = tool(
  "statemachine",
  "Given a game state as an ASCII grid and a ruleset (default 'sokoban'), return ALL legal next states. The player '@' moves orthogonally onto floor '.' or goal 'x'; walls '#' are impassable; a box '+' may be pushed only when the tile beyond it (away from the player) is empty floor '.' (the box slides there, the player takes its square). Each has `grid`, `success` (true if it lands the player on the goal 'x'), and `score` (Manhattan distance of the player to the goal; lower = closer). `success` at top level is true if any next state wins.",
  {
    grid: z.string().describe("the current state as an ASCII grid"),
    ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
  },
  async (args) => {
    const result = expand(args.grid, args.ruleset ?? DEFAULT_RULESET);
    const text = result.ok
      ? `${result.count} next state(s)${result.success ? " — one WINS" : ""}`
      : `invalid state: ${result.reason}`;
    return { content: [{ type: "text", text }], structuredContent: result };
  },
);
