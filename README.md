# lips

A symbolic-logic engine built as a **Model Context Protocol (MCP) server** with a
**coordinator** that emulates distributed processing by delegating each symbolic
comparison to a tool.

The coordinator is a **decompose → delegate → compose** orchestrator: it breaks a
request (natural language, shorthand, or compound logic) into atomic symbolic
truths, delegates every pairwise comparison to a tool, and composes the results.
It never compares two values itself. There are two delegation targets:

- a **boolean truth** ("is 12 > 14?") goes to a short-lived per-operator
  **specialist** that calls the Go MCP server — returns `true`/`false`;
- a **decision** ("which is bigger, 12 or 14?") goes to the in-process
  **validator** — returns `-1` (lhs better), `+1` (rhs better), or `0` (equal).

## Architecture

```
  REPL  (text in)
    │   "is the larger of 3 and 8 over 5?"
    ▼
  Coordinator (orchestrator) ── Claude Agent SDK (TypeScript) ───────────────┐
    │  Decomposes into atomic comparisons; never compares directly.          │
    │                                                                        │
    │  TRUTH  ── Task ─► gt-specialist  ─► mcp__comparators__gt   ┐          │
    │  (yes/no)          lt-specialist  ─► mcp__comparators__lt   │ Go MCP   │
    │                    gte-specialist ─► mcp__comparators__gte  │ server   │
    │                    lte / eq / neq ─► mcp__comparators__…    ┘ (stdio)  │
    │                                                                        │
    │  DECISION ─────────► mcp__validator__validate   (in-process SDK tool)  │
    │  (which is better)        └─ cmp/numeric, cmp/alpha → -1 | 0 | +1      │
    │                                                                        │
    ▼  composes the atomic results (AND / OR / pick-extreme / …)             │
  answer  ◄──────────────────────────────────────────────────────────────────┘
```

- **`go-mcp-server/`** — the comparator tools, written in **Go** for its strict
  typing. Each comparator (`gt`, `lt`, `gte`, `lte`, `eq`, `neq`) is its own MCP
  tool, implemented imperatively (an explicit branch returning a bool). The server
  speaks JSON-RPC 2.0 over stdio using only the standard library — zero external
  dependencies.
- **`coordinator/`** — the **TypeScript** coordinator and REPL, built on the
  [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).
  - `src/cmp/` — programmatic comparators (`numeric`, `alpha`) returning the
    standard natural order `-1 | 0 | 1`.
  - `src/validator.ts` — wraps a comparator with a `max`/`min` goal to decide
    which value is "better".
  - `src/validatorTool.ts` — exposes `validate` as an in-process SDK MCP tool,
    available to the coordinator only (not to the specialists).

Why two languages: the Claude Agent SDK (the piece that spawns subagents via the
Task tool) ships for TypeScript and Python only — there is no Go agent SDK. So Go
owns the strongly-typed comparison tools and TypeScript owns the orchestration.

## Prerequisites

- **Node ≥ 20**.
- **Go** — *no manual install required.* On first startup the coordinator
  provisions a project-local Go toolchain into `.toolchain/` (gitignored), then
  builds the server. If you already have Go ≥ 1.22 on `PATH`, that is reused
  instead of downloading. Controls: `LIPS_GO=bundled|system|auto` (default
  `auto`) and `GO_VERSION=1.26.3` to pin a release.
- **Claude auth** — the Agent SDK reuses Claude Code's credentials. If `claude`
  is logged in you are set; otherwise export `ANTHROPIC_API_KEY`. (Only the
  coordinator path needs this; `:direct` does not.)

## Build & run

```sh
cd coordinator
npm install
npm run setup     # provisions Go on first run, runs `go test`, builds the server
npm run repl      # start the REPL   (or: npm run dev — runs from source via tsx)
```

`npm run setup` is optional: the REPL also provisions Go and builds the server
on startup. Run it explicitly when you just want to compile and test the Go side.

## Using the REPL

```
>>> is twelve greater than fourteen?      # boolean truth -> specialist
  · [coordinator] -> Task({"subagent_type":"gt-specialist", ...})
  · [gt-specialist] -> mcp__comparators__gt({"lhs":12,"rhs":14})
  false

>>> which is bigger, 12 or 14?            # decision -> validator
  · [coordinator] -> mcp__validator__validate({"lhs":"12","rhs":"14","comparator":"numeric","goal":"max"})
  14

>>> is 5 > 3 and 2 < 1?                    # compound -> decomposed, then composed
  · [coordinator] -> Task({"subagent_type":"gt-specialist", ...})
  · [coordinator] -> Task({"subagent_type":"lt-specialist", ...})
  false

>>> :direct 14 >= 14                       # boolean compare via Go server (no model)
  true
>>> :validate numeric max 12 14            # decision via validator (no model)
  verdict +1  (better: 14)
>>> :ops                                   # list operators
>>> :trace off                             # hide the delegation trace
>>> :help
>>> :quit
```

Input accepts natural language, or keyword/symbol forms: `GT`/`>`, `LT`/`<`,
`GTE`/`>=`, `LTE`/`<=`, `EQ`/`==`, `NEQ`/`!=`.

### Verifying the Go server on its own

The server is a normal stdio program, so you can drive it by hand:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"gt","arguments":{"lhs":12,"rhs":14}}}' \
  | ./go-mcp-server/bin/comparators
```

The third response should contain `"text":"false"`.

## Roadmap

The pieces are arranged so the next phases drop in without reshaping the core:

1. **Decomposition & composition** *(landed)* — the coordinator splits compound
   logic into atomic comparisons, delegates each, and composes the results.
2. **Richer comparators** — extend `cmp/` beyond `numeric`/`alpha` (e.g. dates,
   versions, or object comparison by a chosen field) so decisions can range over
   more than scalars.
3. **Prompts** — add MCP prompts to the Go server for guided symbolic input.
4. **Mathematical proofs** — have the coordinator orchestrate multi-step
   reasoning over the decomposed results.
