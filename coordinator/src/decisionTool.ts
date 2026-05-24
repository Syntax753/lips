import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { decide } from "./cmp/decide.js";

/**
 * In-process tool for the "which is better" decision (comparator + goal).
 * Registered on the coordinator only, never on the boolean specialists.
 */

export const DECISION_SERVER = "decision";
export const DECIDE_TOOL = `mcp__${DECISION_SERVER}__decide`;

export const decideTool = tool(
  "decide",
  "Decide which of two values is better. Returns -1 (lhs better), +1 (rhs better), or 0 (equal). comparator='numeric' for numbers, 'alpha' for text, or 'outcome' for JSON objects {expectedValue, survivalProbability} (survival ranked first). goal='max' (larger/later/better is better) or 'min' (smaller/earlier is better).",
  {
    lhs: z.string().describe("the first value (a JSON object for the 'outcome' comparator)"),
    rhs: z.string().describe("the second value (a JSON object for the 'outcome' comparator)"),
    comparator: z.enum(["numeric", "alpha", "outcome"]).describe("numbers, alphabetical text, or outcome objects"),
    goal: z.enum(["max", "min"]).describe("max = larger/later/better wins, min = smaller/earlier wins"),
  },
  async (args) => {
    try {
      const r = decide(args.lhs, args.rhs, args.comparator, args.goal);
      return { content: [{ type: "text", text: String(r.verdict) }], structuredContent: r };
    } catch (err) {
      return {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  },
);

export function decisionServer() {
  return createSdkMcpServer({ name: DECISION_SERVER, version: "0.1.0", tools: [decideTool] });
}
