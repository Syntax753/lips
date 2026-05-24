# lips

A symbolic-logic engine built as a **Model Context Protocol (MCP) server** with a
**coordinator** that emulates distributed processing by delegating each symbolic
pair to a short-lived, single-purpose subagent.

To start with it resolves single boolean comparisons: given a left operand, a
right operand, and a comparator, it returns a boolean. For example
`lhs=12, rhs=14, operator=GT` → `false`.

## Architecture

```
  REPL  (string in)
    │   e.g. "12 GT 14"
    ▼
  Coordinator  ── Claude Agent SDK (TypeScript) ──────────────────┐
    │  parses the operator, then uses the Task tool to spawn the   │
    │  ONE specialist that owns it. The specialist is short-lived: │
    │  spawned just-in-time, makes its single tool call, returns   │
    │  the boolean, and is discarded.                              │
    │                                                              │
    │      gt-specialist  ──► mcp__comparators__gt   ┐             │
    │      lt-specialist  ──► mcp__comparators__lt   │  Go MCP     │
    │      gte-specialist ──► mcp__comparators__gte  │  server     │
    │      lte-specialist ──► mcp__comparators__lte  │  (stdio,    │
    │      eq-specialist  ──► mcp__comparators__eq   │  stdlib     │
    │      neq-specialist ──► mcp__comparators__neq  ┘  JSON-RPC)  │
    ▼                                                              │
  true / false  ◄─────────────────────────────────────────────────┘
```

- **`go-mcp-server/`** — the comparator tools, written in **Go** for its strict
  typing. Each comparator (`gt`, `lt`, `gte`, `lte`, `eq`, `neq`) is its own MCP
  tool and is implemented imperatively (an explicit branch returning a bool). The
  server speaks JSON-RPC 2.0 over stdio using only the standard library, so it has
  zero external dependencies.
- **`coordinator/`** — the **TypeScript** coordinator and REPL, built on the
  [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).
  The coordinator does routing only; the per-comparator specialists do the work.

Why two languages: the Claude Agent SDK (the piece that spawns subagents via the
Task tool) ships for TypeScript and Python only — there is no Go agent SDK. So Go
owns the strongly-typed tools and TypeScript owns the orchestration.

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
>>> 12 GT 14
  · [coordinator] -> Task({"subagent_type":"gt-specialist", ...})
  · [gt-specialist] -> mcp__comparators__gt({"lhs":12,"rhs":14})
  false

>>> :direct 14 >= 14          # bypass the model, call the Go server directly
  true

>>> :ops                      # list operators
>>> :trace off                # hide the delegation trace
>>> :help
>>> :quit
```

Input accepts keyword or symbol forms: `GT`/`>`, `LT`/`<`, `GTE`/`>=`,
`LTE`/`<=`, `EQ`/`==`, `NEQ`/`!=`.

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

1. **Prompts** — add MCP prompts to the Go server for guided symbolic input.
2. **Long symbolic statements** — extend the coordinator to decompose a larger
   expression into symbolic pairs, fan them out across specialists in parallel,
   and combine the booleans.
3. **Mathematical proofs** — have the coordinator orchestrate multi-step
   reasoning over those decomposed results.
