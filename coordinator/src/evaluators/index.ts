import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { comparableTool } from "./comparable.js";
import { gridvalidTool, goalmetTool } from "./grid.js";

/**
 * Evaluators — boolean predicate tools. `comparable` (can two values be
 * compared?), `gridvalid` (is an ASCII grid state well-formed?), and `goalmet`
 * (is the win condition satisfied for a grid?).
 */

export const EVALUATORS_SERVER = "evaluators";
export const COMPARABLE_TOOL = `mcp__${EVALUATORS_SERVER}__comparable`;
export const GRIDVALID_TOOL = `mcp__${EVALUATORS_SERVER}__gridvalid`;
export const GOALMET_TOOL = `mcp__${EVALUATORS_SERVER}__goalmet`;

export { comparable } from "./comparable.js";
export { gridValid } from "./grid.js";
export { goalMet } from "../delegator/statemachine.js";

export function evaluatorsServer() {
  return createSdkMcpServer({
    name: EVALUATORS_SERVER,
    version: "0.1.0",
    tools: [comparableTool, gridvalidTool, goalmetTool],
  });
}
