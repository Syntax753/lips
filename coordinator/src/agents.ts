import type { AgentDefinition, McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { serverBinary, model } from "./config.js";
import { OPERATORS } from "./parser.js";

/** Name the Go MCP server is registered under; tools are mcp__<this>__<tool>. */
export const MCP_SERVER_NAME = "comparators";

/** The fully-qualified tool name as seen by the agent runtime. */
export function toolName(canonical: string): string {
  return `mcp__${MCP_SERVER_NAME}__${canonical}`;
}

/** Register the Go comparator server as a stdio MCP server. */
export function mcpServers(): Record<string, McpServerConfig> {
  return {
    [MCP_SERVER_NAME]: { type: "stdio", command: serverBinary, args: [] },
  };
}

/** Subagent id for a given comparator (e.g. "gt" -> "gt-specialist"). */
export function specialistId(canonical: string): string {
  return `${canonical}-specialist`;
}

/**
 * One short-lived specialist per comparator. Each is restricted (via `tools`)
 * to exactly its own MCP tool, so it can do nothing but evaluate that single
 * operator. The Task tool spawns a fresh instance on demand and discards it
 * once it returns — the "distributed worker" of the design.
 */
export function specialistAgents(): Record<string, AgentDefinition> {
  const agents: Record<string, AgentDefinition> = {};

  for (const op of OPERATORS) {
    const tool = toolName(op.canonical);
    agents[specialistId(op.canonical)] = {
      description: `Evaluates ${op.label} (${op.keyword}) comparisons of two numbers. Use for: ${[...op.synonyms, ...op.forms].join(", ")}.`,
      prompt: [
        `You are the ${op.label.toUpperCase()} (${op.keyword}) specialist.`,
        `You will be given two numeric operands, lhs and rhs.`,
        `Call the \`${tool}\` tool exactly once with {"lhs": <number>, "rhs": <number>}.`,
        `Do NOT compute the comparison yourself — trust the tool's result.`,
        `Reply with ONLY the lowercase word it yields: \`true\` or \`false\`. No other text.`,
      ].join(" "),
      tools: [tool],
      model,
      // A specialist needs at most: one tool call + one summarising turn.
      maxTurns: 3,
    };
  }

  return agents;
}

/**
 * System prompt for the coordinator (main agent). It must not compute anything
 * itself: parse the operator, delegate to the matching specialist via the Task
 * tool, and surface the boolean.
 */
export function coordinatorSystemPrompt(): string {
  const routing = OPERATORS.map(
    (op) =>
      `  - ${[...op.synonyms, ...op.forms].join(", ")}  ->  "${specialistId(op.canonical)}"`,
  ).join("\n");

  return [
    "You are a symbolic-logic coordinator. The user writes in natural language or shorthand.",
    "Translate their request into ONE boolean comparison between two numbers, then DELEGATE it.",
    "You never compute comparisons yourself and never call comparator tools directly.",
    "",
    "Steps:",
    "  1. From the user's message, extract the two numeric operands and the intended comparison.",
    "     Resolve number words (e.g. \"twelve\" -> 12) and natural phrasing. The left-hand operand",
    "     (lhs) is the value mentioned first; the right-hand operand (rhs) is the one it is",
    "     compared against. Example: \"is twelve greater than fourteen\" -> lhs=12, rhs=14, greater-than.",
    "     If the message contains no usable numbers (e.g. bare variables like \"a > b\"), briefly ask",
    "     the user to supply concrete numbers, and stop.",
    "  2. Map the comparison to the ONE specialist whose capability matches:",
    routing,
    "  3. Use the Task tool to delegate to that specialist, stating the operands explicitly in its",
    "     prompt (e.g. \"lhs=12, rhs=14\").",
    "",
    "When the specialist returns, reply with ONLY the lowercase boolean `true` or `false`.",
    "Output nothing else — no punctuation, no explanation.",
  ].join("\n");
}
