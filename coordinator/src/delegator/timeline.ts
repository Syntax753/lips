import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";

/**
 * The TIMELINE delegator — character-encounter reachability.
 *
 * The game: the player can "switch" between two characters whenever they
 * INTERACT, meaning they are in the same place at the same time. Each character
 * is a list of presence intervals { starttime, endtime, locationid }. Two
 * characters interact if some interval of one shares a `locationid` with some
 * interval of the other AND their time ranges overlap.
 *
 * Validation: starting as ANY character, can the player encounter EVERY other
 * character through a chain of switches? That is exactly: is the undirected
 * co-location graph over characters CONNECTED (a single component)? "Any
 * direction" — switching is symmetric and carries no time-ordering constraint;
 * a connected graph means every character is reachable from every other.
 *
 * Two documented defaults (flip if the game needs it):
 *   - time overlap is INCLUSIVE: touching at a shared endpoint (X ends at t,
 *     Y starts at t) counts as being there "at the same time";
 *   - a single character is trivially valid (you have encountered everyone).
 */

// ─── input model + permissive parsing ───────────────────────────────────────

export interface Interval {
  starttime: number;
  endtime: number;
  locationid: string;
}

export interface Character {
  id: string;
  intervals: Interval[];
}

/** Coerce a time value: a number, a numeric string, or an ISO date string. */
function toTime(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    if (/^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
    const d = Date.parse(v);
    return Number.isNaN(d) ? null : d;
  }
  return null;
}

function field(obj: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) if (n in obj) return obj[n];
  return undefined;
}

function parseInterval(raw: unknown, where: string): Interval | string {
  if (typeof raw !== "object" || raw === null) return `${where}: interval must be an object`;
  const o = raw as Record<string, unknown>;
  const s = toTime(field(o, "starttime", "start", "from", "t0"));
  const e = toTime(field(o, "endtime", "end", "to", "t1"));
  const locRaw = field(o, "locationid", "location", "loc", "place", "where");
  if (s === null || e === null) return `${where}: interval needs numeric starttime and endtime`;
  if (locRaw === undefined || locRaw === null) return `${where}: interval needs a locationid`;
  // Tolerate reversed ranges by normalising rather than rejecting.
  const start = Math.min(s, e);
  const end = Math.max(s, e);
  return { starttime: start, endtime: end, locationid: String(locRaw) };
}

/**
 * Parse the flexible input into characters. Accepts:
 *   - a list of characters, each an object { id?, intervals|timeline: [...] }
 *   - a list of characters, each a bare list of intervals (id = "char{i}")
 *   - { characters: [ ...either of the above... ] }
 */
export function parseTimeline(input: unknown): { characters: Character[] } | { error: string } {
  let list: unknown = input;
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    list = (input as { characters?: unknown }).characters;
  }
  if (!Array.isArray(list)) return { error: "expected a list of characters (or { characters: [...] })" };
  if (list.length === 0) return { error: "no characters given" };

  const characters: Character[] = [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    let id = `char${i}`;
    let intervalsRaw: unknown;
    if (Array.isArray(raw)) {
      intervalsRaw = raw;
    } else if (typeof raw === "object" && raw !== null) {
      const o = raw as Record<string, unknown>;
      const idRaw = field(o, "id", "name", "character");
      if (typeof idRaw === "string" && idRaw.length > 0) id = idRaw;
      else if (typeof idRaw === "number") id = String(idRaw);
      intervalsRaw = field(o, "intervals", "timeline", "presence", "appearances");
    } else {
      return { error: `character ${i} must be a list of intervals or an object` };
    }
    if (!Array.isArray(intervalsRaw)) return { error: `character "${id}" has no interval list` };
    const intervals: Interval[] = [];
    for (let j = 0; j < intervalsRaw.length; j++) {
      const iv = parseInterval(intervalsRaw[j], `character "${id}" interval ${j}`);
      if (typeof iv === "string") return { error: iv };
      intervals.push(iv);
    }
    characters.push({ id, intervals });
  }
  return { characters };
}

// ─── the solve: co-location graph connectivity ───────────────────────────────

/** Two intervals interact: same location and inclusive time overlap. */
function interacts(a: Interval, b: Interval): boolean {
  return (
    a.locationid === b.locationid &&
    Math.max(a.starttime, b.starttime) <= Math.min(a.endtime, b.endtime)
  );
}

/** A representative meeting between two characters (for the witness). */
export interface Edge {
  a: string;
  b: string;
  locationid: string;
  /** The window during which they are co-located: [start, end]. */
  start: number;
  end: number;
}

/** One step of the encounter walk: arrive as `from`, switch to `to` at a meeting. */
export interface EncounterStep {
  from: string;
  to: string;
  locationid: string;
  start: number;
  end: number;
}

// A `type` (not an interface) so it stays assignable to the SDK tool's
// structuredContent index signature — same reason as AlgebraicResult.
export type TimelineResult = {
  ok: boolean; // input parsed and well-formed
  connected: boolean; // the validation: encounter everyone from anyone
  characters: string[];
  /** Representative interactions (one per interacting pair). */
  edges: Edge[];
  /** A walk that reaches every character from the first (only when connected). */
  encounter: EncounterStep[];
  /** Groups that never meet (length > 1 exactly when NOT connected). */
  components: string[][];
  reason: string;
}

/** Find the first co-located overlapping interval pair between two characters. */
function meeting(x: Character, y: Character): { locationid: string; start: number; end: number } | null {
  for (const a of x.intervals) {
    for (const b of y.intervals) {
      if (interacts(a, b)) {
        return {
          locationid: a.locationid,
          start: Math.max(a.starttime, b.starttime),
          end: Math.min(a.endtime, b.endtime),
        };
      }
    }
  }
  return null;
}

export function solveTimeline(input: unknown): TimelineResult {
  const parsed = parseTimeline(input);
  if ("error" in parsed) {
    return { ok: false, connected: false, characters: [], edges: [], encounter: [], components: [], reason: parsed.error };
  }
  const chars = parsed.characters;
  const ids = chars.map((c) => c.id);
  const n = chars.length;

  // Build the undirected co-location graph: an edge per interacting pair.
  const edges: Edge[] = [];
  const adj: number[][] = Array.from({ length: n }, () => []);
  const edgeAt = new Map<string, { locationid: string; start: number; end: number }>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const m = meeting(chars[i], chars[j]);
      if (!m) continue;
      edges.push({ a: ids[i], b: ids[j], ...m });
      adj[i].push(j);
      adj[j].push(i);
      edgeAt.set(`${i},${j}`, m);
      edgeAt.set(`${j},${i}`, m);
    }
  }

  // Connected components via BFS; the first component also yields the encounter
  // walk (the spanning tree from character 0).
  const comp = new Array<number>(n).fill(-1);
  const components: string[][] = [];
  const encounter: EncounterStep[] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const cid = components.length;
    const group: string[] = [];
    const queue = [s];
    comp[s] = cid;
    for (let hd = 0; hd < queue.length; hd++) {
      const u = queue[hd];
      group.push(ids[u]);
      for (const v of adj[u]) {
        if (comp[v] !== -1) continue;
        comp[v] = cid;
        if (cid === 0) {
          const m = edgeAt.get(`${u},${v}`)!;
          encounter.push({ from: ids[u], to: ids[v], locationid: m.locationid, start: m.start, end: m.end });
        }
        queue.push(v);
      }
    }
    components.push(group);
  }

  const connected = components.length === 1;
  const reason = connected
    ? n === 1
      ? `the lone character "${ids[0]}" is trivially reachable`
      : `all ${n} characters are mutually reachable — from any one the player can encounter every other through ${edges.length} co-located interaction(s)`
    : `${components.length} separate groups that never meet: ${components.map((g) => `{${g.join(", ")}}`).join(" | ")} — the player cannot cross between them`;

  return { ok: true, connected, characters: ids, edges, encounter, components, reason };
}

// ─── the delegator tool ──────────────────────────────────────────────────────

export const reachableTool = tool(
  "reachable",
  "Decide whether a player who can SWITCH between co-located characters can encounter EVERY character starting from any one. Input: a list of characters, each a list of presence intervals { starttime, endtime, locationid }. Two characters interact when they share a locationid during overlapping time; the answer is whether the resulting co-location graph is CONNECTED. Returns { ok, connected, characters, edges, encounter, components, reason } — `connected` is the verdict, `encounter` is a walk reaching everyone, `components` are the unreachable groups when it is false.",
  {
    characters: z
      .array(z.unknown())
      .describe('list of characters; each is { id?, intervals: [{starttime,endtime,locationid}] } or a bare interval list'),
  },
  async (args) => {
    const r = solveTimeline(args.characters);
    return { content: [{ type: "text", text: `connected=${r.connected} — ${r.reason}` }], structuredContent: r };
  },
);
