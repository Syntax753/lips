import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { expand, type NextState } from "../delegator/statemachine.js";

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
};

export function gridValid(grid: string): GridValidResult {
  const rows = grid.replace(/\r/g, "").split("\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  const height = rows.length;
  const width = height > 0 ? rows[0].length : 0;
  const players = (grid.match(/@/g) ?? []).length;

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
  }

  return { ok, reason, width, height, players };
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
  "Check that an ASCII grid state is well-formed (rectangular, exactly one '@'). Returns ok=true/false plus the dimensions.",
  { grid: z.string().describe("the state as an ASCII grid") },
  async (args) => {
    const r = gridValid(args.grid);
    return { content: [{ type: "text", text: String(r.ok) }], structuredContent: r };
  },
);
