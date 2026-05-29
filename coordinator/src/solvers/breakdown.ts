import { validate } from "./validate.js";
import type { SolverKind } from "./contract.js";

/**
 * Decompose a compound statement into its sections and show, per section, how it
 * was classified and which deterministic leaf analysed it — so a caller can
 * VERIFY the breakdown (which parts are simple BINARY truths, which need deeper
 * ANALYSIS) rather than trust an opaque answer.
 *
 * This is the deterministic view: it splits on top-level `and`/`or`, classifies
 * and runs each clause through `validate`, and composes boolean sections by their
 * connectors. It is reliable for SYMBOLIC/structured clauses (comparisons, bare
 * equations, grids, timelines). Free natural language inside a clause classifies
 * as `unknown` → flagged "deferred (agentic)": that is the `validate-smart`
 * coordinator's job, whose own delegation trace is the agentic counterpart of this.
 */

export type SectionType = "binary" | "analysed" | "deferred";

export interface Section {
  index: number;
  clause: string;
  /** "and" / "or" joining this section to the previous one (null for the first). */
  connector: "and" | "or" | null;
  kind: SolverKind;
  type: SectionType;
  /** The deterministic leaf / analysis that handled this clause. */
  tool: string;
  /** The verdict, or null when deferred. */
  valid: boolean | null;
  reason: string;
}

export interface Breakdown {
  input: string;
  sections: Section[];
  composition: string;
}

const TYPE: Record<SolverKind, SectionType> = {
  boolean: "binary",
  algebraic: "analysed",
  timeline: "analysed",
  grid: "analysed",
  unknown: "deferred",
};

/** Strip light interrogative wrapping ("is … solvable?") so a bare symbolic
 *  clause survives to its classifier. The original clause is still displayed. */
function normalizeClause(c: string): string {
  return c
    .replace(/\?+\s*$/, "")
    .replace(/^\s*(is|are|does|do|can|could|will|would|was|were|has|have)\b\s*/i, "")
    .replace(/\s+\b(solvable|valid|true|false|possible|correct|right|connected|related)\b\s*$/i, "")
    .trim();
}

function toolFor(kind: SolverKind, clause: string): string {
  switch (kind) {
    case "boolean":
      return "comparator — boolean truth";
    case "algebraic":
      return /\^/.test(clause) ? "nonlinear analyzer (ℝ/ℂ)" : "linear system solver";
    case "timeline":
      return "reachable — timeline connectivity";
    case "grid":
      return "sokoban solver";
    default:
      return "needs agentic layer (validate-smart / connect-people)";
  }
}

export function breakdown(input: string): Breakdown {
  // Split into top-level clauses on `and`/`or`, keeping the connectors; drop '?'.
  const pieces = input.replace(/\?+/g, " ").split(/\s+\b(and|or)\b\s+/i);
  const sections: Section[] = [];
  let connector: "and" | "or" | null = null;
  for (const raw of pieces) {
    const piece = raw.trim();
    if (!piece) continue;
    const low = piece.toLowerCase();
    if (low === "and" || low === "or") {
      connector = low;
      continue;
    }
    const v = validate(normalizeClause(piece));
    sections.push({
      index: sections.length + 1,
      clause: piece,
      connector,
      kind: v.kind,
      type: TYPE[v.kind],
      tool: toolFor(v.kind, piece),
      valid: v.kind === "unknown" ? null : v.valid,
      reason: v.reason,
    });
    connector = null;
  }

  let composition: string;
  if (sections.length === 0) {
    composition = "empty";
  } else if (sections.every((s) => s.kind === "boolean" && s.valid !== null)) {
    // All binary → fold the and/or connectors into one truth.
    let acc = sections[0].valid as boolean;
    for (let i = 1; i < sections.length; i++) {
      acc = sections[i].connector === "or" ? acc || (sections[i].valid as boolean) : acc && (sections[i].valid as boolean);
    }
    composition = `boolean composition → ${acc}`;
  } else if (sections.length === 1) {
    composition = sections[0].valid === null ? "single section → deferred to the agentic layer" : `single ${sections[0].type} section → ${sections[0].valid}`;
  } else {
    composition = "mixed-domain compound → each section answered independently above";
  }
  return { input, sections, composition };
}

/** A readable, verifiable rendering of the breakdown. */
export function renderBreakdown(b: Breakdown): string {
  const lines = [`breakdown of: "${b.input}"`];
  for (const s of b.sections) {
    const conn = s.connector ? `(${s.connector}) ` : "";
    const verdict = s.valid === null ? "deferred" : String(s.valid);
    lines.push(`  [${s.index}] ${conn}${s.type} · ${s.kind} · ${s.tool}`);
    lines.push(`        "${s.clause}"  →  ${verdict}   (${s.reason})`);
  }
  lines.push(`  ⇒ ${b.composition}`);
  return lines.join("\n");
}
