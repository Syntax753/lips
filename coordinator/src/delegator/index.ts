import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { algebraicTool } from "./algebraic.js";
import { statemachineTool } from "./statemachine.js";

/**
 * The delegator owns deterministic domain solvers. Today: `algebraic` (linear
 * systems) and `statemachine` (enumerate next states of a grid given a
 * ruleset). New domains add their tools here behind the same server, keeping
 * the orchestration logic out of the coordinator.
 */

export const DELEGATOR_SERVER = "delegator";
export const ALGEBRAIC_TOOL = `mcp__${DELEGATOR_SERVER}__algebraic`;
export const STATEMACHINE_TOOL = `mcp__${DELEGATOR_SERVER}__statemachine`;

export function delegatorServer() {
  return createSdkMcpServer({
    name: DELEGATOR_SERVER,
    version: "0.1.0",
    tools: [algebraicTool, statemachineTool],
  });
}
