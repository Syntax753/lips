import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

/**
 * Arithmetic operators — binary, type-specialised (like comparators). For now
 * only `multiply` over numbers; other data structures can define their own
 * notion of a product later (matrices, sets, repeated strings, ...).
 */

export const OPS_SERVER = "arithmetic";
export const MULTIPLY_TOOL = `mcp__${OPS_SERVER}__multiply`;

/** Extensible: add "matrix", "set", ... as more product meanings are needed. */
export type MultiplyType = "numeric";

export type MultiplyResult = {
  type: MultiplyType;
  lhs: string;
  rhs: string;
  product: string;
};

export function multiply(lhs: string, rhs: string, type: MultiplyType = "numeric"): MultiplyResult {
  if (type === "numeric") {
    const a = Number(lhs);
    const b = Number(rhs);
    if (Number.isNaN(a)) throw new Error(`numeric multiply: "${lhs}" is not a number`);
    if (Number.isNaN(b)) throw new Error(`numeric multiply: "${rhs}" is not a number`);
    return { type, lhs, rhs, product: String(a * b) };
  }
  throw new Error(`unsupported multiply type: ${type}`);
}

export const multiplyTool = tool(
  "multiply",
  "Multiply two values and return the product. type='numeric' multiplies numbers (other types may define their own product). For more than two factors, chain calls: multiply the first two, then multiply that product by the next.",
  {
    lhs: z.string().describe("the first operand"),
    rhs: z.string().describe("the second operand"),
    type: z.enum(["numeric"]).optional().describe("how to multiply (default: numeric)"),
  },
  async (args) => {
    try {
      const r = multiply(args.lhs, args.rhs, args.type ?? "numeric");
      return { content: [{ type: "text", text: r.product }], structuredContent: r };
    } catch (err) {
      return {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  },
);

export function arithmeticServer() {
  return createSdkMcpServer({ name: OPS_SERVER, version: "0.1.0", tools: [multiplyTool] });
}
