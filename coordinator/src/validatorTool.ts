import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { validate } from "./validator.js";

/** Name the in-process validator server is registered under. */
export const VALIDATOR_SERVER_NAME = "validator";

/** Fully-qualified tool name the coordinator addresses. */
export const VALIDATE_TOOL = `mcp__${VALIDATOR_SERVER_NAME}__validate`;

/**
 * An in-process (SDK) MCP server exposing a single `validate` tool. It runs
 * inside the coordinator process and calls the programmatic comparators
 * directly — no subprocess, no model. It is registered only on the coordinator,
 * never on the comparator specialists, so it stays "orchestrator only".
 */
export function validatorServer() {
  return createSdkMcpServer({
    name: VALIDATOR_SERVER_NAME,
    version: "0.1.0",
    tools: [
      tool(
        "validate",
        [
          "Decide which of two values is better. Returns -1 when lhs is better,",
          "+1 when rhs is better, and 0 when they are equal.",
          "Use comparator='numeric' to compare numbers and 'alpha' for alphabetical text.",
          "Use goal='max' when the larger/later value is better, goal='min' when the smaller/earlier value is better.",
        ].join(" "),
        {
          lhs: z.string().describe("the first value"),
          rhs: z.string().describe("the second value"),
          comparator: z.enum(["numeric", "alpha"]).describe("how to compare: numbers or alphabetical text"),
          goal: z.enum(["max", "min"]).describe("which is better: max = larger/later, min = smaller/earlier"),
        },
        async (args) => {
          try {
            const result = validate(args.lhs, args.rhs, args.comparator, args.goal);
            return {
              content: [{ type: "text", text: String(result.verdict) }],
              structuredContent: result,
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
