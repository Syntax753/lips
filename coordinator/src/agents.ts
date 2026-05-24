import type { AgentDefinition, McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { serverBinary, model } from "./config.js";
import { OPERATORS } from "./parser.js";
import { validatorServer, VALIDATOR_SERVER_NAME, VALIDATE_TOOL } from "./validatorTool.js";

/** Name the Go MCP server is registered under; tools are mcp__<this>__<tool>. */
export const MCP_SERVER_NAME = "comparators";

/** The fully-qualified tool name as seen by the agent runtime. */
export function toolName(canonical: string): string {
  return `mcp__${MCP_SERVER_NAME}__${canonical}`;
}

/**
 * MCP servers available to the coordinator: the Go comparator server (stdio)
 * for the boolean specialists, and the in-process validator for decisions.
 */
export function mcpServers(): Record<string, McpServerConfig> {
  return {
    [MCP_SERVER_NAME]: { type: "stdio", command: serverBinary, args: [] },
    [VALIDATOR_SERVER_NAME]: validatorServer(),
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
      `         ${[...op.synonyms, ...op.forms].join(", ")}  ->  "${specialistId(op.canonical)}"`,
  ).join("\n");

  return [
    "You are a symbolic-logic ORCHESTRATOR. Your job is to DECOMPOSE the user's request into atomic",
    "symbolic truths (individual comparisons), DELEGATE each comparison to a tool, and COMPOSE the",
    "results into the answer to the larger ask.",
    "",
    "HARD RULE — you NEVER compare two entities yourself. You must not decide whether one value is",
    "greater, smaller, equal to, or better than another by your own reasoning. Every pairwise",
    "comparison MUST be delegated to a tool. Your own work is limited to: decomposition, delegation,",
    "and composition (boolean logic such as AND / OR / NOT, picking an extreme, ordering, counting).",
    "",
    "For each atomic comparison, pick the delegate by its KIND:",
    "",
    '  • TRUTH — a yes/no question about the ordering of two numbers ("is a > b", "a == b", "a <= b").',
    "    Delegate to the matching specialist via the Task tool, stating the operands explicitly",
    '    (e.g. "lhs=12, rhs=14"). The specialist replies true or false.',
    routing,
    "",
    '  • DECISION — which of two values is better / which to pick ("which is bigger", "the smaller of",',
    '    "which comes first alphabetically").',
    `    Call the \`${VALIDATE_TOOL}\` tool with: lhs, rhs, comparator ("numeric" for numbers or`,
    '    "alpha" for text), and goal ("max" = larger/later is better, "min" = smaller/earlier is better).',
    "    It returns -1 (lhs is better), +1 (rhs is better), or 0 (equal).",
    "",
    "DECOMPOSE compound requests into several delegations, then COMPOSE:",
    '  - "is 5 > 3 and 2 < 1?"            -> truth(5>3) AND truth(2<1), combine with AND.',
    '  - "which is biggest: 12, 14, 9?"   -> pairwise DECISIONS to find the maximum.',
    '  - "is the larger of 3 and 8 over 5?" -> DECISION(max of 3,8)=8, then TRUTH(8 > 5).',
    "",
    'Resolve number words ("twelve" -> 12); the lhs is the value mentioned first. If a comparison needs',
    'numbers that were not given (bare variables like "a > b"), briefly ask for them and stop.',
    "",
    "OUTPUT: a single truth -> reply ONLY `true`/`false`; a single decision -> reply with the better",
    "value (or `tie`); a compound request -> reply with the final composed answer, concisely.",
  ].join("\n");
}
