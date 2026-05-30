/**
 * The solver's output is split into three carry-forward artifacts so a later
 * `optimize` call never has to re-analyse the grid:
 *
 *   plan      — the solution as PUSH VECTORS (box, direction, length): the
 *               "reference vectors". An optimizer condenses these directly.
 *   analysis  — the vectorial heuristics (box→goal assignment, the admissible
 *               lower bound) that let a bounded re-search prune hard.
 *   ascii     — a colourised, user-friendly view: the attempted grid, the box
 *               trails, the per-vector breakdown, and the player route + counts.
 *
 * This module is the shared home for those types, the vector builder, and the
 * renderer; the solver and the optimizer both produce them in the same shape.
 */

export type Dir = "U" | "D" | "L" | "R";

/** A run of single-cell pushes of one box in one direction — a slide vector. */
export interface PlanStep {
  /** Start cell of the box for this slide (row-major index). */
  box: number;
  row: number;
  col: number;
  dir: Dir;
  /** Number of cells the box slides. */
  len: number;
  /** True if the slide ends on a box goal. */
  ontoGoal: boolean;
}

export interface Assignment {
  box: number; // start cell
  goal: number; // goal cell it ends on
  lb: number; // admissible lower-bound pushes (goal-distance at the start cell)
}

/** Vectorial heuristics that accelerate a further optimizer call. */
export interface GridAnalysis {
  w: number;
  h: number;
  boxes: number[]; // start cells
  goals: number[];
  /** Admissible lower bound on pushes (sum of each box's nearest-goal distance). */
  lowerBound: number;
  assignment: Assignment[];
}

const DELTA_DIR = (delta: number, w: number): Dir =>
  delta === -w ? "U" : delta === w ? "D" : delta === -1 ? "L" : "R";

const ARROW: Record<Dir, string> = { U: "↑", D: "↓", L: "←", R: "→" };

/**
 * Condense an ordered list of single-cell pushes ({box, to}) into slide vectors:
 * consecutive pushes of the SAME box in the SAME direction merge into one run.
 */
export function buildVectors(pushes: { box: number; to: number }[], w: number, boxGoals: Set<number>): PlanStep[] {
  const out: PlanStep[] = [];
  let toCell = -1;
  let dir = 0;
  for (const { box, to } of pushes) {
    const d = to - box;
    const last = out[out.length - 1];
    if (last !== undefined && toCell === box && dir === d) {
      last.len += 1;
      last.ontoGoal = boxGoals.has(to);
    } else {
      out.push({ box, row: Math.floor(box / w), col: box % w, dir: DELTA_DIR(d, w), len: 1, ontoGoal: boxGoals.has(to) });
    }
    toCell = to;
    dir = d;
  }
  return out;
}

/** A player route (cells) → a compact arrow string of the moves between them. */
export function routeArrows(route: number[], w: number): string {
  let s = "";
  for (let i = 1; i < route.length; i++) {
    s += ARROW[DELTA_DIR(route[i] - route[i - 1], w)];
  }
  return s;
}

// ─── colour ──────────────────────────────────────────────────────────────────

const ESC = "\x1b[";
const C = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  gray: `${ESC}90m`,
  red: `${ESC}31m`,
  green: `${ESC}92m`,
  yellow: `${ESC}93m`,
  cyan: `${ESC}96m`,
  magenta: `${ESC}95m`,
  blue: `${ESC}94m`,
};

const wrap = (s: string, code: string, on: boolean): string => (on ? code + s + C.reset : s);

/** Colour a single lips glyph (or arrow) for terminal display. */
function paintGlyph(ch: string, on: boolean): string {
  if (!on) return ch;
  switch (ch) {
    case "#":
      return wrap(ch, C.gray, on);
    case "@":
    case "X":
    case "+": // player, player-on-goal, player-on-box-goal
      return wrap(ch, C.bold + C.green, on);
    case "$": // box
      return wrap(ch, C.yellow, on);
    case "*": // box on goal
      return wrap(ch, C.bold + C.green, on);
    case ".": // box goal
    case "x": // player goal
      return wrap(ch, C.cyan, on);
    case "↑":
    case "↓":
    case "←":
    case "→":
      return wrap(ch, C.magenta, on);
    default: // floor (space) and anything else
      return ch;
  }
}

const paintGrid = (grid: string, on: boolean): string =>
  grid
    .split("\n")
    .map((row) => [...row].map((ch) => paintGlyph(ch, on)).join(""))
    .join("\n");

/** Overlay box-slide arrows onto a copy of the static grid (a "trail"). */
function trailGrid(attempted: string, plan: PlanStep[], w: number): string {
  const rows = attempted.split("\n").map((r) => [...r]);
  const inB = (r: number, c: number): boolean => r >= 0 && r < rows.length && c >= 0 && c < (rows[r]?.length ?? 0);
  for (const v of plan) {
    let r = v.row;
    let c = v.col;
    const dr = v.dir === "U" ? -1 : v.dir === "D" ? 1 : 0;
    const dc = v.dir === "L" ? -1 : v.dir === "R" ? 1 : 0;
    for (let k = 0; k < v.len; k++) {
      r += dr;
      c += dc;
      if (!inB(r, c)) break;
      const cur = rows[r][c];
      if (cur === "#" || cur === "." || cur === "x") continue; // keep walls/goals legible
      rows[r][c] = ARROW[v.dir];
    }
  }
  return rows.map((r) => r.join("")).join("\n");
}

export interface RenderStats {
  moves: number;
  pushes: number;
  optimal: boolean;
  mode: string;
}

/**
 * Render the full user-friendly view. `color` defaults on (terminals); pass
 * false for plain text. Side-by-side attempted/solved grids, a trail overlay,
 * the per-vector breakdown, and the player route.
 */
export function renderSolution(
  attempted: string,
  winning: string,
  plan: PlanStep[],
  route: number[],
  analysis: GridAnalysis,
  stats: RenderStats,
  color = true,
): string {
  const { w } = analysis;
  const head = `${stats.moves} moves / ${stats.pushes} pushes · ${stats.optimal ? "OPTIMAL" : `${stats.mode} (a solution, not minimal)`}`;
  const meta = `${w}×${analysis.h} · ${analysis.boxes.length} box(es) · lower bound ${analysis.lowerBound} pushes`;

  const aRows = paintGrid(attempted, color).split("\n");
  const tRows = paintGrid(trailGrid(attempted, plan, w), color).split("\n");
  const colW = Math.max(...attempted.split("\n").map((r) => r.length), "attempted".length);
  const lpad = (s: string, n: number): string => s + " ".repeat(Math.max(0, n - [...s.replace(/\x1b\[[0-9;]*m/g, "")].length));
  const rows: string[] = [];
  const label = (s: string): string => wrap(s, C.gray, color);
  rows.push(`${lpad(label("attempted"), colW)}   ${label("solved (box trails)")}`);
  const n = Math.max(aRows.length, tRows.length);
  for (let i = 0; i < n; i++) rows.push(`${lpad(aRows[i] ?? "", colW)}   ${tRows[i] ?? ""}`);

  const vec = plan
    .map((v, i) => {
      const arrows = ARROW[v.dir].repeat(v.len);
      const tail = v.ontoGoal ? wrap(" ✓goal", C.cyan, color) : "";
      return `  ${wrap(String(i + 1).padStart(2), C.bold, color)}. box(${v.row},${v.col}) ${wrap(arrows, C.magenta, color)}${tail}`;
    })
    .join("\n");

  const arrows = routeArrows(route, w);
  const shownRoute = arrows.length > 80 ? arrows.slice(0, 79) + "…" : arrows;

  return [
    `${wrap("═══ lips · sokoban ", C.bold + C.cyan, color)}${wrap("═".repeat(28), C.cyan, color)}`,
    `${wrap(head, C.bold, color)}`,
    label(meta),
    "",
    ...rows,
    "",
    `${label("pushes (vectors):")}`,
    vec || "  (none)",
    "",
    `${label(`player route (${route.length > 0 ? route.length - 1 : 0} moves):`)} ${wrap(shownRoute, C.magenta, color)}`,
  ].join("\n");
}
