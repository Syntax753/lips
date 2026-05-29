#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { coordinate } from "./coordinator.js";
import { breakdown, escalateBreakdown, renderBreakdown } from "./solvers/breakdown.js";
import { ensureServerReady } from "./bootstrap.js";

/**
 * The AGENTIC drop-in MCP server — the second layer on top of the deterministic
 * core (mcpServer.ts). It exposes ONE tool, `validate-smart`, that runs the full
 * coordinator: it DECOMPOSES a free-form natural-language request, DELEGATES each
 * atomic unit to a specialist subagent (which calls a deterministic leaf — the Go
 * comparators, the algebraic / grid / timeline solvers), and COMPOSES the answer.
 *
 * This is the "agentic coordinator / sub-agent" pattern packaged for a host. It
 * needs Claude credentials in the server process (the Agent SDK reuses Claude
 * Code's auth, or ANTHROPIC_API_KEY); the deterministic `lips` server needs
 * neither, so prefer it for typed inputs (grids, equations, timelines, symbolic
 * comparisons). Kept a SEPARATE entrypoint on purpose: the deterministic server
 * stays auth-free and dependency-light, and hosts opt into the agentic one.
 *
 *   add to a host's config:
 *     "lips-smart": { "command": "node", "args": ["<repo>/coordinator/dist/mcpServerSmart.js"] }
 *
 * stdout carries JSON-RPC only; the coordinator's live delegation trace and any
 * build logs go to stderr.
 */

const server = new McpServer({ name: "lips-smart", version: "0.1.0" });

server.registerTool(
  "validate-smart",
  {
    title: "Agentic validate — decompose, delegate, compose",
    description:
      "Answer a FREE-FORM request by orchestration: the coordinator decomposes it into atomic operations, delegates each to a specialist that calls a deterministic leaf (boolean comparators, linear algebra, Sokoban solve, timeline reachability), then composes the result. Use this for natural language the deterministic `validate` returns kind='unknown' for — word problems, compound questions, phrasings like \"is the larger of 3 and 8 over 5?\". Returns the composed answer plus the delegation trace. Slower and non-deterministic (it runs a Claude session); prefer the deterministic tools for typed inputs.",
    inputSchema: { input: z.string().describe("the natural-language request to decompose and solve") },
  },
  async ({ input }) => {
    const r = await coordinate(input, (line) => process.stderr.write(line + "\n"));
    const answer = r.error ? `error: ${r.error}` : r.raw || "(no answer)";
    return { content: [{ type: "text" as const, text: `${answer}\n\n--- delegation trace ---\n${r.trace.join("\n")}` }] };
  },
);

server.registerTool(
  "breakdown",
  {
    title: "Full breakdown — deterministic sections, agentic for the deferred ones",
    description:
      "Decompose a compound statement into sections (which are BINARY truths vs which need ANALYSIS, and the leaf each used), THEN resolve every free-NL 'deferred' section by escalating it to the coordinator (decompose → delegate → compose). One call gives the verifiable per-section breakdown AND resolves the natural-language parts, each with its delegation trace. This is the unified view: deterministic where it can be, agentic where it must be.",
    inputSchema: { input: z.string().describe("the compound statement to break down and resolve") },
  },
  async ({ input }) => {
    const base = breakdown(input);
    const full = await escalateBreakdown(base, async (clause) => {
      const r = await coordinate(clause, (line) => process.stderr.write(line + "\n"));
      return { answer: r.error ? `error: ${r.error}` : r.raw || "(no answer)", value: r.value, trace: r.trace };
    });
    return { content: [{ type: "text" as const, text: renderBreakdown(full) }] };
  },
);

async function main(): Promise<void> {
  // Build the Go comparator server if needed — but keep its build logs off
  // stdout (which is the JSON-RPC stream); redirect console.log to stderr.
  const origLog = console.log;
  console.log = (...a: unknown[]): void => void process.stderr.write(a.map(String).join(" ") + "\n");
  try {
    await ensureServerReady();
  } finally {
    console.log = origLog;
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("lips agentic MCP server ready (stdio) — tool: validate-smart (needs Claude auth)\n");
}

main().catch((err) => {
  process.stderr.write(`lips-smart failed to start: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
