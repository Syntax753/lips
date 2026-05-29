#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { solve, bestMove, optimize, renderResult } from "./delegator/solve.js";
import type { PlanStep } from "./delegator/plan.js";
import { solveSystem } from "./delegator/algebraic.js";
import { solveTimeline } from "./delegator/timeline.js";
import { validate } from "./solvers/validate.js";
import { DEFAULT_RULESET } from "./rules/index.js";

/**
 * The DROP-IN stdio MCP server: the deterministic core of lips, exposed as a
 * real Model Context Protocol server so any project can add it to its MCP config
 * and call the solvers directly — no Claude session, no auth, fully reproducible.
 *
 *   add to a host's config:
 *     "lips": { "command": "node", "args": ["<repo>/coordinator/dist/mcpServer.js"] }
 *
 * Tools:
 *   validate  — classify any input (grid | algebra | timeline | boolean) and run
 *               the matching solver, returning a uniform verdict. The single
 *               entry point a host coordinator routes everything through.
 *   solve     — deterministically solve a Sokoban grid (minimum moves/pushes).
 *   bestmove  — the single best next step toward the win for a grid.
 *   algebraic — solve a linear system end-to-end.
 *
 * The agentic coordinator (classify -> decompose NL -> delegate -> compose) is a
 * SEPARATE, optional layer on top of this core (Phase 5).
 *
 * stdout carries JSON-RPC only; all human logging goes to stderr (see logger.ts),
 * which defaults to quiet here so the transport stream stays clean.
 */

const server = new McpServer({ name: "lips", version: "0.1.0" });

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

server.registerTool(
  "validate",
  {
    title: "Validate any solvable input",
    description:
      "Classify an input and run the matching deterministic solver, returning a uniform verdict { kind, valid, witness, metrics, reason }. Routes by structure: an ASCII grid -> Sokoban solvability + minimum moves; equations with unknowns -> linear-system solution; a JSON timeline of events -> temporal reachability (coming soon); a numeric comparison or and/or chain -> a truth. Free natural language returns kind='unknown' (it needs an agentic coordinator to decompose first). `valid` is the core yes/no; `witness` is the proof (winning grid, solution map, evaluated atoms).",
    inputSchema: { input: z.string().describe("the thing to validate: a grid, equations, a timeline, or a comparison") },
  },
  async ({ input }) => {
    const r = validate(input);
    return text(`[${r.kind}] valid=${r.valid} — ${r.reason}\n${JSON.stringify(r)}`);
  },
);

server.registerTool(
  "solve",
  {
    title: "Solve a Sokoban grid (minimum moves)",
    description:
      "Deterministically solve an ASCII grid (ruleset default 'sokoban') and report the MINIMUM player moves. Glyphs: player '@', floor '.', player goal 'x' (player on it 'X'), walls '#', box '+' (on a goal '*'), empty box goal '~'. WIN: every box goal covered AND (if present) the player on 'x'. Search is equivalence-collapsed over pushes and A*-ordered, so `moves` is the true minimum; `pushes` is the box-push count. Returns { solvable, moves, pushes, winning, explored, pushed, pruned }.",
    inputSchema: {
      grid: z.string().describe("the start state as an ASCII grid"),
      ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
    },
  },
  async ({ grid, ruleset }) => {
    const r = solve(grid, ruleset ?? DEFAULT_RULESET);
    const view = r.solvable
      ? renderResult(grid, r, !process.env.NO_COLOR) // colourised movement view (NO_COLOR=1 to disable)
      : `not solvable — ${r.reason} (explored ${r.explored}, pruned ${r.pruned})`;
    // Drop the (potentially large) per-step grid path; the plan vectors + analysis
    // are the compact carry-forward an `optimize` call refines.
    const { path: _path, ...rest } = r;
    return text(`${view}\n${JSON.stringify(rest)}`);
  },
);

server.registerTool(
  "optimize",
  {
    title: "Condense / prove-optimal a solver plan",
    description:
      "Refine a solver's push-VECTOR plan WITHOUT re-analysing the grid. Always local-condenses (shortest player walks between pushes, tightening a satisficing plan); with proven=true it runs a bounded optimal re-search seeded by the plan's cost, returning a strictly shorter plan if one exists or proving the plan is already optimal. Input: the grid and the `plan` array from a solve result. Returns { valid, moves, pushes, optimal, improvedFromMoves, plan, winning }.",
    inputSchema: {
      grid: z.string().describe("the start state as an ASCII grid"),
      plan: z.array(z.unknown()).describe("the solver's push-vector plan (the `plan` field of a solve result)"),
      proven: z.boolean().optional().describe("also prove/achieve the optimum via bounded re-search (default false)"),
      ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
    },
  },
  async ({ grid, plan, proven, ruleset }) => {
    const r = optimize(grid, plan as PlanStep[], { proven, ruleset });
    const summary = r.valid
      ? `${r.optimal ? "optimal" : "condensed"}: ${r.moves} move(s) / ${r.pushes} push(es)${r.improvedFromMoves !== null ? ` (was ${r.improvedFromMoves})` : ""} — ${r.reason}`
      : `cannot optimize — ${r.reason}`;
    return text(`${summary}\n${JSON.stringify(r)}`);
  },
);

server.registerTool(
  "bestmove",
  {
    title: "Best next move for a Sokoban grid",
    description:
      "Return the single BEST next step toward the win for a grid (the first step of the shortest play): the resulting grid, whether that step reaches the win, and how many optimal steps remain. Re-apply it to the returned grid to play out the optimal sequence.",
    inputSchema: {
      grid: z.string().describe("the current state as an ASCII grid"),
      ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
    },
  },
  async ({ grid, ruleset }) => {
    const r = bestMove(grid, ruleset ?? DEFAULT_RULESET);
    const summary = !r.solvable
      ? `no best move — ${r.reason}`
      : `${r.reachedGoal ? "winning move" : "best move"} (${r.movesRemaining} move(s) to win):\n${r.move}`;
    return text(`${summary}\n${JSON.stringify(r)}`);
  },
);

server.registerTool(
  "reachable",
  {
    title: "Encounter-reachability over character timelines",
    description:
      "Decide whether a player who can SWITCH between co-located characters can encounter EVERY character starting from any one. Input: a list of characters, each a list of presence intervals { starttime, endtime, locationid }. Two characters interact when they share a locationid during overlapping time; the answer is whether that co-location graph is CONNECTED. Returns { connected, characters, edges, encounter, components, reason } — `connected` is the verdict, `encounter` a walk reaching everyone, `components` the unreachable groups when false.",
    inputSchema: {
      characters: z
        .array(z.unknown())
        .describe("list of characters; each is { id?, intervals: [{starttime,endtime,locationid}] } or a bare interval list"),
    },
  },
  async ({ characters }) => {
    const r = solveTimeline(characters);
    return text(`connected=${r.connected} — ${r.reason}\n${JSON.stringify(r)}`);
  },
);

server.registerTool(
  "algebraic",
  {
    title: "Solve a linear system",
    description:
      "Solve a LINEAR system end-to-end. Give the list of equations; it evaluates solvability (preflight), then reduces and solves deterministically, returning { ok, solution, comparables, reason }. Each `comparable` is a CMP (lhs, rhs, comparator='eq') that re-confirms the solution.",
    inputSchema: {
      equations: z.array(z.string()).describe('linear equations, e.g. ["M = 4*T", "M - 10 = 2*(T - 10)"]'),
    },
  },
  async ({ equations }) => {
    const r = solveSystem(equations);
    const summary = r.ok
      ? `solution: ${Object.entries(r.solution).map(([k, v]) => `${k} = ${v}`).join(", ")}`
      : `not solvable: ${r.reason}`;
    return text(`${summary}\n${JSON.stringify(r)}`);
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The process now lives on the stdio transport until the host disconnects.
  process.stderr.write("lips MCP server ready (stdio) — tools: validate, solve, bestmove, algebraic\n");
}

main().catch((err) => {
  process.stderr.write(`lips MCP server failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
