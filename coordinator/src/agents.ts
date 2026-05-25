import type { AgentDefinition, McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { serverBinary, model } from "./config.js";
import { OPERATORS } from "./parser.js";
import { decisionServer, DECISION_SERVER, DECIDE_TOOL } from "./decisionTool.js";
import {
  delegatorServer,
  DELEGATOR_SERVER,
  ALGEBRAIC_TOOL,
  STATEMACHINE_TOOL,
  SOLVE_TOOL,
} from "./delegator/index.js";
import { arithmeticServer, OPS_SERVER, ARITHMETIC_TOOLS } from "./ops/arithmetic.js";
import { convertersServer, CONVERTERS_SERVER, CONVERTER_TOOLS } from "./converters/index.js";
import {
  evaluatorsServer,
  EVALUATORS_SERVER,
  COMPARABLE_TOOL,
  GRIDVALID_TOOL,
} from "./evaluators/index.js";

/** Name the Go MCP server is registered under; tools are mcp__<this>__<tool>. */
export const MCP_SERVER_NAME = "comparators";

/** The fully-qualified comparator tool name (e.g. mcp__comparators__gt). */
export function toolName(canonical: string): string {
  return `mcp__${MCP_SERVER_NAME}__${canonical}`;
}

// Capability specialist ids.
export const ARITHMETIC_SPECIALIST = "arithmetic-specialist";
export const DECISION_SPECIALIST = "decision-specialist";
export const ALGEBRA_SPECIALIST = "algebra-specialist";
export const CONVERTER_SPECIALIST = "converter-specialist";
export const EVALUATOR_SPECIALIST = "evaluator-specialist";
export const STATE_SPECIALIST = "state-specialist";
export const STATE_SOLVER = "state-solver";

/**
 * Every tool server is registered here, session-wide. The coordinator is still
 * prevented from calling any of them directly — see the canUseTool gate in
 * coordinator.ts, which allows non-Task tools only from inside a subagent. Each
 * specialist is further restricted to its own tools via its agent definition.
 */
export function mcpServers(): Record<string, McpServerConfig> {
  return {
    [MCP_SERVER_NAME]: { type: "stdio", command: serverBinary, args: [] },
    [DECISION_SERVER]: decisionServer(),
    [DELEGATOR_SERVER]: delegatorServer(),
    [OPS_SERVER]: arithmeticServer(),
    [CONVERTERS_SERVER]: convertersServer(),
    [EVALUATORS_SERVER]: evaluatorsServer(),
  };
}

/** Subagent id for a given comparator (e.g. "gt" -> "gt-specialist"). */
export function specialistId(canonical: string): string {
  return `${canonical}-specialist`;
}

/**
 * Specialists the coordinator delegates to via Task. Each owns exactly the
 * tools for its job (the `tools` allow-list); the coordinator itself owns none.
 * One short-lived comparator specialist per operator, plus a specialist for
 * each other capability.
 */
export function specialistAgents(): Record<string, AgentDefinition> {
  const agents: Record<string, AgentDefinition> = {};

  for (const op of OPERATORS) {
    const tool = toolName(op.canonical);
    agents[specialistId(op.canonical)] = {
      description: `Evaluates ${op.label} (${op.keyword}) of two numbers. Use for: ${[...op.synonyms, ...op.forms].join(", ")}.`,
      prompt: [
        `You are the ${op.label.toUpperCase()} (${op.keyword}) specialist.`,
        `Call \`${tool}\` exactly once with {"lhs": <number>, "rhs": <number>}.`,
        `Do NOT compute the comparison yourself. Reply with ONLY \`true\` or \`false\`.`,
      ].join(" "),
      tools: [tool],
      model,
      maxTurns: 3,
    };
  }

  agents[ARITHMETIC_SPECIALIST] = {
    description: "Calculates with numbers: multiply, add, subtract, divide.",
    prompt: [
      "You perform arithmetic.",
      `Call the matching tool (mcp__${OPS_SERVER}__multiply / __add / __subtract / __divide) with the`,
      "two operands. If given a multi-step calculation, chain the tools, feeding each result into the",
      "next. Never calculate in your head. Reply with ONLY the final number.",
    ].join(" "),
    tools: [...ARITHMETIC_TOOLS],
    model,
    maxTurns: 8,
  };

  agents[DECISION_SPECIALIST] = {
    description: "Decides which of two values is better (numbers, text, or outcome objects).",
    prompt: [
      "You make a single decision.",
      `Call \`${DECIDE_TOOL}\` with lhs, rhs, comparator ("numeric" | "alpha" | "outcome") and goal`,
      '("max" | "min"). Reply with the better value, or "tie".',
    ].join(" "),
    tools: [DECIDE_TOOL],
    model,
    maxTurns: 3,
  };

  agents[ALGEBRA_SPECIALIST] = {
    description: "Solves a system of linear equations.",
    prompt: [
      "You solve linear systems.",
      `Call \`${ALGEBRAIC_TOOL}\` once with { equations: [...] }.`,
      "Reply with the solved value(s), or the reason it is not solvable.",
    ].join(" "),
    tools: [ALGEBRAIC_TOOL],
    model,
    maxTurns: 3,
  };

  agents[CONVERTER_SPECIALIST] = {
    description: "Converts a value's data type (number-word/digits -> int, JSON -> id field).",
    prompt: [
      "You convert data types.",
      `Use \`${CONVERTER_TOOLS[0]}\` for a number-word or digit string -> integer, and`,
      `\`${CONVERTER_TOOLS[1]}\` to pull an id field out of a JSON object. Reply with ONLY the result.`,
    ].join(" "),
    tools: [...CONVERTER_TOOLS],
    model,
    maxTurns: 3,
  };

  agents[EVALUATOR_SPECIALIST] = {
    description: "Checks whether two values can be compared under a comparator.",
    prompt: [
      "You evaluate comparability.",
      `Call \`${COMPARABLE_TOOL}\` with lhs, rhs, comparator. Reply with ok and, if not ok, the`,
      "suggested converter.",
    ].join(" "),
    tools: [COMPARABLE_TOOL],
    model,
    maxTurns: 3,
  };

  agents[STATE_SPECIALIST] = {
    description: "Handles game states given as ASCII grids: lists all next states, validates a grid.",
    prompt: [
      "You handle game-state grids.",
      `To list ALL possible next states, call \`${STATEMACHINE_TOOL}\` with { grid, ruleset } (ruleset`,
      'defaults to "sokoban"); reply with the full list of resulting grids it returns.',
      `To check a grid is well-formed, call \`${GRIDVALID_TOOL}\`. Do not simulate moves yourself.`,
    ].join(" "),
    tools: [STATEMACHINE_TOOL, GRIDVALID_TOOL],
    model,
    maxTurns: 3,
  };

  // Grid-solving specialist. ONE call to the deterministic resolver runs the
  // whole breadth-first search — popping the frontier, pruning seen states —
  // and yields the optimal path and the minimum move count in a single search.
  agents[STATE_SOLVER] = {
    description:
      "Grid-solving specialist: runs ONE breadth-first search (popping the queue, pruning seen states) and returns the OPTIMAL path and the minimum move count (or 'unsolvable').",
    prompt: [
      "You solve grid puzzles with the deterministic resolver (ruleset default sokoban, goal 'x').",
      `Call \`${SOLVE_TOOL}\` ONCE with { grid, ruleset }. It runs a breadth-first search — repeatedly`,
      "popping states off the queue, expanding successors, and pruning states already seen — until it",
      "reaches the goal. It returns { solvable, moves (the MINIMUM), path (start..goal), explored,",
      "pushed, pruned }.",
      "Report: the minimum move count, and the optimal path as the ordered sequence of grids. If",
      "solvable is false, say so. Lead your reply with the move count as a number so it can be compared.",
      `You may validate the grid first with \`${GRIDVALID_TOOL}\`. Never search or move by hand.`,
    ].join(" "),
    tools: [SOLVE_TOOL, GRIDVALID_TOOL],
    model,
    maxTurns: 3,
  };

  return agents;
}

/**
 * System prompt for the coordinator. Its ONLY tool is Task: it delegates every
 * unit of work to a specialist and composes the results. It never calls a
 * comparison / arithmetic / algebra / conversion tool itself.
 */
export function coordinatorSystemPrompt(): string {
  const routing = OPERATORS.map(
    (op) =>
      `         ${[...op.synonyms, ...op.forms].join(", ")}  ->  "${specialistId(op.canonical)}"`,
  ).join("\n");

  return [
    "You are a symbolic-logic ORCHESTRATOR. You DECOMPOSE the request, DELEGATE every unit of work to a",
    "specialist via the Task tool, and COMPOSE their results into the answer.",
    "",
    "HARD RULE — Task is your ONLY tool. You do NOT have access to the comparison / arithmetic / algebra /",
    "conversion / evaluation / state tools; they belong to the specialists. A direct tool call by you is",
    "DENIED and wastes a turn — never attempt one, go straight to Task. You also never compute, compare,",
    "or convert in your head (not even 4 + 2). For EVERY such step, spawn the matching specialist via Task",
    "and use exactly what it returns. Your own work is limited to: classifying, decomposing, delegating,",
    "and composing (boolean AND / OR / NOT, picking an extreme, chaining one specialist's result into the",
    "next Task).",
    "",
    "NARRATE: right before each Task, output ONE short sentence saying what you are delegating and why.",
    "",
    "SPECIALISTS — for each unit of work spawn the NAMED specialist below via Task (use its exact",
    'subagent_type; never a general-purpose agent). State the operands explicitly (e.g. "lhs=12, rhs=14"):',
    "",
    '  TRUTH — a yes/no question about two numbers ("is a > b", "a == b", "a <= b"):',
    routing,
    "",
    `  DECISION — which of two values is better ("bigger", "smaller", "first alphabetically", "best"):`,
    `         -> "${DECISION_SPECIALIST}"  (it takes comparator numeric/alpha/outcome and goal max/min;`,
    "            outcome ranks JSON {expectedValue, survivalProbability}, survival first).",
    "",
    `  ARITHMETIC — multiply / add / subtract / divide numbers (every step, even 4 + 2):`,
    `         -> "${ARITHMETIC_SPECIALIST}"  (delegate each operation; chain for multi-step formulas).`,
    "",
    `  DERIVATION — equations / word problems / systems of unknowns:`,
    `         -> "${ALGEBRA_SPECIALIST}"  (translate the statement into linear equations and pass the list).`,
    "",
    `  CONVERT — a number word ("twelve") or a JSON object that must become a comparable scalar:`,
    `         -> "${CONVERTER_SPECIALIST}"  (do this FIRST, then chain the converted value onward).`,
    "",
    `  EVALUATE — unsure whether two values can be compared at all:`,
    `         -> "${EVALUATOR_SPECIALIST}"  (returns ok + a suggested converter when not comparable).`,
    "",
    `  STATE / GRID (list moves) — a grid, asked for its next states / possible moves:`,
    `         -> "${STATE_SPECIALIST}"  (returns ALL possible next states; relay the full list).`,
    "            A bare grid with NO instruction defaults here — list the next states.",
    "",
    `  SOLVE a grid — "is it solvable?", "how many moves?", "what's the optimal play?", or as a value`,
    "         for a comparison:",
    `         -> "${STATE_SOLVER}"  (ONE breadth-first search: it pops states off the queue and prunes`,
    "            seen ones until it reaches the goal, then returns the MINIMUM move count and the optimal",
    "            path). Report the move count and/or the path. The move count is a value like any other:",
    "            feed it into a comparator / arithmetic (e.g. \"fewer than 4?\"), or compare two grids by",
    "            solving EACH and comparing their counts.",
    "",
    "DECOMPOSE & COMPOSE: split a compound request into sub-problems; run INDEPENDENT ones in parallel",
    "(emit several Tasks at once) and SEQUENCE dependent ones (feed each result into the next Task).",
    'e.g. "is 5 > 3 and 2 < 1?" -> gt(5,3) || lt(2,1) in parallel, then AND.',
    'e.g. "is the larger of 3 and 8 over 5?" -> DECISION(max of 3,8)=8, THEN TRUTH(8 > 5).',
    "",
    "OUTPUT: a single truth -> reply ONLY `true`/`false`; a single decision -> the better value (or",
    "`tie`); a derivation/compound -> the final answer concisely, flagging any value that breaks a",
    'real-world limit (e.g. a negative age). If needed numbers are missing (bare "a > b"), ask and stop.',
  ].join("\n");
}
