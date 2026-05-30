---
name: solve
description: The front door to the lips engine. Solve, validate, or decompose any statement — boolean logic, linear and nonlinear algebra (real and complex), Sokoban grids, timeline and people-connection, or compound mixes joined by and/or. It breaks the input into sections, shows which are binary truths versus which need analysis and the tool that handled each, routes free-form, relation, and geopolitical parts to the agentic layer (connect-people, political, or validate-smart), composes the result, and presents the verifiable per-section breakdown. Use for any solve, is-this-true, is-this-solvable, are-these-connected, how-many, or which-is-bigger request.
---

# solve — the lips front door

One entry for the whole engine. It decomposes the statement, routes each part to
the right solver, composes the answer, and shows the per-section **tool breakdown**
so the result is verifiable, not opaque. The deterministic leaves do what they can
prove; the agentic layer handles the free-form rest.

## Steps

1. **Decompose + classify — ALWAYS run `breakdown` first.** Pass the full input to
   the lips **`breakdown`** tool *before any routing*, with **no exceptions** — a
   relation/connection question ("is X related to Y") goes through `breakdown` too,
   not straight to `connect-people`. This guarantees every task starts from one
   uniform, inspectable classification. (The *only* shortcut: a pasted Sokoban grid
   may go directly to **`solve`**, since `breakdown` would merely re-invoke the same
   solver without the colour movement view.) Each section comes back tagged:
   - **binary** — a boolean truth → the comparator leaf;
   - **analysed** — needs a solver → algebra (linear, or the nonlinear ℝ/ℂ
     analyser — which now handles `/` division and under-determined *existence*
     witnesses), Sokoban **`solve`**, or timeline **`reachable`**;
   - **deferred** — free natural language the deterministic core won't guess at; a
     geopolitical/factual claim tags as **political** (kind) → the `political` skill.

   The lips tools (`breakdown`, `validate`, `solve`, `reachable`, `algebraic`) and
   the `lips-smart` tools are pre-registered MCP tools (see `.mcp.json`); their
   schemas load **at most once** per session — call them directly, don't re-search.

2. **Resolve each section.**
   - *binary / analysed* — already answered by the deterministic leaf; the
     `breakdown` / `validate` result carries the verdict and which tool produced it.
   - *deferred* —
     - a people **relation / connection** question ("is X related to / linked to
       Y", "how is X connected to Y", "six degrees") → invoke the
       **`connect-people`** skill (open-world search → `reachable` verdict);
     - a **geopolitical / factual** claim (tagged **political** — wars, treaties,
       countries, leaders, "more oil/GDP than", "did war Z end in YEAR", "who fought
       in both world wars") → invoke the **`political`** skill (web research →
       reduce to a `validate` comparator or `reachable` timeline verdict; returns
       **true / false / indeterminate** with sources). The `political` tag is a
       **hint, not binding**: a *relation* phrasing ("is X **linked / related /
       connected** to Y") always goes to **`connect-people`**, even when it mentions
       a country/empire/leader — `political` is for factual *claims*, not person-links;
     - any other free-form NL (word problems, compound reasoning) → hand to
       **`validate-smart`** on the `lips-smart` server (decompose → delegate →
       compose). Its escalating **`breakdown`** does steps 1–2 in one call.

3. **Compose + present.** Show the per-section breakdown — each clause's *type ·
   kind · tool · verdict* — then the composed answer (AND/OR for boolean compounds;
   otherwise each section answered independently). Flag any *unverified* step (e.g.
   a soft relationship edge) the conclusion leaned on.

## Under the hood
- **Deterministic core** (auth-free, reproducible) — the `lips` MCP server:
  `validate`, `breakdown`, `solve`, `bestmove`, `optimize`, `reachable`,
  `algebraic`.
- **Agentic layer** (runs a Claude session) — the `lips-smart` server:
  `validate-smart` and the escalating `breakdown`; plus the `connect-people` and
  `political` skills (open-world web research → a deterministic `reachable` /
  comparator verdict).
- Note: the `/solve` *skill* (this front door) is distinct from the `solve` MCP
  *tool* (which solves a Sokoban grid). `/solve` orchestrates all the leaves.

## Examples
- `5 > 3 and 2 < 1` → two **binary** sections → boolean composition → **false**.
- `x^2 + y^2 = -1` → **nonlinear analyser** → no real solution; solvable over ℂ.
- `x^2 + y^3 = x/y` → **nonlinear analyser** → clears the `/` (records y ≠ 0), finds a
  verified real witness (e.g. x ≈ −1.618, y = −1); solvable over ℝ and ℂ.
- `x^2 + y^3 = x + y + 17` → **nonlinear analyser** → under-determined, so it returns a
  checked existence witness (e.g. x ≈ 4.653, y = 0) instead of deferring.
- `is Arnold Schwarzenegger related to Tony Blackburn?` → **connect-people** →
  Arnold → Ali → Lennon → Geller → Blackburn.
- a pasted Sokoban grid → **`solve`** → minimum moves + colour movement view.
- `is the larger of 3 and 8 over 5?` → **`validate-smart`** → decompose → **true**.
- `does the UAE have more oil than the United States?` → **`political`** → research proven reserves → `validate("113 > 35")` → **true** (basis: proven reserves; production flips it — flagged).
- `will World War 1 end in 1918?` → **`political`** → research end date → `validate("1918 = 1918")` → **true**.
- `find someone who fought in both world wars` → **`political`** + **`reachable`** → research a candidate + service dates → timeline confirms 1914–1918 and 1939–1945 both covered.
