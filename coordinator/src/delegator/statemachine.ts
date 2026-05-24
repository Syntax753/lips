import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { getRuleSet, DEFAULT_RULESET } from "../rules/index.js";

/**
 * State-machine delegator: given a game state as an ASCII grid and a ruleset,
 * deterministically enumerate ALL legal next states (one per applicable move).
 * For the default `sokoban` ruleset (no boxes), the only rule is `@ MOV .`, so
 * each `@` produces one next state per adjacent `.` it can step onto.
 */

export type ExpandResult = {
  ok: boolean;
  ruleset: string;
  count: number;
  states: string[];
  reason: string;
};

/** Split an ASCII grid into rows, validating it is a rectangle. */
function parseGrid(grid: string): string[] {
  const rows = grid.replace(/\r/g, "").split("\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  if (rows.length === 0) throw new Error("empty grid");
  const width = rows[0].length;
  if (!rows.every((r) => r.length === width)) throw new Error("grid rows must all be the same width");
  return rows;
}

// Orthogonal neighbours in the order up, left, right, down.
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
    return { ok: false, ruleset: ruleset.name, count: 0, states: [], reason: (err as Error).message };
  }

  const height = rows.length;
  const width = rows[0].length;
  const states: string[] = [];

  for (const rule of ruleset.rules) {
    // MOV: the subject glyph steps onto an adjacent object-glyph tile, leaving
    // the object glyph (the floor it moves over) behind in its old cell.
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (rows[r][c] !== rule.subject) continue;
        for (const [dr, dc] of DIRECTIONS) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
          if (rows[nr][nc] !== rule.object) continue;
          const next = rows.map((row) => row.split(""));
          next[r][c] = rule.object;
          next[nr][nc] = rule.subject;
          states.push(next.map((row) => row.join("")).join("\n"));
        }
      }
    }
  }

  return {
    ok: true,
    ruleset: ruleset.name,
    count: states.length,
    states,
    reason: `${states.length} possible next state(s)`,
  };
}

export const statemachineTool = tool(
  "statemachine",
  "Given a game state as an ASCII grid (rows separated by newlines) and a ruleset (default 'sokoban'), return ALL possible next states — one per legal move. Each state is an ASCII grid string.",
  {
    grid: z.string().describe("the current state as an ASCII grid"),
    ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
  },
  async (args) => {
    const result = expand(args.grid, args.ruleset ?? DEFAULT_RULESET);
    const text = result.ok
      ? `${result.count} next state(s):\n\n${result.states.join("\n\n")}`
      : `invalid state: ${result.reason}`;
    return { content: [{ type: "text", text }], structuredContent: result };
  },
);
