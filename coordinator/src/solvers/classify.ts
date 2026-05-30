import { parseExpression } from "../parser.js";
import { evaluateBoolean } from "./boolean.js";
import type { SolverKind } from "./contract.js";

/**
 * The deterministic classifier: look at an input and decide WHICH solver owns it,
 * with no model in the loop. This is the routing seam — `validate()` runs the
 * chosen solver, and the agentic coordinator can ask "what kind is this?" before
 * deciding whether to decompose.
 *
 * Recognition is by structure, in priority order:
 *   timeline  — JSON carrying an `events` array (or a bare array of events)
 *   grid      — a multi-line block of nothing but Sokoban glyphs, with structure
 *   boolean   — a numeric comparison, or a homogeneous and/or chain of them
 *   algebraic — an `=` with an alphabetic unknown (and not a bare numeric compare)
 *   political — a geopolitical/factual claim (war, treaty, country, oil/GDP, …);
 *               the deterministic core can't decide it — the web-research `political`
 *               skill does (research → comparator/timeline verdict). A heuristic tag.
 *   unknown   — free-form text; the agentic coordinator must decompose it
 */

/** Sokoban static + dynamic glyphs (microban/XSB), incl. space — the floor. */
const GRID_GLYPHS = new Set([..."#.x@$*X+ "]);

export interface Classification {
  kind: SolverKind;
  confidence: "high" | "low";
  /** Why this kind was chosen — surfaced in the validate tool's response. */
  note: string;
}

/** Does this JSON value contain a presence interval (a location + a start time)
 *  anywhere within it? Robust to the flexible timeline shapes — a list of
 *  characters, a list of interval-lists, or { characters: [...] }. */
function containsInterval(x: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (Array.isArray(x)) return x.some((e) => containsInterval(e, depth + 1));
  if (typeof x === "object" && x !== null) {
    const o = x as Record<string, unknown>;
    const hasLoc = "locationid" in o || "location" in o || "loc" in o || "place" in o;
    const hasStart = "starttime" in o || "start" in o || "from" in o;
    if (hasLoc && hasStart) return true;
    return Object.values(o).some((v) => containsInterval(v, depth + 1));
  }
  return false;
}

function looksLikeTimeline(input: string): boolean {
  const t = input.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  try {
    return containsInterval(JSON.parse(t));
  } catch {
    return false;
  }
}

function looksLikeGrid(input: string): boolean {
  const lines = input.replace(/\r/g, "").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length < 2) return false; // a single line is a comparison/equation, not a grid

  let walls = 0;
  let players = 0;
  for (const line of lines) {
    if (line.length === 0) return false; // a blank interior line -> not a clean grid block
    for (const ch of line) {
      if (!GRID_GLYPHS.has(ch)) return false; // any foreign char rules out a grid
      if (ch === "#") walls++;
      if (ch === "@" || ch === "X" || ch === "+") players++;
    }
  }
  // A real puzzle has at least one wall and exactly one player.
  return walls > 0 && players === 1;
}

function looksLikeAlgebra(input: string): boolean {
  if (parseExpression(input)) return false; // "5 = 5" is a numeric comparison, not algebra
  return input.includes("=") && /[a-zA-Z]/.test(input);
}

/**
 * Heuristic: does this free-NL statement carry geopolitical/factual-claim signals
 * (conflicts, statecraft, blocs, named wars, or resource/economy comparisons)? It
 * is deliberately a HINT, not a verdict — only reached after the structural kinds
 * are ruled out, and the `political` skill makes the final routing/answer call. A
 * false positive merely labels a clause "political" for the skill to research; it
 * never decides truth here. People-relation questions (no geo signal) stay unknown
 * so they route to connect-people instead.
 */
function looksLikeGeopolitical(input: string): boolean {
  return [
    // conflicts & statecraft
    /\b(wars?|treat(?:y|ies)|borders?|invasions?|invaded?|annex(?:ed|ation)?|sovereignty|alliances?|sanctions?|coup|ceasefire|armistice|independence|colon(?:y|ial|ies)|empires?|referendum)\b/i,
    // governance & actors
    /\b(president|presidency|prime minister|chancellor|monarch|parliament|congress|senate|government|elections?|regime|dictator|nations?|count(?:ry|ries))\b/i,
    // institutions / blocs (whole-word, incl. acronyms)
    /\b(NATO|United Nations|European Union|UN|EU|WHO|OPEC|G7|G20|Commonwealth)\b/,
    // resource / economy comparisons (the "more X than" geopolitics)
    /\b(oil|petroleum|gas|GDP|economy|economic|reserves?|exports?|imports?|population|military|nuclear|army|navy|territory|landmass|currency)\b/i,
    // named wars / eras
    /\b(world war|ww[12i]|cold war|civil war|gulf war|vietnam war)\b/i,
  ].some((re) => re.test(input));
}

export function classify(input: string): Classification {
  if (looksLikeTimeline(input)) {
    return { kind: "timeline", confidence: "high", note: "JSON list of characters with presence intervals" };
  }
  if (looksLikeGrid(input)) {
    return { kind: "grid", confidence: "high", note: "ASCII grid of Sokoban glyphs" };
  }
  if (parseExpression(input)) {
    return { kind: "boolean", confidence: "high", note: "single numeric comparison" };
  }
  if (evaluateBoolean(input)) {
    return { kind: "boolean", confidence: "high", note: "symbolic and/or comparison chain" };
  }
  if (looksLikeAlgebra(input)) {
    return { kind: "algebraic", confidence: "high", note: "equation(s) with unknown(s)" };
  }
  if (looksLikeGeopolitical(input)) {
    return {
      kind: "political",
      confidence: "low",
      note: "geopolitical/factual claim — route to the political web-research skill (research → comparator/timeline verdict)",
    };
  }
  return {
    kind: "unknown",
    confidence: "low",
    note: "free-form input — the agentic coordinator must decompose it into atomic comparisons",
  };
}
