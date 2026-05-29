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
  /** Set when a deferred section was escalated to the agentic coordinator. */
  agentic?: { answer: string; value: boolean | null; trace: string[] };
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

  return { input, sections, composition: compose(sections) };
}

/** Compose the section verdicts into one summary line. */
function compose(sections: Section[]): string {
  if (sections.length === 0) return "empty";
  if (sections.every((s) => s.kind === "boolean" && s.valid !== null)) {
    // All binary → fold the and/or connectors into one truth.
    let acc = sections[0].valid as boolean;
    for (let i = 1; i < sections.length; i++) {
      acc = sections[i].connector === "or" ? acc || (sections[i].valid as boolean) : acc && (sections[i].valid as boolean);
    }
    return `boolean composition → ${acc}`;
  }
  // Unresolved only if a deferred section was neither decided nor escalated.
  if (sections.some((s) => s.type === "deferred" && s.valid === null && !s.agentic)) {
    return "compound with unresolved section(s) — escalate to the agentic layer";
  }
  if (sections.some((s) => s.agentic)) {
    return "mixed compound → deterministic sections + agentic-resolved section(s), each answered above";
  }
  if (sections.length === 1) return `single ${sections[0].type} section → ${sections[0].valid}`;
  return "mixed-domain compound → each section answered independently above";
}

/**
 * Resolve every DEFERRED (free-NL) section by escalating it to the agentic
 * coordinator — `resolve` runs `validate-smart` on the clause and returns its
 * answer, a parsed boolean (if any), and the delegation trace. Deterministic
 * sections are left untouched. The deterministic core has no `resolve`; only the
 * agentic server wires one in, which keeps the layering intact.
 */
export async function escalateBreakdown(
  b: Breakdown,
  resolve: (clause: string) => Promise<{ answer: string; value: boolean | null; trace: string[] }>,
): Promise<Breakdown> {
  const sections = await Promise.all(
    b.sections.map(async (s): Promise<Section> => {
      if (s.type !== "deferred") return s;
      const r = await resolve(s.clause);
      return { ...s, tool: "agentic coordinator (validate-smart)", valid: r.value, reason: r.answer || s.reason, agentic: r };
    }),
  );
  return { input: b.input, sections, composition: compose(sections) };
}

/** A readable, verifiable rendering of the breakdown. */
export function renderBreakdown(b: Breakdown): string {
  const lines = [`breakdown of: "${b.input}"`];
  for (const s of b.sections) {
    const conn = s.connector ? `(${s.connector}) ` : "";
    const verdict = s.valid === null ? "deferred" : String(s.valid);
    lines.push(`  [${s.index}] ${conn}${s.type}${s.agentic ? " → escalated" : ""} · ${s.kind} · ${s.tool}`);
    lines.push(`        "${s.clause}"  →  ${verdict}   (${s.reason})`);
    if (s.agentic && s.agentic.trace.length > 0) {
      for (const t of s.agentic.trace) lines.push(`           ${t}`);
    }
  }
  lines.push(`  ⇒ ${b.composition}`);
  return lines.join("\n");
}
