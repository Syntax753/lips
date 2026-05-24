import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { comparableTool } from "./comparable.js";
import { gridvalidTool } from "./grid.js";

/**
 * Evaluators — boolean predicate tools. `comparable` (can two values be
 * compared?) and `gridvalid` (is an ASCII grid state well-formed?).
 */

export const EVALUATORS_SERVER = "evaluators";
export const COMPARABLE_TOOL = `mcp__${EVALUATORS_SERVER}__comparable`;
export const GRIDVALID_TOOL = `mcp__${EVALUATORS_SERVER}__gridvalid`;

export { comparable } from "./comparable.js";
export { gridValid } from "./grid.js";

export function evaluatorsServer() {
  return createSdkMcpServer({
    name: EVALUATORS_SERVER,
    version: "0.1.0",
    tools: [comparableTool, gridvalidTool],
  });
}
