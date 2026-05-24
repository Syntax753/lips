import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { algebraicTool } from "./algebraic.js";

/**
 * The delegator owns domain handlers (reducers / evaluators / comparators).
 * Today it carries one domain — algebraic — exposed as a single deterministic
 * tool. New domains (non-algebraic) add their own tools here behind the same
 * server, keeping the orchestration logic out of the coordinator.
 */

export const DELEGATOR_SERVER = "delegator";
export const ALGEBRAIC_TOOL = `mcp__${DELEGATOR_SERVER}__algebraic`;

export function delegatorServer() {
  return createSdkMcpServer({
    name: DELEGATOR_SERVER,
    version: "0.1.0",
    tools: [algebraicTool],
  });
}
