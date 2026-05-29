import type { SolveResult } from "../delegator/solve.js";
import type { AlgebraicResult } from "../delegator/algebraic.js";
import type { TimelineResult } from "../delegator/timeline.js";

/**
 * The uniform contract every lips solver speaks.
 *
 * The classifier routes an input to a solver; the solver answers in this one
 * shape, so the MCP surface, the agentic coordinator, and the test corpus can
 * all treat "is this solvable / satisfied / reachable / true?" identically,
 * regardless of domain:
 *
 *   grid      -> solvable?         witness = the winning grid
 *   algebraic -> uniquely solved?  witness = the solution map
 *   timeline  -> A reaches all?    witness = the propagation chain   (Phase 4)
 *   boolean   -> evaluates true?   witness = the evaluated atoms
 *
 * `valid` is always the core yes/no. `witness` is the proof for it (or null).
 * `metrics` is a flat bag of domain numbers (moves, unknowns, hops, ...) for
 * the corpus to assert against and the tuning harness to track.
 */

export type SolverKind = "grid" | "algebraic" | "timeline" | "boolean" | "unknown";

export interface Verdict {
  /** Which solver produced this. */
  kind: SolverKind;
  /** The core yes/no: solvable / satisfied / reachable / true. */
  valid: boolean;
  /** A proof/trace for `valid` (path, solution, chain, atoms) — null if none. */
  witness: unknown | null;
  /** Domain metrics (moves, pushes, explored, unknowns, hops, ...). */
  metrics: Record<string, number>;
  /** Human-readable explanation, suitable for a tool's text response. */
  reason: string;
}

/** Build a metrics bag, dropping null / undefined / non-finite entries. */
export function metrics(entries: Record<string, number | null | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(entries)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Adapt the grid solver's native result into the uniform verdict. */
export function fromGrid(r: SolveResult): Verdict {
  return {
    kind: "grid",
    valid: r.solvable,
    witness: r.solvable ? r.winning : null,
    metrics: metrics({
      moves: r.moves,
      pushes: r.pushes,
      explored: r.explored,
      pushed: r.pushed,
      pruned: r.pruned,
    }),
    reason: r.reason,
  };
}

/** Adapt the algebraic solver's native result into the uniform verdict. */
export function fromAlgebraic(r: AlgebraicResult): Verdict {
  return {
    kind: "algebraic",
    valid: r.ok,
    witness: r.ok ? r.solution : null,
    metrics: metrics({
      equations: r.preflight.equationCount,
      unknowns: r.preflight.unknownCount,
    }),
    reason: r.reason,
  };
}

/** Adapt the timeline solver's native result into the uniform verdict. */
export function fromTimeline(r: TimelineResult): Verdict {
  return {
    kind: "timeline",
    valid: r.ok && r.connected,
    // When everyone is reachable, the witness is the encounter walk; otherwise
    // it is the groups that never meet (directly actionable to fix the input).
    witness: !r.ok ? null : r.connected ? r.encounter : r.components,
    metrics: metrics({
      characters: r.characters.length,
      interactions: r.edges.length,
      components: r.components.length,
    }),
    reason: r.reason,
  };
}
