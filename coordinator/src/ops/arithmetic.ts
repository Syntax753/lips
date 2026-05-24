import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

/**
 * Arithmetic operators — binary, type-specialised (like comparators). For now
 * only "numeric"; other data structures can define their own meaning for these
 * operations later (matrices, sets, repeated strings, ...).
 *
 * Outcomes (e.g. an expected value) are computed by chaining these, then
 * compared with the `decide` tool — there is no separate "outcome comparator".
 */

export const OPS_SERVER = "arithmetic";

export type ArithType = "numeric";

const NUMERIC_OPS = {
  multiply: (a: number, b: number) => a * b,
  add: (a: number, b: number) => a + b,
  subtract: (a: number, b: number) => a - b,
  divide: (a: number, b: number) => {
    if (b === 0) throw new Error("division by zero");
    return a / b;
  },
} as const;

export type ArithOp = keyof typeof NUMERIC_OPS;

export type ArithResult = {
  op: ArithOp;
  type: ArithType;
  lhs: string;
  rhs: string;
  result: string;
};

export function calc(op: ArithOp, lhs: string, rhs: string, type: ArithType = "numeric"): ArithResult {
  if (type !== "numeric") throw new Error(`unsupported arithmetic type: ${type}`);
  const a = Number(lhs);
  const b = Number(rhs);
  if (Number.isNaN(a)) throw new Error(`${op}: "${lhs}" is not a number`);
  if (Number.isNaN(b)) throw new Error(`${op}: "${rhs}" is not a number`);
  return { op, type, lhs, rhs, result: String(NUMERIC_OPS[op](a, b)) };
}

/** Convenience kept for callers/tests that want multiplication directly. */
export const multiply = (lhs: string, rhs: string, type: ArithType = "numeric") =>
  calc("multiply", lhs, rhs, type);

const DESCRIPTIONS: Record<ArithOp, string> = {
  multiply: "Multiply two values (a * b).",
  add: "Add two values (a + b).",
  subtract: "Subtract the second value from the first (a - b).",
  divide: "Divide the first value by the second (a / b).",
};

function arithmeticTool(op: ArithOp) {
  return tool(
    op,
    `${DESCRIPTIONS[op]} type='numeric' for numbers (other types may define their own meaning). For longer formulas, chain calls — feed each result into the next. Returns the result.`,
    {
      lhs: z.string().describe("the first operand"),
      rhs: z.string().describe("the second operand"),
      type: z.enum(["numeric"]).optional().describe("how to combine (default: numeric)"),
    },
    async (args) => {
      try {
        const r = calc(op, args.lhs, args.rhs, args.type ?? "numeric");
        return { content: [{ type: "text", text: r.result }], structuredContent: r };
      } catch (err) {
        return {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
    },
  );
}

export const ARITH_OPS: ArithOp[] = ["multiply", "add", "subtract", "divide"];

export function arithmeticToolName(op: ArithOp): string {
  return `mcp__${OPS_SERVER}__${op}`;
}

export const MULTIPLY_TOOL = arithmeticToolName("multiply");
export const ARITHMETIC_TOOLS = ARITH_OPS.map(arithmeticToolName);

export function arithmeticServer() {
  return createSdkMcpServer({ name: OPS_SERVER, version: "0.1.0", tools: ARITH_OPS.map(arithmeticTool) });
}
