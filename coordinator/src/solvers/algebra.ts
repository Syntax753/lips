import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { parseEquation, substituteValue, solveSingle } from "../algebra/linear.js";

/**
 * Algebraic solver: solve a LINEAR equation for a single unknown. Any other
 * variables must be supplied as numbers in `knowns`; after substitution the
 * equation must reduce to one unknown, which is then solved.
 */

export const SOLVERS_SERVER = "solvers";
export const SOLVE_TOOL = `mcp__${SOLVERS_SERVER}__solve`;

export type SolveResult = { variable: string; value: number };

export function solve(
  equation: string,
  variable: string,
  knowns?: Record<string, number>,
): SolveResult {
  let residual = parseEquation(equation);
  if (knowns) {
    for (const [v, val] of Object.entries(knowns)) residual = substituteValue(residual, v, val);
  }
  return solveSingle(residual, variable);
}

export const solveTool = tool(
  "solve",
  'Solve a LINEAR equation for one unknown. Supply every other variable as a number in `knowns`; after substitution the equation must have a single unknown. Returns its numeric value. e.g. solve("M = 4*T", "M", {"T":-5}) -> -20.',
  {
    equation: z.string().describe('a linear equation, e.g. "2*T + 10 = 0"'),
    variable: z.string().describe("the unknown to solve for"),
    knowns: z
      .record(z.string(), z.number())
      .optional()
      .describe('known numeric values to substitute first, e.g. {"T":-5}'),
  },
  async (args) => {
    try {
      const r = solve(args.equation, args.variable, args.knowns);
      return { content: [{ type: "text", text: `${r.variable} = ${r.value}` }], structuredContent: r };
    } catch (err) {
      return {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  },
);

export function solversServer() {
  return createSdkMcpServer({ name: SOLVERS_SERVER, version: "0.1.0", tools: [solveTool] });
}
