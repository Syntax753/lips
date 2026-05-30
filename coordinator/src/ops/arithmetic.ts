import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

/**
 * Arithmetic operators — type-specialised (like comparators). For now only
 * "numeric"; other data structures can define their own meaning for these
 * operations later (matrices, sets, repeated strings, ...).
 *
 * Binary ops take two operands (lhs, rhs); unary ops take one (value). Outcomes
 * (e.g. an expected value) are computed by chaining these, then compared with the
 * `decide` tool — there is no separate "outcome comparator".
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
  power: (a: number, b: number) => Math.pow(a, b),
} as const;

const UNARY_OPS = {
  negate: (a: number) => -a,
  sqrt: (a: number) => {
    if (a < 0) throw new Error("sqrt: cannot take the real square root of a negative number");
    return Math.sqrt(a);
  },
} as const;

export type ArithOp = keyof typeof NUMERIC_OPS;
export type UnaryOp = keyof typeof UNARY_OPS;

export type ArithResult = {
  op: ArithOp;
  type: ArithType;
  lhs: string;
  rhs: string;
  result: string;
};

export type UnaryResult = {
  op: UnaryOp;
  type: ArithType;
  value: string;
  result: string;
};

const finite = (op: string, r: number): number => {
  if (!Number.isFinite(r)) throw new Error(`${op}: result is not a finite number`);
  return r;
};

export function calc(op: ArithOp, lhs: string, rhs: string, type: ArithType = "numeric"): ArithResult {
  if (type !== "numeric") throw new Error(`unsupported arithmetic type: ${type}`);
  const a = Number(lhs);
  const b = Number(rhs);
  if (Number.isNaN(a)) throw new Error(`${op}: "${lhs}" is not a number`);
  if (Number.isNaN(b)) throw new Error(`${op}: "${rhs}" is not a number`);
  return { op, type, lhs, rhs, result: String(finite(op, NUMERIC_OPS[op](a, b))) };
}

export function calcUnary(op: UnaryOp, value: string, type: ArithType = "numeric"): UnaryResult {
  if (type !== "numeric") throw new Error(`unsupported arithmetic type: ${type}`);
  const a = Number(value);
  if (Number.isNaN(a)) throw new Error(`${op}: "${value}" is not a number`);
  return { op, type, value, result: String(finite(op, UNARY_OPS[op](a))) };
}

/** Convenience kept for callers/tests that want multiplication directly. */
export const multiply = (lhs: string, rhs: string, type: ArithType = "numeric") =>
  calc("multiply", lhs, rhs, type);

const DESCRIPTIONS: Record<ArithOp, string> = {
  multiply: "Multiply two values (a * b).",
  add: "Add two values (a + b).",
  subtract: "Subtract the second value from the first (a - b).",
  divide: "Divide the first value by the second (a / b).",
  power: "Raise the first value to the power of the second (a ^ b); use exponent 0.5 for a square root.",
};

const UNARY_DESCRIPTIONS: Record<UnaryOp, string> = {
  negate: "Negate a value (-a).",
  sqrt: "Square root of a value (√a); errors on a negative operand (no real root).",
};

function binaryTool(op: ArithOp) {
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

function unaryTool(op: UnaryOp) {
  return tool(
    op,
    `${UNARY_DESCRIPTIONS[op]} type='numeric'. Takes ONE operand. Returns the result.`,
    {
      value: z.string().describe("the operand"),
      type: z.enum(["numeric"]).optional().describe("how to interpret (default: numeric)"),
    },
    async (args) => {
      try {
        const r = calcUnary(op, args.value, args.type ?? "numeric");
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

export const ARITH_OPS: ArithOp[] = ["multiply", "add", "subtract", "divide", "power"];
export const UNARY_OPS_LIST: UnaryOp[] = ["negate", "sqrt"];

export function arithmeticToolName(op: ArithOp | UnaryOp): string {
  return `mcp__${OPS_SERVER}__${op}`;
}

export const MULTIPLY_TOOL = arithmeticToolName("multiply");
export const ARITHMETIC_TOOLS = [...ARITH_OPS, ...UNARY_OPS_LIST].map(arithmeticToolName);

export function arithmeticServer() {
  return createSdkMcpServer({
    name: OPS_SERVER,
    version: "0.1.0",
    tools: [...ARITH_OPS.map(binaryTool), ...UNARY_OPS_LIST.map(unaryTool)],
  });
}
