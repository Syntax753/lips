import type { AgentDefinition, McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { serverBinary, model } from "./config.js";
import { OPERATORS } from "./parser.js";
import { decisionServer, DECISION_SERVER, DECIDE_TOOL } from "./decisionTool.js";
import { delegatorServer, DELEGATOR_SERVER, ALGEBRAIC_TOOL } from "./delegator/index.js";
import { arithmeticServer, OPS_SERVER, MULTIPLY_TOOL } from "./ops/arithmetic.js";

/** Name the Go MCP server is registered under; tools are mcp__<this>__<tool>. */
export const MCP_SERVER_NAME = "comparators";

/** The fully-qualified tool name as seen by the agent runtime. */
export function toolName(canonical: string): string {
  return `mcp__${MCP_SERVER_NAME}__${canonical}`;
}

/** The Go comparator server, registered per-specialist (not on the coordinator). */
function comparatorServerSpec() {
  return { [MCP_SERVER_NAME]: { type: "stdio" as const, command: serverBinary, args: [] } };
}

/**
 * MCP servers available to the COORDINATOR:
 *  - decision (in-process) — "which is better" (comparator + goal);
 *  - delegator (in-process) — domain solvers; today the algebraic delegator.
 *
 * The Go comparators server is deliberately NOT here — it is registered only on
 * the specialist agents (see specialistAgents), so a boolean truth can only be
 * resolved by delegating to a specialist, never by the coordinator directly.
 */
export function mcpServers(): Record<string, McpServerConfig> {
  return {
    [DECISION_SERVER]: decisionServer(),
    [DELEGATOR_SERVER]: delegatorServer(),
    [OPS_SERVER]: arithmeticServer(),
  };
}

/**
 * Tools the coordinator itself may call. The boolean comparator tools are
 * deliberately NOT here: a truth must be delegated to a specialist (via Task),
 * which owns its single comparator tool through its agent definition. This
 * keeps the call tree consistently coordinator -> Agent -> comparator tool.
 */
export function allowedToolNames(): string[] {
  return ["Task", DECIDE_TOOL, ALGEBRAIC_TOOL, MULTIPLY_TOOL];
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
      // The comparators server is scoped to the specialist, so only it (not the
      // coordinator) can reach the Go comparator tools.
      mcpServers: [comparatorServerSpec()],
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
    "symbolic truths, DELEGATE the work to tools, and COMPOSE the results into the answer.",
    "",
    "HARD RULE — you NEVER compare, do algebra, or do arithmetic yourself. You must not decide whether",
    "one value is greater/smaller/equal/better, isolate or solve a variable, or multiply/add numbers, by",
    "your own reasoning. Every comparison, derivation, and calculation MUST go to a tool. Your own work",
    "is limited to: classifying, decomposition, delegation, and composition (boolean logic AND / OR /",
    "NOT, picking an extreme, ordering, counting, and chaining one tool's result into the next).",
    "",
    "NARRATE everything: right before each tool call, output ONE short sentence saying what you are",
    "delegating and why — the user watches these explanations.",
    "",
    "CLASSIFY each glyph and each tool response, and route it by its type (independent parts may be",
    "delegated in parallel):",
    "  [USR] raw input            -> analyse and decompose it.",
    "  [RDR] needs reducing       -> equations/unknowns; hand the whole list to the algebra delegator.",
    "  [CMP] {lhs, rhs, comparator}-> send to the matching comparator (a TRUTH) to get true/false.",
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
    `    Call the \`${DECIDE_TOOL}\` tool with: lhs, rhs, comparator ("numeric" for numbers or`,
    '    "alpha" for text), and goal ("max" = larger/later is better, "min" = smaller/earlier is better).',
    "    It returns -1 (lhs is better), +1 (rhs is better), or 0 (equal).",
    "",
    "  • DERIVATION [RDR] — the request implies equations / unknowns (word problems, systems).",
    "    Translate the statement into linear equations (interpretation only, not computation),",
    '    e.g. "I am four times his age" -> "M = 4*T". Then hand the WHOLE list to the algebra delegator:',
    `      Call \`${ALGEBRAIC_TOOL}\` once with { equations: [...] }. It preflights, reduces and solves`,
    "      deterministically and returns { ok, solution, comparables, steps }.",
    "      - If ok=false, report the reason and stop.",
    "      - `comparables` are [CMP] items; to confirm the solution, send them to the comparator",
    "        specialists (Task) — independent ones in parallel.",
    "      - ok=true means the system was SOLVED (not merely 'solvable') — report the value(s) from",
    '        `solution` (e.g. Tony\'s age); never answer just "true"/"false" for a derivation.',
    "",
    "  • ARITHMETIC — combining quantities, e.g. multiplication.",
    `    Call \`${MULTIPLY_TOOL}\` with two operands (type "numeric" for numbers). For more than two`,
    "    factors, CHAIN: multiply the first two, then multiply that product by the next, and so on.",
    "    Never multiply or add in your head — each step is a tool call.",
    "",
    "Use your language understanding to break the request into sub-problems, and judge how they relate:",
    "  - PARALLEL (independent) — delegate them together in ONE turn (emit the tool calls at once),",
    '    then compose. e.g. "is 5 > 3 and 2 < 1?" -> truth(5>3) ‖ truth(2<1) in parallel, then AND.',
    "  - LINEAR (dependent) — each step needs the previous result, so delegate in sequence, feeding",
    '    results forward. e.g. "is the larger of 3 and 8 over 5?" -> DECISION(max of 3,8)=8, THEN TRUTH(8 > 5).',
    '  - Many requests mix both: parallel branches that later join. e.g. "which is biggest: 12, 14, 9?"',
    "    -> run the pairwise DECISIONS, then pick the maximum.",
    "Only serialise when a step truly depends on an earlier result; otherwise delegate concurrently.",
    "",
    'Resolve number words ("twelve" -> 12); the lhs is the value mentioned first. If a comparison needs',
    'numbers that were not given (bare variables like "a > b"), briefly ask for them and stop.',
    "",
    "OUTPUT: a single truth -> reply ONLY `true`/`false`; a single decision -> reply with the better",
    "value (or `tie`); a derivation/compound request -> reply with the final answer concisely, and",
    "flag any value that breaks a real-world constraint (e.g. a negative age).",
  ].join("\n");
}
