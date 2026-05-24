import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";

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

export const gridvalidTool = tool(
  "gridvalid",
  "Check that an ASCII grid state is well-formed (rectangular, exactly one '@'). Returns ok=true/false plus the dimensions.",
  { grid: z.string().describe("the state as an ASCII grid") },
  async (args) => {
    const r = gridValid(args.grid);
    return { content: [{ type: "text", text: String(r.ok) }], structuredContent: r };
  },
);
