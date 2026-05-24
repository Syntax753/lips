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
  - `src/cmp/` — **comparators**, specialised by input type (`numeric`, `alpha`),
    returning the natural order `-1 | 0 | 1`. `cmp/decide.ts` layers a `max`/`min`
    goal on top to answer "which is better"; exposed as the `decision/decide` tool.
  - `src/delegator/` — **domain delegators** that own the reduce/evaluate/compare
    logic so the coordinator doesn't orchestrate it step-by-step.
    `delegator/algebraic.ts` resolves a whole linear system *deterministically*
    (evaluator `preflight` → reducer + solver), backed by `src/algebra/linear.ts`
    (a hand-rolled parser → coefficient form; no CAS dependency). Exposed as the
    single `delegator/algebraic` tool.
  - `src/delegator/types.ts` — the parameter classification `USR | RDR | CMP`
    that tags every glyph and tool response so the coordinator can route it.

Why two languages: the Claude Agent SDK (the piece that spawns subagents via the
Task tool) ships for TypeScript and Python only — there is no Go agent SDK. So Go
owns the strongly-typed comparison tools and TypeScript owns the orchestration.

The coordinator is **classify → decompose → delegate → compose** and never
compares or does algebra itself. It tags each part `USR`/`RDR`/`CMP` and routes
by type (independent parts in parallel): a boolean **truth** [CMP] goes to a
comparator specialist, a **decision** to `decide`, and a **derivation** [RDR] —
a list of equations — goes to the algebraic delegator, which returns the
`solution` plus `comparables` (CMP truths that re-confirm it).

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

>>> which is bigger, 12 or 14?            # decision -> decide
  · [coordinator] -> mcp__decision__decide({"lhs":"12","rhs":"14","comparator":"numeric","goal":"max"})
  14

>>> is 5 > 3 and 2 < 1?                    # compound -> decomposed, then composed
  · [coordinator] -> Task({"subagent_type":"gt-specialist", ...})
  · [coordinator] -> Task({"subagent_type":"lt-specialist", ...})
  false

>>> I am four times Tony's age; 10 years ago I was double his age. How old is Tony?
  · [coordinator] -> mcp__delegator__algebraic({"equations":["M = 4*T","M - 10 = 2*(T - 10)"]})
  T = -5 (and M = -20) — flagged: a negative age is impossible.

>>> :direct 14 >= 14                       # boolean compare via Go server (no model)
  true
>>> :decide numeric max 12 14              # decision locally (no model)
  verdict +1  (better: 14)
>>> :ops                                   # list operators
>>> :help
>>> :quit
```

Tool calls (the `·` lines) are always shown.

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
2. **Linear algebra** *(landed)* — the algebraic delegator resolves linear systems
   deterministically (evaluate → reduce → solve); the coordinator just translates
   word problems into equations and hands off the `RDR` list.
3. **More delegators & comparators** — non-algebraic `delegator/` domains and more
   `cmp/` types (dates, versions, object comparison by field), all behind the same
   classify → delegate interface.
4. **Beyond linear** — quadratic/nonlinear solvers; the evaluator would need a
   stronger solvability check than count + connectivity.
5. **Prompts** — add MCP prompts to the Go server for guided symbolic input.
6. **Mathematical proofs** — have the coordinator orchestrate multi-step reasoning
   over the decomposed results.
