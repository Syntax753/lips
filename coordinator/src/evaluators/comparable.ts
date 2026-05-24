import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

/**
 * Evaluator that judges whether two values can be compared under a given
 * comparator, and — if not — suggests a converter to make them comparable.
 * Like every evaluator, the headline result is a boolean (`ok`).
 */

export const EVALUATORS_SERVER = "evaluators";
export const COMPARABLE_TOOL = `mcp__${EVALUATORS_SERVER}__comparable`;

export type ComparableResult = {
  ok: boolean;
  reason: string;
  suggestion: string | null;
};

function isNumberLike(v: string): boolean {
  return v.trim() !== "" && !Number.isNaN(Number(v));
}

function isOutcomeLike(v: string): boolean {
  try {
    const o = JSON.parse(v) as Record<string, unknown>;
    return (
      typeof o === "object" &&
      o !== null &&
      !Number.isNaN(Number(o.expectedValue)) &&
      !Number.isNaN(Number(o.survivalProbability))
    );
  } catch {
    return false;
  }
}

export function comparable(lhs: string, rhs: string, comparator: string): ComparableResult {
  switch (comparator) {
    case "numeric": {
      const bad = [lhs, rhs].filter((v) => !isNumberLike(v));
      if (bad.length === 0) return { ok: true, reason: "both operands are numeric", suggestion: null };
      return {
        ok: false,
        reason: `not numeric: ${bad.map((v) => `"${v}"`).join(", ")}`,
        suggestion: "convert word-numbers with converters/string2int, or pull a number with converters/json2id, then compare",
      };
    }
    case "alpha":
      return { ok: true, reason: "any strings can be compared alphabetically", suggestion: null };
    case "outcome": {
      const bad = [lhs, rhs].filter((v) => !isOutcomeLike(v));
      if (bad.length === 0) return { ok: true, reason: "both are outcome objects", suggestion: null };
      return {
        ok: false,
        reason: "operands must be JSON objects with numeric expectedValue and survivalProbability",
        suggestion: "build each outcome object first (compute expectedValue via arithmetic)",
      };
    }
    default:
      return { ok: false, reason: `unknown comparator "${comparator}"`, suggestion: null };
  }
}

export const comparableTool = tool(
  "comparable",
  "Check whether two values can be compared under a comparator ('numeric' | 'alpha' | 'outcome'). Returns ok=true/false plus, when false, a suggested converter to make them comparable.",
  {
    lhs: z.string().describe("the first value"),
    rhs: z.string().describe("the second value"),
    comparator: z.enum(["numeric", "alpha", "outcome"]).describe("the comparator you intend to use"),
  },
  async (args) => {
    const r = comparable(args.lhs, args.rhs, args.comparator);
    return { content: [{ type: "text", text: String(r.ok) }], structuredContent: r };
  },
);

export function evaluatorsServer() {
  return createSdkMcpServer({ name: EVALUATORS_SERVER, version: "0.1.0", tools: [comparableTool] });
}
