---
name: solve
description: The front door to the lips engine. Solve, validate, or decompose any statement — boolean logic, linear and nonlinear algebra (real and complex), Sokoban grids, timeline and people-connection, or compound mixes joined by and/or. It breaks the input into sections, shows which are binary truths versus which need analysis and the tool that handled each, routes free-form and relation parts to the agentic layer (connect-people or validate-smart), composes the result, and presents the verifiable per-section breakdown. Use for any solve, is-this-true, is-this-solvable, are-these-connected, how-many, or which-is-bigger request.
---

# solve — the lips front door

One entry for the whole engine. It decomposes the statement, routes each part to
the right solver, composes the answer, and shows the per-section **tool breakdown**
so the result is verifiable, not opaque. The deterministic leaves do what they can
prove; the agentic layer handles the free-form rest.

## Steps

1. **Decompose + classify.** Run the lips **`breakdown`** tool on the full input
   (or **`validate`** for a single clause). Each section comes back tagged:
   - **binary** — a boolean truth → the comparator leaf;
   - **analysed** — needs a solver → algebra (linear, or the nonlinear ℝ/ℂ
     analyser), Sokoban **`solve`**, or timeline **`reachable`**;
   - **deferred** — free natural language the deterministic core won't guess at.

2. **Resolve each section.**
   - *binary / analysed* — already answered by the deterministic leaf; the
     `breakdown` / `validate` result carries the verdict and which tool produced it.
   - *deferred* —
     - a people **relation / connection** question ("is X related to / linked to
       Y", "how is X connected to Y", "six degrees") → invoke the
       **`connect-people`** skill (open-world search → `reachable` verdict);
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
  `validate-smart` and the escalating `breakdown`; plus the `connect-people` skill.
- Note: the `/solve` *skill* (this front door) is distinct from the `solve` MCP
  *tool* (which solves a Sokoban grid). `/solve` orchestrates all the leaves.

## Examples
- `5 > 3 and 2 < 1` → two **binary** sections → boolean composition → **false**.
- `x^2 + y^2 = -1` → **nonlinear analyser** → no real solution; solvable over ℂ.
- `is Arnold Schwarzenegger related to Tony Blackburn?` → **connect-people** →
  Arnold → Ali → Lennon → Geller → Blackburn.
- a pasted Sokoban grid → **`solve`** → minimum moves + colour movement view.
- `is the larger of 3 and 8 over 5?` → **`validate-smart`** → decompose → **true**.
