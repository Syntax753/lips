import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import {
  parseEquation,
  parseExpression,
  substituteExpr,
  isolate,
  formatExpr,
  variablesOf,
} from "../algebra/linear.js";

/**
 * Algebraic reducer: isolate one variable in a linear equation, optionally
 * substituting known relations first. This is the "express equation in terms
 * of variable X" step — it does not produce a number unless every other
 * variable has been substituted away (then `value` is set).
 */

export const REDUCERS_SERVER = "reducers";
export const REDUCE_TOOL = `mcp__${REDUCERS_SERVER}__reduce`;

export type ReduceResult = {
  variable: string;
  expression: string; // the RHS of `variable = expression`
  remainingVariables: string[];
  value: number | null; // set when `expression` is a bare constant
};

export function reduce(
  equation: string,
  isolateVar: string,
  substitutions?: Record<string, string>,
): ReduceResult {
  let residual = parseEquation(equation);
  if (substitutions) {
    for (const [v, exprStr] of Object.entries(substitutions)) {
      residual = substituteExpr(residual, v, parseExpression(exprStr));
    }
  }
  const expr = isolate(residual, isolateVar);
  const remaining = variablesOf(expr);
  return {
    variable: isolateVar,
    expression: formatExpr(expr),
    remainingVariables: remaining,
    value: remaining.length === 0 ? expr.constant : null,
  };
}

export const reduceTool = tool(
  "reduce",
  'Reduce a LINEAR equation by isolating one variable: returns "variable = expression" in terms of the remaining variables. Optionally pass known relations to substitute first (substitutions={"M":"4*T"}). If nothing remains, `value` holds the number.',
  {
    equation: z.string().describe('a linear equation, e.g. "M - 10 = 2*(T - 10)"'),
    isolate: z.string().describe("the variable to isolate"),
    substitutions: z
      .record(z.string(), z.string())
      .optional()
      .describe('relations to substitute first, e.g. {"M":"4*T"}'),
  },
  async (args) => {
    try {
      const r = reduce(args.equation, args.isolate, args.substitutions);
      const text = r.value !== null ? `${r.variable} = ${r.value}` : `${r.variable} = ${r.expression}`;
      return { content: [{ type: "text", text }], structuredContent: r };
    } catch (err) {
      return {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  },
);

export function reducersServer() {
  return createSdkMcpServer({ name: REDUCERS_SERVER, version: "0.1.0", tools: [reduceTool] });
}
