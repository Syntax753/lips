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
      description: `Evaluates ${op.label} (${op.keyword}) comparisons of two numbers. Delegate here whenever the operator is ${op.keyword} (${op.forms.join(" or ")}).`,
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
      `  - operator ${op.keyword} (${op.forms.join(" / ")}) -> subagent "${specialistId(op.canonical)}"`,
  ).join("\n");

  return [
    "You are a symbolic-logic coordinator.",
    "You receive a single comparison expression of the form `<lhs> <operator> <rhs>`",
    "(operands are numbers; the operator is one of GT, LT, GTE, LTE, EQ, NEQ or its symbol).",
    "",
    "Your job is ROUTING, not arithmetic:",
    "  1. Identify the operator and the two operands.",
    "  2. Delegate the evaluation to the matching specialist subagent using the Task tool,",
    "     passing it the operands lhs and rhs.",
    "  3. Never compute the comparison yourself and never call comparator tools directly.",
    "",
    "Operator -> specialist routing table:",
    routing,
    "",
    "When the specialist returns, reply with ONLY the lowercase boolean `true` or `false`.",
    "Output nothing else — no punctuation, no explanation.",
  ].join("\n");
}
