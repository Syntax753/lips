import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { expand, goalMet, type NextState } from "../delegator/statemachine.js";

/**
 * Evaluator that checks an ASCII grid state is well-formed for the (no-boxes)
 * sokoban ruleset: rectangular, and exactly one player `@`.
 */

export type GridValidResult = {
  ok: boolean;
  reason: string;
  width: number;
  height: number;
  players: number;
  /** Box goals present (empty `~` plus covered `*`). */
  boxGoals: number;
  /** Boxes present (on floor `+` plus on a goal `*`). */
  boxes: number;
};

export function gridValid(grid: string): GridValidResult {
  const rows = grid.replace(/\r/g, "").split("\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  const height = rows.length;
  const width = height > 0 ? rows[0].length : 0;
  const players = (grid.match(/@/g) ?? []).length;
  const count = (glyph: string): number => grid.split(glyph).length - 1;
  const boxGoals = count("~") + count("*"); // empty + covered goals
  const boxes = count("+") + count("*"); // boxes on floor + on goals

  let ok = true;
  let reason = "well-formed grid";
  if (height === 0) {
    ok = false;
    reason = "empty grid";
  } else if (!rows.every((r) => r.length === width)) {
    ok = false;
    reason = "rows are not all the same width";
  } else if (players !== 1) {
    ok = false;
    reason = `expected exactly one '@', found ${players}`;
  } else if (boxGoals > boxes) {
    // Preflight: every box goal must be coverable by a box.
    ok = false;
    reason = `${boxGoals} box goal(s) but only ${boxes} box(es) to cover them`;
  }

  return { ok, reason, width, height, players, boxGoals, boxes };
}

export type MoveEval = {
  ok: boolean;
  ruleset: string;
  candidates: NextState[]; // EVERY legal next state — one per possible move/tile
  fresh: NextState[]; // candidates not yet in the queue or processed — to enqueue
  seen: NextState[]; // candidates already queued/processed — skip
  success: boolean; // a candidate lands the player on the goal
  reason: string;
};

/**
 * Grid-move evaluator for the search frontier. Enumerates EVERY possible next
 * tile (all legal moves under the ruleset), then partitions them into `fresh`
 * (states not yet in the queue or processed — these must be added to the queue)
 * and `seen` (already queued/processed — skipped). `isSeen` reports whether a
 * state is already on the frontier or has been processed in the past.
 */
export function evaluateMoves(
  grid: string,
  isSeen: (state: string) => boolean,
  rulesetName?: string,
): MoveEval {
  const exp = expand(grid, rulesetName);
  if (!exp.ok) {
    return { ok: false, ruleset: exp.ruleset, candidates: [], fresh: [], seen: [], success: false, reason: exp.reason };
  }
  const fresh: NextState[] = [];
  const seen: NextState[] = [];
  for (const s of exp.states) (isSeen(s.grid) ? seen : fresh).push(s);
  return {
    ok: true,
    ruleset: exp.ruleset,
    candidates: exp.states,
    fresh,
    seen,
    success: exp.success,
    reason: `${exp.states.length} possible move(s): ${fresh.length} new, ${seen.length} already seen`,
  };
}

export const gridvalidTool = tool(
  "gridvalid",
  "Check that an ASCII grid state is well-formed (rectangular, exactly one '@'). Floor '.', goal 'x', wall '#', box '+', box goal '~' and box-on-goal '*' are all valid cells. Preflight: there must be at least as many boxes as box goals, or it cannot be solved. Returns ok=true/false plus the dimensions, boxGoals and boxes counts.",
  { grid: z.string().describe("the state as an ASCII grid") },
  async (args) => {
    const r = gridValid(args.grid);
    return { content: [{ type: "text", text: String(r.ok) }], structuredContent: r };
  },
);

export const goalmetTool = tool(
  "goalmet",
  "Postflight win check for a grid (ruleset default 'sokoban'): returns true when the WIN condition is met — every box goal '~' is covered by a box AND (if the grid has a player goal) the player is standing on 'x' (shown as 'X'). A grid with no goals returns false. This is the decision point for whether the puzzle is solved.",
  {
    grid: z.string().describe("the current state as an ASCII grid"),
    ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
  },
  async (args) => {
    const r = goalMet(args.grid, args.ruleset);
    return { content: [{ type: "text", text: String(r.met) }], structuredContent: r };
  },
);
