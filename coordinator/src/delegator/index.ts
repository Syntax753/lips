import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { algebraicTool } from "./algebraic.js";
import { statemachineTool } from "./statemachine.js";
import { solveTool, bestmoveTool, optimizeTool } from "./solve.js";
import { reachableTool } from "./timeline.js";

/**
 * The delegator owns deterministic domain solvers: `algebraic` (linear systems),
 * `statemachine` (enumerate a grid's next states), `solve` (search a grid's state
 * space for the shortest path to the goal), and `reachable` (whether a player can
 * encounter every character across their co-located timelines). New domains add
 * their tools here behind the same server, keeping the orchestration logic out of
 * the coordinator.
 */

export const DELEGATOR_SERVER = "delegator";
export const ALGEBRAIC_TOOL = `mcp__${DELEGATOR_SERVER}__algebraic`;
export const STATEMACHINE_TOOL = `mcp__${DELEGATOR_SERVER}__statemachine`;
export const SOLVE_TOOL = `mcp__${DELEGATOR_SERVER}__solve`;
export const BESTMOVE_TOOL = `mcp__${DELEGATOR_SERVER}__bestmove`;
export const OPTIMIZE_TOOL = `mcp__${DELEGATOR_SERVER}__optimize`;
export const REACHABLE_TOOL = `mcp__${DELEGATOR_SERVER}__reachable`;

export function delegatorServer() {
  return createSdkMcpServer({
    name: DELEGATOR_SERVER,
    version: "0.1.0",
    tools: [algebraicTool, statemachineTool, solveTool, bestmoveTool, optimizeTool, reachableTool],
  });
}
