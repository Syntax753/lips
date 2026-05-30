import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { getRuleSet, DEFAULT_RULESET } from "../rules/index.js";
import type { RuleSet } from "../rules/index.js";
import { logVerbose, getLogLevel } from "../logger.js";
import { buildVectors, renderSolution, type PlanStep, type GridAnalysis, type Dir } from "./plan.js";

/**
 * Deterministic Sokoban resolver. Instead of searching every player STEP, it
 * searches over PUSHES with an equivalence collapse: two states are equivalent
 * when they have the same boxes and the player can walk between them without
 * pushing (a reversible move). Each equivalence class = (box layout, the
 * player's reachable region); the search branches only on pushes, which kills
 * the player-walking explosion. Costs are real player steps (walk-to-push + 1).
 *
 * It is A* ordered by f = g + W·h: g is the player-step cost so far, and h is an
 * admissible lower bound — the sum over boxes of each box's minimum pushes to
 * the nearest goal (see `goalDistances`). With W = 1 the heuristic only guides
 * the search, so `moves` is still the true minimum; W > 1 trades optimality for
 * reach. The frontier breaks ties by FEWEST equivalent states (smallest region).
 * Dead branches are pruned by simple-deadlock (a push onto a cell no box can
 * leave toward a goal) and freeze-deadlock (a box pinned off-goal forever); both
 * the heuristic and pruning need every box to map to a goal, so they engage only
 * when #boxes === #box goals (otherwise h = 0, i.e. plain uniform-cost). Each
 * popped state is logged live.
 *
 * LIPS_SEARCH=rooms switches to a room-guided SATISFICING search for boards too
 * large to solve optimally: the grid is split into rooms joined by doorways (see
 * `analyzeRooms`), and the frontier is ordered greedily by uncovered goals, then
 * boxes still outside a goal-bearing room, then total goal distance — driving
 * boxes out of reservoir rooms toward goals. It returns the FIRST solution it
 * finds, so `moves` is no longer guaranteed minimal.
 */

export type SearchMode = "auto" | "optimal" | "rooms" | "decompose";

export type SolveResult = {
  ok: boolean;
  solvable: boolean;
  ruleset: string;
  /** True only when `moves` is the proven minimum (optimal search succeeded). */
  optimal: boolean;
  /** The search that produced this ("optimal" | "rooms" | "decompose"). */
  mode: string;
  moves: number | null; // player steps (the MINIMUM when optimal; otherwise just a solution's length)
  pushes: number | null; // box pushes in the solution
  explored: number; // equivalence classes dequeued
  pushed: number; // classes added to the frontier
  pruned: number; // classes skipped (already reached at <= cost)
  path: string[] | null; // start .. winning grid, per player step (capped)
  winning: string | null;
  /** Solution as push VECTORS (the reference vectors an optimizer condenses). */
  plan: PlanStep[] | null;
  /** Player cells per step (route), for rendering — capped. */
  route: number[] | null;
  /** Vectorial heuristics (assignment, lower bound) to seed a further optimize call. */
  analysis: GridAnalysis | null;
  reason: string;
};

const MAX_TRACE = 1000; // cap on live-logged states (the search itself is unbounded here)
const MAX_PATH = 250; // cap on per-step grids returned in the result (keeps it small)
const MAX_EXPLORED = Number(process.env.LIPS_MAX_STATES ?? 1_500_000);

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, 0],
];

/** The fixed (non-moving) layer of a grid, plus the dynamic start state. */
type Parsed = {
  w: number;
  h: number;
  walls: Set<number>;
  boxGoals: Set<number>;
  playerGoal: number | null;
  floor: string;
  rs: RuleSet;
  boxes: Set<number>;
  player: number;
};

function parse(grid: string, rs: RuleSet): Parsed | { error: string } {
  // Floor is a space (microban/XSB); anything not a wall/box/goal/player glyph is
  // implicitly floor, so spaces are left as-is (and `.` is a box goal, not floor).
  const rows = grid.replace(/\r/g, "").split("\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  if (rows.length === 0) return { error: "empty grid" };
  const w = rows[0].length;
  if (!rows.every((r) => r.length === w)) return { error: "grid rows must all be the same width" };
  const h = rows.length;

  const walls = new Set<number>();
  const boxGoals = new Set<number>();
  const boxes = new Set<number>();
  let playerGoal: number | null = null;
  let player = -1;
  let players = 0;

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const cell = r * w + c;
      const g = rows[r][c];
      if (g === rs.wall) walls.add(cell);
      const isPlayer = g === "@" || g === rs.playerOnGoal || g === rs.playerOnBoxGoal;
      const isBox = g === rs.box || g === rs.boxOnGoal;
      if (isPlayer) {
        player = cell;
        players++;
      }
      if (isBox) boxes.add(cell);
      if (g === rs.goal || g === rs.playerOnGoal) playerGoal = cell; // 'x' or player on it 'X'
      if (g === rs.boxGoal || g === rs.boxOnGoal || g === rs.playerOnBoxGoal) boxGoals.add(cell); // '.','*','+'
    }
  }
  if (players !== 1) return { error: `expected exactly one player, found ${players}` };
  return { w, h, walls, boxGoals, playerGoal, floor: rs.floor, rs, boxes, player };
}

/** Render a (boxes, player) state back to a grid string using the static layer. */
function render(p: Parsed, boxes: Set<number>, player: number): string {
  const rows: string[] = [];
  for (let r = 0; r < p.h; r++) {
    let row = "";
    for (let c = 0; c < p.w; c++) {
      const cell = r * p.w + c;
      if (p.walls.has(cell)) row += p.rs.wall ?? "#";
      else if (cell === player)
        row +=
          cell === p.playerGoal
            ? p.rs.playerOnGoal ?? "@"
            : p.boxGoals.has(cell)
              ? p.rs.playerOnBoxGoal ?? "@"
              : "@";
      else if (boxes.has(cell)) row += p.boxGoals.has(cell) ? p.rs.boxOnGoal ?? "*" : p.rs.box ?? "$";
      else if (cell === p.playerGoal) row += p.rs.goal ?? "x";
      else if (p.boxGoals.has(cell)) row += p.rs.boxGoal ?? ".";
      else row += p.floor;
    }
    rows.push(row);
  }
  return rows.join("\n");
}

function compact(grid: string): string {
  return grid.split("\n").join("/");
}

const boxesKey = (boxes: Set<number>): string => [...boxes].sort((a, b) => a - b).join(",");

/** Parse the box cells back out of a class key ("c1,c2,…|canonical"). */
function parseBoxes(key: string): Set<number> {
  const cut = key.indexOf("|");
  const head = cut < 0 ? key : key.slice(0, cut);
  const boxes = new Set<number>();
  if (head.length > 0) for (const t of head.split(",")) boxes.add(Number(t));
  return boxes;
}

/** BFS over walkable cells (not wall, not box) from `player`: distances + parents. */
function walkBFS(p: Parsed, boxes: Set<number>, player: number): { dist: Map<number, number>; prev: Map<number, number> } {
  const dist = new Map<number, number>([[player, 0]]);
  const prev = new Map<number, number>();
  const queue = [player];
  let head = 0;
  while (head < queue.length) {
    const cell = queue[head++];
    const r = Math.floor(cell / p.w);
    const c = cell % p.w;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= p.h || nc < 0 || nc >= p.w) continue;
      const n = nr * p.w + nc;
      if (dist.has(n) || p.walls.has(n) || boxes.has(n)) continue;
      dist.set(n, (dist.get(cell) ?? 0) + 1);
      prev.set(n, cell);
      queue.push(n);
    }
  }
  return { dist, prev };
}

/** The player's reachable region: its size and a canonical (min cell) id. */
function regionInfo(p: Parsed, boxes: Set<number>, player: number): { size: number; canonical: number } {
  const seen = new Set<number>([player]);
  const queue = [player];
  let head = 0;
  let canonical = player;
  while (head < queue.length) {
    const cell = queue[head++];
    if (cell < canonical) canonical = cell;
    const r = Math.floor(cell / p.w);
    const c = cell % p.w;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= p.h || nc < 0 || nc >= p.w) continue;
      const n = nr * p.w + nc;
      if (seen.has(n) || p.walls.has(n) || boxes.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return { size: seen.size, canonical };
}

/**
 * For every cell, the minimum number of PUSHES to get a box from there onto the
 * NEAREST box goal — a multi-source "pull" BFS from all goals (the reverse of a
 * push: a box can be pulled `c -> c+d` only if `c+d` and `c+2d`, where the
 * player must stand to pull, are both non-wall). Cells never reached are dead
 * (Infinity): a box there can never cover a goal. The analysis ignores other
 * boxes and player navigation, so each distance is an admissible lower bound on
 * the real pushes, and a cell is only marked dead when it is dead regardless.
 *
 * This one table drives both the A* heuristic (sum over boxes) and simple-
 * deadlock pruning (a push onto an Infinity cell).
 */
function goalDistances(p: Parsed): number[] {
  const dist = new Array<number>(p.w * p.h).fill(Infinity);
  const queue: number[] = [];
  for (const g of p.boxGoals)
    if (dist[g] === Infinity) {
      dist[g] = 0;
      queue.push(g);
    }
  let head = 0;
  while (head < queue.length) {
    const c = queue[head++];
    const cr = Math.floor(c / p.w);
    const cc = c % p.w;
    for (const [dr, dc] of DIRS) {
      const tr = cr + dr;
      const tc = cc + dc; // where the box is pulled to
      const sr = cr + 2 * dr;
      const sc = cc + 2 * dc; // where the player stands to pull it
      if (tr < 0 || tr >= p.h || tc < 0 || tc >= p.w) continue;
      if (sr < 0 || sr >= p.h || sc < 0 || sc >= p.w) continue;
      const to = tr * p.w + tc;
      const pull = sr * p.w + sc;
      if (p.walls.has(to) || p.walls.has(pull)) continue;
      if (dist[to] === Infinity) {
        dist[to] = dist[c] + 1;
        queue.push(to);
      }
    }
  }
  return dist;
}

/**
 * Is the box on `cell` blocked along one axis? Blocked when either neighbour on
 * the axis is a wall (or off-grid, or a box we are pretending is a wall to break
 * recursion), OR both neighbours are dead squares (any push that way is futile),
 * OR a neighbouring box is itself frozen. `asWall` carries the boxes currently
 * being treated as walls up the recursion stack.
 */
function axisBlocked(p: Parsed, boxes: Set<number>, goalDist: number[], cell: number, asWall: Set<number>, horizontal: boolean): boolean {
  const r = Math.floor(cell / p.w);
  const c = cell % p.w;
  const a = horizontal ? (c - 1 >= 0 ? cell - 1 : -1) : r - 1 >= 0 ? cell - p.w : -1;
  const b = horizontal ? (c + 1 < p.w ? cell + 1 : -1) : r + 1 < p.h ? cell + p.w : -1;
  const wallLike = (x: number): boolean => x < 0 || p.walls.has(x) || asWall.has(x);
  if (wallLike(a) || wallLike(b)) return true; // a wall on either side pins this axis
  if (goalDist[a] === Infinity && goalDist[b] === Infinity) return true; // both sides dead
  for (const side of [a, b]) {
    if (boxes.has(side) && !asWall.has(side) && frozen(p, boxes, goalDist, side, asWall)) return true;
  }
  return false;
}

/** A box is frozen when it is blocked on BOTH axes — it can never move again. */
function frozen(p: Parsed, boxes: Set<number>, goalDist: number[], cell: number, asWall: Set<number>): boolean {
  asWall.add(cell); // treat this box as a wall while we probe its neighbours
  const blocked = axisBlocked(p, boxes, goalDist, cell, asWall, true) && axisBlocked(p, boxes, goalDist, cell, asWall, false);
  asWall.delete(cell);
  return blocked;
}

/**
 * Freeze deadlock after a push to `pushedTo`: if the pushed box — or any box now
 * adjacent to it — is frozen while NOT on a goal, no box there can ever reach a
 * goal, so the position is unwinnable. Sound only when every box must end on a
 * goal (the caller gates this to #boxes === #box goals).
 */
function freezeDeadlock(p: Parsed, boxes: Set<number>, goalDist: number[], pushedTo: number): boolean {
  const candidates = [pushedTo];
  const r = Math.floor(pushedTo / p.w);
  const c = pushedTo % p.w;
  for (const [dr, dc] of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= p.h || nc < 0 || nc >= p.w) continue;
    const n = nr * p.w + nc;
    if (boxes.has(n)) candidates.push(n);
  }
  for (const cell of candidates) {
    if (!p.boxGoals.has(cell) && frozen(p, boxes, goalDist, cell, new Set())) return true;
  }
  return false;
}

/**
 * Decompose the player-reachable maze into ROOMS (open areas) joined by DOORWAYS
 * (cells pinched to one tile wide). Rooms are the connected components of the
 * reachable floor once doorway cells are removed. Returns each cell's room id
 * (-1 for walls / doorways / unreachable) and which rooms contain a box goal.
 * Used by the room-guided search to prioritise pushing boxes out of goal-less
 * rooms (e.g. a box reservoir) and into rooms that actually hold goals.
 */
function analyzeRooms(p: Parsed): { roomOf: Int32Array; goalRoom: boolean[] } {
  const N = p.w * p.h;
  const roomOf = new Int32Array(N).fill(-1);
  const isWallRC = (r: number, c: number): boolean => r < 0 || r >= p.h || c < 0 || c >= p.w || p.walls.has(r * p.w + c);

  // Reachable floor (static topology: walls only, boxes ignored).
  const reach = new Uint8Array(N);
  const q = [p.player];
  reach[p.player] = 1;
  for (let hd = 0; hd < q.length; hd++) {
    const cell = q[hd];
    const r = Math.floor(cell / p.w);
    const c = cell % p.w;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (isWallRC(nr, nc)) continue;
      const n = nr * p.w + nc;
      if (reach[n]) continue;
      reach[n] = 1;
      q.push(n);
    }
  }

  // Doorway = reachable cell walled on both sides of either axis (1-wide).
  const door = new Uint8Array(N);
  for (let cell = 0; cell < N; cell++) {
    if (!reach[cell]) continue;
    const r = Math.floor(cell / p.w);
    const c = cell % p.w;
    if ((isWallRC(r - 1, c) && isWallRC(r + 1, c)) || (isWallRC(r, c - 1) && isWallRC(r, c + 1))) door[cell] = 1;
  }

  // Rooms = connected components of reachable, non-doorway cells.
  let nRooms = 0;
  for (let cell = 0; cell < N; cell++) {
    if (!reach[cell] || door[cell] || roomOf[cell] >= 0) continue;
    const id = nRooms++;
    const qq = [cell];
    roomOf[cell] = id;
    for (let hd = 0; hd < qq.length; hd++) {
      const x = qq[hd];
      const r = Math.floor(x / p.w);
      const c = x % p.w;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (isWallRC(nr, nc)) continue;
        const n = nr * p.w + nc;
        if (!reach[n] || door[n] || roomOf[n] >= 0) continue;
        roomOf[n] = id;
        qq.push(n);
      }
    }
  }

  const goalRoom = new Array<boolean>(nRooms).fill(false);
  for (const g of p.boxGoals) {
    const id = roomOf[g];
    if (id >= 0) goalRoom[id] = true;
  }
  return { roomOf, goalRoom };
}

const allCovered = (p: Parsed, boxes: Set<number>): boolean => {
  for (const g of p.boxGoals) if (!boxes.has(g)) return false;
  return true;
};

function walkSteps(prev: Map<number, number>, to: number): number[] {
  const cells: number[] = [];
  let cur: number | undefined = to;
  while (cur !== undefined) {
    cells.push(cur);
    cur = prev.get(cur);
  }
  return cells.reverse(); // from .. to
}

// One reached equivalence class: cheapest cost so far, plus how we got here for
// path reconstruction. The box layout is NOT stored — it lives in the class key
// and is replayed from the `via` chain at the end, which keeps this map small
// enough to hold the millions of classes a large grid produces.
type Entry = {
  g: number;
  parent: string | null;
  viaBox: number; // cell the pushed box came from (-1 for the start: no incoming push)
  viaTo: number; // cell it was pushed to
};

// Minimal binary min-heap ordered by (pri, regionSize) — lowest priority first,
// fewest-equivalent-states (smallest region) breaks ties. `pri` is the search
// key: in optimal mode it is the A* f = g + W·h; in room-guided mode it is a
// greedy score (uncovered goals, then boxes not yet in a goal room, then total
// goal distance). The components are carried so the child's values update in
// O(1): `g` real player-step cost (also used for the stale check / result), `h`
// total goal-distance, `unc` uncovered goals, `nhome` boxes outside a goal room.
type HeapItem = { key: string; player: number; g: number; h: number; unc: number; nhome: number; pri: number; region: number };
class Heap {
  private a: HeapItem[] = [];
  get size(): number {
    return this.a.length;
  }
  private less(i: number, j: number): boolean {
    return this.a[i].pri !== this.a[j].pri ? this.a[i].pri < this.a[j].pri : this.a[i].region < this.a[j].region;
  }
  push(item: HeapItem): void {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (!this.less(i, par)) break;
      [a[i], a[par]] = [a[par], a[i]];
      i = par;
    }
  }
  pop(): HeapItem | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let s = i;
        if (l < a.length && this.less(l, s)) s = l;
        if (r < a.length && this.less(r, s)) s = r;
        if (s === i) break;
        [a[i], a[s]] = [a[s], a[i]];
        i = s;
      }
    }
    return top;
  }
}

// ─── Room decomposition (LIPS_SEARCH=decompose) ────────────────────────────
// A satisficing solver for boards too large for the monolithic search: fill the
// box goals one at a time. Each placed box is LOCKED (becomes a wall), so every
// subsequent sub-search runs in a steadily smaller free space. Drops optimality.

type Push = { box: number; to: number };

/** Min pushes to move a box from each cell onto `target`, with walls and
 * `blocked` cells (locked boxes) impassable. A reverse "pull" flood. */
function pullDistFrom(p: Parsed, target: number, blocked: Set<number>): number[] {
  const dist = new Array<number>(p.w * p.h).fill(Infinity);
  dist[target] = 0;
  const q = [target];
  for (let hd = 0; hd < q.length; hd++) {
    const c = q[hd];
    const cr = Math.floor(c / p.w);
    const cc = c % p.w;
    for (const [dr, dc] of DIRS) {
      const tr = cr + dr;
      const tc = cc + dc;
      const sr = cr + 2 * dr;
      const sc = cc + 2 * dc;
      if (tr < 0 || tr >= p.h || tc < 0 || tc >= p.w) continue;
      if (sr < 0 || sr >= p.h || sc < 0 || sc >= p.w) continue;
      const to = tr * p.w + tc;
      const pull = sr * p.w + sc;
      if (p.walls.has(to) || blocked.has(to) || p.walls.has(pull) || blocked.has(pull)) continue;
      if (dist[to] === Infinity) {
        dist[to] = dist[c] + 1;
        q.push(to);
      }
    }
  }
  return dist;
}

/** goalDistances with extra `blocked` cells impassable (for deadlock checks once
 * boxes are locked). Infinity = a box there can reach no remaining goal. */
function goalDistancesBlocked(p: Parsed, blocked: Set<number>): number[] {
  const dist = new Array<number>(p.w * p.h).fill(Infinity);
  const q: number[] = [];
  for (const g of p.boxGoals) if (!blocked.has(g) && dist[g] === Infinity) ((dist[g] = 0), q.push(g));
  for (let hd = 0; hd < q.length; hd++) {
    const c = q[hd];
    const cr = Math.floor(c / p.w);
    const cc = c % p.w;
    for (const [dr, dc] of DIRS) {
      const tr = cr + dr;
      const tc = cc + dc;
      const sr = cr + 2 * dr;
      const sc = cc + 2 * dc;
      if (tr < 0 || tr >= p.h || tc < 0 || tc >= p.w) continue;
      if (sr < 0 || sr >= p.h || sc < 0 || sc >= p.w) continue;
      const to = tr * p.w + tc;
      const pull = sr * p.w + sc;
      if (p.walls.has(to) || blocked.has(to) || p.walls.has(pull) || blocked.has(pull)) continue;
      if (dist[to] === Infinity) {
        dist[to] = dist[c] + 1;
        q.push(to);
      }
    }
  }
  return dist;
}

/**
 * Greedy best-first sub-search: push ANY free box onto `target`. `boxes` holds
 * all boxes (locked ones included so they block movement); only non-locked boxes
 * are pushed. Returns the resulting state and the push chain, or null if it can't
 * within `cap` states. Single-cell pushes (no macros) — kept simple for the
 * sub-problem.
 */
function coverGoal(
  p: Parsed,
  boxes0: Set<number>,
  player0: number,
  locked: Set<number>,
  target: number,
  goalDist: number[],
  cap: number,
): { found: { boxes: Set<number>; player: number; pushes: Push[]; cost: number } | null; explored: number } {
  const tdist = pullDistFrom(p, target, locked);
  const hOf = (boxes: Set<number>): number => {
    if (boxes.has(target)) return 0;
    let m = Infinity;
    for (const b of boxes) if (!locked.has(b) && tdist[b] < m) m = tdist[b];
    return m;
  };
  if (hOf(boxes0) === Infinity) return { found: null, explored: 0 }; // no free box can ever reach target

  const reached = new Map<string, Entry>();
  const heap = new Heap();
  const s0 = regionInfo(p, boxes0, player0);
  const sKey = `${boxesKey(boxes0)}|${s0.canonical}`;
  reached.set(sKey, { g: 0, parent: null, viaBox: -1, viaTo: -1 });
  heap.push({ key: sKey, player: player0, g: 0, h: 0, unc: 0, nhome: 0, pri: hOf(boxes0), region: s0.size });
  let explored = 0;

  while (heap.size > 0) {
    const cur = heap.pop()!;
    const entry = reached.get(cur.key);
    if (!entry || entry.g !== cur.g) continue;
    const boxes = parseBoxes(cur.key);
    if (boxes.has(target)) {
      // success — reconstruct the push chain back to the start
      const pushes: Push[] = [];
      for (let k: string | null = cur.key; k !== null; ) {
        const e: Entry = reached.get(k)!;
        if (e.viaBox >= 0) pushes.push({ box: e.viaBox, to: e.viaTo });
        k = e.parent;
      }
      pushes.reverse();
      return { found: { boxes, player: cur.player, pushes, cost: cur.g }, explored };
    }
    explored++;
    if (explored > cap) return { found: null, explored };
    const { dist } = walkBFS(p, boxes, cur.player); // locked boxes are in `boxes`, so they block
    for (const b of boxes) {
      if (locked.has(b)) continue; // never push a locked box
      const br = Math.floor(b / p.w);
      const bc = b % p.w;
      for (const [dr, dc] of DIRS) {
        if (br + dr < 0 || br + dr >= p.h || bc + dc < 0 || bc + dc >= p.w) continue;
        if (br - dr < 0 || br - dr >= p.h || bc - dc < 0 || bc - dc >= p.w) continue;
        const far = (br + dr) * p.w + (bc + dc);
        const pushFrom = (br - dr) * p.w + (bc - dc);
        if (p.walls.has(far) || locked.has(far) || boxes.has(far)) continue;
        if (goalDist[far] === Infinity) continue; // box would strand off all goals
        if (!dist.has(pushFrom)) continue;
        const boxes2 = new Set(boxes);
        boxes2.delete(b);
        boxes2.add(far);
        if (freezeDeadlock(p, boxes2, goalDist, far)) continue;
        const cost = cur.g + (dist.get(pushFrom) ?? 0) + 1;
        const info = regionInfo(p, boxes2, b);
        const key2 = `${boxesKey(boxes2)}|${info.canonical}`;
        const prev2 = reached.get(key2);
        if (prev2 !== undefined && prev2.g <= cost) continue;
        reached.set(key2, { g: cost, parent: cur.key, viaBox: b, viaTo: far });
        heap.push({ key: key2, player: b, g: cost, h: 0, unc: 0, nhome: 0, pri: hOf(boxes2), region: info.size });
      }
    }
  }
  return { found: null, explored };
}

/** Replay an ordered push list from a start state into a per-step grid path. */
function expandPath(p: Parsed, startBoxes: Set<number>, startPlayer: number, pushes: Push[]): { path: string[]; route: number[] } {
  const lineStep = (from: number, to: number): number => {
    const fr = Math.floor(from / p.w);
    const tr = Math.floor(to / p.w);
    return fr === tr ? Math.sign((to % p.w) - (from % p.w)) : Math.sign(tr - fr) * p.w;
  };
  const path = [render(p, startBoxes, startPlayer)];
  const route: number[] = [startPlayer];
  const boxes = new Set(startBoxes);
  let player = startPlayer;
  for (const { box, to } of pushes) {
    const d = lineStep(box, to);
    const { prev } = walkBFS(p, boxes, player);
    const walk = walkSteps(prev, box - d);
    for (let j = 1; j < walk.length; j++) {
      path.push(render(p, boxes, walk[j]));
      route.push(walk[j]);
    }
    for (let bpos = box; bpos !== to; ) {
      boxes.delete(bpos);
      bpos += d;
      boxes.add(bpos);
      path.push(render(p, boxes, bpos - d));
      route.push(bpos - d);
    }
    player = to - d;
  }
  return { path, route };
}

/**
 * Decomposition solver: cover goals one at a time, locking each placed box. Goals
 * that can't be covered yet are deferred; if a full pass makes no progress we are
 * stuck. Satisficing — returns a valid (non-minimal) solution or reports it can't.
 */
function solveByDecomposition(p: Parsed, rs: RuleSet, overallBudget: number): SolveResult {
  let boxes = new Set(p.boxes);
  let player = p.player;
  const locked = new Set<number>();
  const allPushes: Push[] = [];
  // Goals already covered at the start are locked immediately.
  for (const g of p.boxGoals) if (p.boxes.has(g)) locked.add(g);
  let queue = [...p.boxGoals].filter((g) => !locked.has(g));
  let totalExplored = 0;
  // Per sub-search cap: small, so a failed cover aborts fast instead of grinding
  // to the global cap. The whole run is bounded by `overallBudget`.
  const perGoalCap = Math.max(20_000, Math.floor(overallBudget / 100));
  const stuck = (n: number): SolveResult => ({
    ok: true,
    solvable: false,
    ruleset: rs.name,
    optimal: false,
    mode: "decompose",
    moves: null,
    pushes: null,
    explored: totalExplored,
    pushed: 0,
    pruned: 0,
    path: null,
    winning: null,
    plan: null,
    route: null,
    analysis: null,
    reason: `decomposition stuck: ${n} goal(s) unreachable given the placed boxes (explored ${totalExplored})`,
  });

  while (queue.length > 0) {
    let progress = false;
    const deferred: number[] = [];
    for (const target of queue) {
      const goalDist = goalDistancesBlocked(p, locked);
      const { found, explored } = coverGoal(p, boxes, player, locked, target, goalDist, perGoalCap);
      totalExplored += explored;
      if (totalExplored > overallBudget) return stuck(deferred.length + (queue.length - queue.indexOf(target)));
      if (!found) {
        deferred.push(target);
        continue;
      }
      boxes = found.boxes;
      player = found.player;
      allPushes.push(...found.pushes);
      locked.add(target);
      progress = true;
    }
    if (!progress) return stuck(deferred.length);
    queue = deferred;
  }

  // All box goals covered. Recompute the end state, then walk to the player goal if any.
  const { path, route } = expandPath(p, p.boxes, p.player, allPushes);
  const finalBoxes = new Set(p.boxes);
  let endPlayer = p.player;
  for (const { box, to } of allPushes) {
    const d = Math.floor(box / p.w) === Math.floor(to / p.w) ? Math.sign((to % p.w) - (box % p.w)) : Math.sign(to - box) * p.w;
    finalBoxes.delete(box);
    finalBoxes.add(to);
    endPlayer = to - d;
  }
  if (p.playerGoal !== null && endPlayer !== p.playerGoal) {
    const { prev } = walkBFS(p, finalBoxes, endPlayer);
    if (prev.has(p.playerGoal)) {
      const walk = walkSteps(prev, p.playerGoal);
      for (let j = 1; j < walk.length; j++) {
        path.push(render(p, finalBoxes, walk[j]));
        route.push(walk[j]);
      }
    }
  }
  const winning = path[path.length - 1];
  const cappedPath = path.length <= MAX_PATH ? path : [...path.slice(0, MAX_PATH - 1), winning];
  const cappedRoute = route.length <= MAX_PATH ? route : route.slice(0, MAX_PATH);
  return {
    ok: true,
    solvable: true,
    ruleset: rs.name,
    optimal: false,
    mode: "decompose",
    moves: path.length - 1,
    pushes: allPushes.length,
    explored: totalExplored,
    pushed: 0,
    pruned: 0,
    path: cappedPath,
    winning,
    plan: buildVectors(allPushes, p.w, p.boxGoals),
    route: cappedRoute,
    analysis: buildAnalysis(p, goalDistances(p), allPushes),
    reason: "goal reached (decomposition — solution found, not necessarily minimal)",
  };
}

/** Lower bound + box→goal assignment: the vectorial heuristics an optimizer reuses. */
function buildAnalysis(p: Parsed, goalDist: number[] | null, pushes: { box: number; to: number }[]): GridAnalysis {
  const boxes = [...p.boxes];
  const goals = [...p.boxGoals];
  const lb = (cell: number): number => (goalDist && Number.isFinite(goalDist[cell]) ? goalDist[cell] : 0);
  const lowerBound = boxes.reduce((s, b) => s + lb(b), 0);
  // Trace each start box's identity through the pushes to the goal it ends on.
  const origin = new Map<number, number>();
  for (const b of p.boxes) origin.set(b, b);
  for (const { box, to } of pushes) {
    const o = origin.get(box) ?? box;
    origin.delete(box);
    origin.set(to, o);
  }
  const assignment = [...p.boxGoals]
    .filter((g) => origin.has(g))
    .map((g) => ({ box: origin.get(g)!, goal: g, lb: lb(origin.get(g)!) }));
  return { w: p.w, h: p.h, boxes, goals, lowerBound, assignment };
}

const AUTO_BOX_LIMIT = Number(process.env.LIPS_AUTO_BOX_LIMIT ?? 12);

/**
 * Public entry. mode "auto" (default): a cheap box-count precheck sends obviously
 * huge boards straight to satisficing; otherwise it runs the optimal search and
 * falls back to satisficing only if that hits the state cap. Explicit modes
 * ("optimal" | "rooms" | "decompose") bypass the dispatch.
 */
export function solve(grid: string, rulesetName: string = DEFAULT_RULESET, modeArg?: SearchMode, upperBound?: number): SolveResult {
  const raw = (modeArg ?? (process.env.LIPS_SEARCH as SearchMode | undefined) ?? "auto").toLowerCase();
  const reqMode: SearchMode = raw === "optimal" || raw === "rooms" || raw === "decompose" ? raw : "auto";
  if (reqMode === "auto") return solveAuto(grid, rulesetName);
  return solveOnce(grid, rulesetName, reqMode, upperBound);
}

function solveAuto(grid: string, rulesetName: string): SolveResult {
  const boxCount = (grid.match(/[$*]/g) ?? []).length;
  if (boxCount > AUTO_BOX_LIMIT) return runSatisficing(grid, rulesetName); // too big to attempt optimal
  const opt = solveOnce(grid, rulesetName, "optimal");
  if (opt.solvable) return opt; // optimal solution found — keep it
  const cappedOut = opt.ok && opt.reason.includes("search limit reached");
  if (!cappedOut) return opt; // genuinely unsolvable / invalid — trust the optimal verdict
  const fb = runSatisficing(grid, rulesetName);
  return fb.solvable ? fb : opt; // prefer a solution; else report the optimal cap-out
}

/** Satisficing fallback: decomposition first (strongest on box-goal boards), then rooms. */
function runSatisficing(grid: string, rulesetName: string): SolveResult {
  const d = solveOnce(grid, rulesetName, "decompose");
  if (d.solvable) return d;
  const r = solveOnce(grid, rulesetName, "rooms");
  return r.solvable ? r : d;
}

function solveOnce(grid: string, rulesetName: string, reqMode: "optimal" | "rooms" | "decompose", upperBound?: number): SolveResult {
  const rs = getRuleSet(rulesetName);
  const fail = (reason: string, ok = true, explored = 0, pushed = 0, pruned = 0): SolveResult => ({
    ok,
    solvable: false,
    ruleset: rs.name,
    optimal: false,
    mode: reqMode,
    moves: null,
    pushes: null,
    explored,
    pushed,
    pruned,
    path: null,
    winning: null,
    plan: null,
    route: null,
    analysis: null,
    reason,
  });

  const p = parse(grid, rs);
  if ("error" in p) return fail(p.error, false);

  // No objective at all is not a "solve".
  if (p.playerGoal === null && p.boxGoals.size === 0) return fail("no goal in the grid");

  // Preflight: every box goal must be coverable by a box.
  if (p.boxGoals.size > p.boxes.size) {
    return fail(`preflight failed: ${p.boxGoals.size} box goal(s) but only ${p.boxes.size} box(es) — they cannot all be covered`);
  }

  // Already solved?
  if (allCovered(p, p.boxes) && (p.playerGoal === null || p.player === p.playerGoal)) {
    const g = render(p, p.boxes, p.player);
    return { ok: true, solvable: true, ruleset: rs.name, optimal: true, mode: reqMode, moves: 0, pushes: 0, explored: 0, pushed: 1, pruned: 0, path: [g], winning: g, plan: [], route: [p.player], analysis: buildAnalysis(p, null, []), reason: "goal already met" };
  }

  // One map serves both dedup and reconstruction: key -> cheapest cost + how we got here.
  const reached = new Map<string, Entry>();
  const heap = new Heap();

  // The A* heuristic + deadlock pruning are only sound when every box MUST end
  // on a goal (#boxes === #box goals). With surplus boxes or a pure player-goal
  // grid a box may legitimately rest off a goal, so we fall back to h = 0 (plain
  // uniform-cost search) and skip deadlock pruning there.
  const goalDist = p.boxGoals.size > 0 && p.boxes.size === p.boxGoals.size ? goalDistances(p) : null;
  // f = g + W·h. W = 1 keeps the search admissible (minimum `moves`); W > 1
  // (LIPS_HEURISTIC_WEIGHT) trades optimality for reach on very large grids.
  const W = Math.max(1, Number(process.env.LIPS_HEURISTIC_WEIGHT ?? 1));
  // Sum of each box's lower-bound pushes to a goal — admissible, updated in O(1)
  // per push. Infinity means a box that can never reach any goal (a dead state).
  const hOf = (boxes: Set<number>): number => {
    if (!goalDist) return 0;
    let h = 0;
    for (const b of boxes) {
      if (goalDist[b] === Infinity) return Infinity;
      h += goalDist[b];
    }
    return h;
  };

  const h0 = hOf(p.boxes);
  if (h0 === Infinity) return fail("a box starts where it can never reach any goal — unsolvable", true, 0, 0, 0);

  // Decomposition satisficing mode: fill goals one at a time, locking placed
  // boxes. Only meaningful in box-goal mode (goalDist set).
  if (reqMode === "decompose" && goalDist !== null) {
    return solveByDecomposition(p, rs, MAX_EXPLORED);
  }

  // Room-guided satisficing mode (LIPS_SEARCH=rooms): a greedy best-first search
  // that drives boxes out of goal-less rooms toward goal rooms. It finds *a*
  // solution on boards too large for the optimal search, but `moves` is no
  // longer guaranteed minimal. Only meaningful when the box-goal heuristic is
  // active (so goal rooms are defined); otherwise we stay optimal.
  const useRooms = reqMode === "rooms" && goalDist !== null;
  const rooms = useRooms ? analyzeRooms(p) : null;
  // A box is "not home" if it sits off a goal and outside any goal-bearing room.
  const notHome = (cell: number): number => {
    if (!rooms || p.boxGoals.has(cell)) return 0;
    const id = rooms.roomOf[cell];
    return id >= 0 && rooms.goalRoom[id] ? 0 : 1;
  };
  // Lexicographic greedy priority packed into one number: uncovered ≫ not-home ≫ goal-distance.
  const HSPAN = p.boxes.size * (p.w * p.h) + 1; // exceeds any sum of goal distances
  const NSPAN = (p.boxes.size + 1) * HSPAN; // exceeds any (not-home · HSPAN + h)
  const priOf = (g: number, h: number, unc: number, nhome: number): number => (useRooms ? unc * NSPAN + nhome * HSPAN + h : g + W * h);

  let unc0 = 0;
  for (const goal of p.boxGoals) if (!p.boxes.has(goal)) unc0++;
  let nhome0 = 0;
  for (const b of p.boxes) nhome0 += notHome(b);

  const start0 = regionInfo(p, p.boxes, p.player);
  const sKey = `${boxesKey(p.boxes)}|${start0.canonical}`;
  reached.set(sKey, { g: 0, parent: null, viaBox: -1, viaTo: -1 });
  heap.push({ key: sKey, player: p.player, g: 0, h: h0, unc: unc0, nhome: nhome0, pri: priOf(0, h0, unc0, nhome0), region: start0.size });

  let explored = 0;
  let pushed = 1;
  let pruned = 0;
  let logged = 0;

  // Seed the best-known finish with a caller-supplied upper bound (the cost of a
  // known satisficing plan): the search then prunes every state with f ≥ bound,
  // so a bounded re-search is far cheaper than a cold optimal solve.
  let bestWin = upperBound ?? Infinity;
  let winFrom: { key: string; walkToGoal: number[] } | null = null;

  while (heap.size > 0) {
    const cur = heap.pop()!;
    const entry = reached.get(cur.key);
    if (!entry || entry.g !== cur.g) {
      pruned++;
      continue;
    } // stale (a cheaper arrival superseded it)
    if (cur.pri >= bestWin) break; // optimal A*: cheapest possible finish can't beat the best found (inert in room mode — see below)

    explored++;
    if (explored > MAX_EXPLORED) {
      return fail(`search limit reached (${MAX_EXPLORED} classes explored) — too large to solve here`, true, explored, pushed, pruned);
    }

    const boxes = parseBoxes(cur.key); // rebuilt from the key, not carried per state
    const { dist, prev } = walkBFS(p, boxes, cur.player);
    const region = dist.size;

    if (logVerboseEnabled()) {
      if (logged < MAX_TRACE) {
        logVerbose(`  [${String(explored).padStart(6)}] pri ${String(cur.pri).padStart(6)} g ${String(cur.g).padStart(4)} h ${String(cur.h).padStart(4)} unc ${String(cur.unc).padStart(2)} | ${region} equiv | ${compact(render(p, boxes, cur.player))}`);
        logged++;
        if (logged === MAX_TRACE) logVerbose(`  … (further states not logged; --log=basic to silence)`);
      }
    }

    // Can we finish from here? All box goals covered, then walk to the player goal.
    if (allCovered(p, boxes)) {
      if (p.playerGoal === null) {
        bestWin = Math.min(bestWin, cur.g);
        if (bestWin === cur.g) winFrom = { key: cur.key, walkToGoal: [cur.player] };
      } else if (dist.has(p.playerGoal)) {
        const total = cur.g + (dist.get(p.playerGoal) ?? 0);
        if (total < bestWin) {
          bestWin = total;
          winFrom = { key: cur.key, walkToGoal: walkSteps(prev, p.playerGoal) };
        }
      }
      if (useRooms && winFrom) break; // greedy: take the first solution found
    }

    // Generate one child: box `b` ends at `rest` (player follows to rest-d), at
    // the given real-step `cost`. Applies deadlock pruning and dedup.
    const emitPush = (b: number, rest: number, d: number, cost: number): void => {
      if (goalDist !== null && goalDist[rest] === Infinity) {
        pruned++;
        return;
      } // simple deadlock: box lands where it can never reach a goal
      const boxes2 = new Set(boxes);
      boxes2.delete(b);
      boxes2.add(rest);
      if (goalDist !== null && freezeDeadlock(p, boxes2, goalDist, rest)) {
        pruned++;
        return;
      } // freeze deadlock: this push pins a box off-goal forever
      const player2 = rest - d; // player ends right behind the box
      const cost0 = cost;
      const info = regionInfo(p, boxes2, player2);
      const key2 = `${boxesKey(boxes2)}|${info.canonical}`;
      const prev2 = reached.get(key2);
      if (prev2 !== undefined && prev2.g <= cost0) {
        pruned++;
        return;
      }
      // O(1) heuristic update: only box `b` moved, from b to rest.
      const h2 = goalDist === null ? 0 : cur.h - goalDist[b] + goalDist[rest];
      const unc2 = cur.unc + (p.boxGoals.has(b) ? 1 : 0) - (p.boxGoals.has(rest) ? 1 : 0);
      const nhome2 = cur.nhome - notHome(b) + notHome(rest);
      reached.set(key2, { g: cost0, parent: cur.key, viaBox: b, viaTo: rest });
      heap.push({ key: key2, player: player2, g: cost0, h: h2, unc: unc2, nhome: nhome2, pri: priOf(cost0, h2, unc2, nhome2), region: info.size });
      pushed++;
    };

    // Expand pushes — one cell per push. Each direction the player can get
    // behind (`pushFrom` reachable) and the cell ahead is free yields a single
    // child where the box advances one cell. (A "tunnel macro" that slid a box
    // through a 1-wide corridor in one step was removed: it was unsound, skipping
    // intermediate rest cells the player needs — vacating the box's origin can
    // open new pushes — so it reported solvable boards as unsolvable.)
    for (const b of boxes) {
      const br = Math.floor(b / p.w);
      const bc = b % p.w;
      for (const [dr, dc] of DIRS) {
        if (br + dr < 0 || br + dr >= p.h || bc + dc < 0 || bc + dc >= p.w) continue; // nothing ahead
        if (br - dr < 0 || br - dr >= p.h || bc - dc < 0 || bc - dc >= p.w) continue; // nowhere behind to push from
        const pushFrom = (br - dr) * p.w + (bc - dc);
        if (!dist.has(pushFrom)) continue; // player cannot reach the pushing side
        const d = dr * p.w + dc;
        const rest = b + d;
        if (p.walls.has(rest) || boxes.has(rest)) continue; // blocked immediately
        emitPush(b, rest, d, cur.g + (dist.get(pushFrom) ?? 0) + 1); // walk to push side, then one push
      }
    }
  }

  if (!winFrom || bestWin === Infinity) {
    return fail("no path to the goal", true, explored, pushed, pruned);
  }

  // Reconstruct the path. Box layouts weren't stored, so replay the push chain
  // from the start: each entry's (viaBox -> viaTo) is one push.
  const keyChain: string[] = [];
  for (let k: string | null = winFrom.key; k !== null; k = reached.get(k)!.parent) keyChain.push(k);
  keyChain.reverse();

  // A push moves box viaBox -> viaTo one cell; this is its unit step delta.
  const lineStep = (from: number, to: number): number => {
    const fr = Math.floor(from / p.w);
    const tr = Math.floor(to / p.w);
    return fr === tr ? Math.sign((to % p.w) - (from % p.w)) : Math.sign(tr - fr) * p.w;
  };

  const states: { boxes: Set<number>; player: number }[] = [{ boxes: new Set(p.boxes), player: p.player }];
  for (let i = 1; i < keyChain.length; i++) {
    const e = reached.get(keyChain[i])!;
    const boxes = new Set(states[i - 1].boxes);
    boxes.delete(e.viaBox);
    boxes.add(e.viaTo);
    states.push({ boxes, player: e.viaTo - lineStep(e.viaBox, e.viaTo) }); // player ends right behind the box
  }

  // Expand each push into single player steps: walk to the pushing side, then push the box cell by cell.
  const path: string[] = [render(p, states[0].boxes, states[0].player)];
  const route: number[] = [states[0].player]; // player cell per step (for rendering)
  for (let i = 1; i < keyChain.length; i++) {
    const before = states[i - 1];
    const e = reached.get(keyChain[i])!;
    const d = lineStep(e.viaBox, e.viaTo);
    const pushFrom = e.viaBox - d; // cell the player stands on to start pushing
    const { prev } = walkBFS(p, before.boxes, before.player);
    const walk = walkSteps(prev, pushFrom);
    for (let j = 1; j < walk.length; j++) {
      path.push(render(p, before.boxes, walk[j]));
      route.push(walk[j]);
    }
    const live = new Set(before.boxes);
    for (let box = e.viaBox; box !== e.viaTo; ) {
      live.delete(box);
      box += d;
      live.add(box);
      path.push(render(p, live, box - d)); // one push step, player following behind
      route.push(box - d);
    }
  }
  // Final walk to the player goal (if any), ending on it.
  if (winFrom.walkToGoal.length > 1) {
    const last = states[states.length - 1];
    for (let j = 1; j < winFrom.walkToGoal.length; j++) {
      path.push(render(p, last.boxes, winFrom.walkToGoal[j]));
      route.push(winFrom.walkToGoal[j]);
    }
  }

  const moves = path.length - 1;
  const winning = path[path.length - 1];
  // Cap the returned path/route so the tool result stays small (full play is logged).
  const cappedPath = path.length <= MAX_PATH ? path : [...path.slice(0, MAX_PATH - 1), winning];
  const cappedRoute = route.length <= MAX_PATH ? route : route.slice(0, MAX_PATH);

  // The solution as push vectors + the heuristics that seed a further optimize call.
  const pushes = keyChain.slice(1).map((k) => {
    const e = reached.get(k)!;
    return { box: e.viaBox, to: e.viaTo };
  });

  return {
    ok: true,
    solvable: true,
    ruleset: rs.name,
    optimal: !useRooms, // rooms is greedy/satisficing; plain A* is the minimum
    mode: useRooms ? "rooms" : "optimal",
    moves,
    pushes: pushes.length,
    explored,
    pushed,
    pruned,
    path: cappedPath,
    winning,
    plan: buildVectors(pushes, p.w, p.boxGoals),
    route: cappedRoute,
    analysis: buildAnalysis(p, goalDist, pushes),
    reason: useRooms ? "goal reached (room-guided search — solution found, not necessarily minimal)" : "goal reached",
  };
}

// logVerbose() is a no-op under "basic"; this guard also skips building the
// (somewhat costly) log string when verbose is off.
function logVerboseEnabled(): boolean {
  return getLogLevel() === "verbose";
}

export type BestMoveResult = {
  ok: boolean;
  solvable: boolean;
  ruleset: string;
  move: string | null; // the grid AFTER the best move (null if unsolvable)
  reachedGoal: boolean; // this move reaches the win
  movesRemaining: number; // optimal moves from the INPUT grid to the win
  reason: string;
};

/**
 * The single BEST next step from a grid: the first step of the shortest play.
 * Re-apply it to the returned grid to play out the optimal sequence.
 */
export function bestMove(grid: string, rulesetName: string = DEFAULT_RULESET): BestMoveResult {
  const s = solve(grid, rulesetName);
  if (!s.ok) {
    return { ok: false, solvable: false, ruleset: s.ruleset, move: null, reachedGoal: false, movesRemaining: 0, reason: s.reason };
  }
  if (!s.solvable || !s.path || s.path.length < 2) {
    return {
      ok: true,
      solvable: false,
      ruleset: s.ruleset,
      move: null,
      reachedGoal: false,
      movesRemaining: 0,
      reason: s.solvable ? "already at the goal — no move needed" : s.reason,
    };
  }
  return {
    ok: true,
    solvable: true,
    ruleset: s.ruleset,
    move: s.path[1],
    reachedGoal: s.path.length === 2, // a single step reaches the win
    movesRemaining: s.moves ?? 0,
    reason: "optimal next move",
  };
}

export const bestmoveTool = tool(
  "bestmove",
  "Return the single BEST next step toward the win for a grid (the first step of the shortest play): the resulting grid, whether that step reaches the win, and how many optimal steps remain. Re-apply it to the returned grid to play out the optimal sequence.",
  {
    grid: z.string().describe("the current state as an ASCII grid"),
    ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
  },
  async (args) => {
    const r = bestMove(args.grid, args.ruleset ?? DEFAULT_RULESET);
    const text = !r.solvable
      ? `no best move — ${r.reason}`
      : `${r.reachedGoal ? "winning move" : "best move"} (${r.movesRemaining} move(s) to win):\n${r.move}`;
    return { content: [{ type: "text", text }], structuredContent: r };
  },
);

export const solveTool = tool(
  "solve",
  "Deterministically solve a grid (ruleset default 'sokoban', microban/XSB glyphs) and report the MINIMUM number of player moves. Full Sokoban: the player '@' moves onto floor ' ' (space), player goal 'x' (shown 'X') or an empty box goal '.' (shown '+'); walls '#' impassable; a box '$' (or one on a goal '*') is pushed when the tile beyond it is empty floor/box-goal. WIN: every box goal covered by a box AND (if present) the player on 'x'. The search is equivalence-collapsed over PUSHES (states differing only by where the player walked are one node) and ordered by player-step cost, so `moves` is the minimum step count; `pushes` is the box-push count. Very large state spaces stop at a cap (see `reason`). The per-state search progress is logged to the terminal, not returned here. Returns { solvable, moves, pushes, winning, explored, pushed, pruned }.",
  {
    grid: z.string().describe("the start state as an ASCII grid"),
    ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
  },
  async (args) => {
    const r = solve(args.grid, args.ruleset ?? DEFAULT_RULESET);
    const text = r.solvable ? renderResult(args.grid, r) : `not solvable — ${r.reason} (explored ${r.explored} classes, pruned ${r.pruned})`;
    // Omit the (potentially large) per-step `path` from the model-facing payload —
    // the plan vectors + analysis are the compact carry-forward; the win grid stays.
    const { path: _path, ...summary } = r;
    return { content: [{ type: "text", text }], structuredContent: summary };
  },
);

/** A `Dir`'s row-major delta for a board of width `w`. */
const DIR_DELTA = (dir: Dir, w: number): number => (dir === "U" ? -w : dir === "D" ? w : dir === "L" ? -1 : 1);

/**
 * Replay a solver's push-VECTOR plan into the canonical Sokoban move string: one
 * character per player step in LURD notation — lowercase u/d/l/r for a walk,
 * UPPERCASE U/D/L/R for a push — taking the shortest walk between pushes. Unlike
 * the result's `route` (truncated at MAX_PATH), this is uncapped, so it is the
 * source of truth for the FULL play. Returns the move string, its move/push
 * counts, and whether it genuinely replays to a win.
 */
export function planToLURD(
  grid: string,
  plan: PlanStep[],
  rulesetName: string = DEFAULT_RULESET,
): { lurd: string; moves: number; pushes: number; valid: boolean } {
  const rs = getRuleSet(rulesetName);
  const p = parse(grid, rs);
  if ("error" in p) return { lurd: "", moves: 0, pushes: 0, valid: false };
  const boxes = new Set(p.boxes);
  let player = p.player;
  const stepChar = (delta: number, push: boolean): string => {
    const ch = delta === -p.w ? "u" : delta === p.w ? "d" : delta === -1 ? "l" : "r";
    return push ? ch.toUpperCase() : ch;
  };
  let lurd = "";
  let pushes = 0;
  for (const v of plan) {
    const d = DIR_DELTA(v.dir, p.w);
    let box = v.box;
    for (let k = 0; k < v.len; k++) {
      const pushFrom = box - d;
      const { prev, dist } = walkBFS(p, boxes, player);
      if (!dist.has(pushFrom)) return { lurd, moves: lurd.length, pushes, valid: false };
      const walk = walkSteps(prev, pushFrom);
      for (let j = 1; j < walk.length; j++) lurd += stepChar(walk[j] - walk[j - 1], false);
      boxes.delete(box);
      boxes.add(box + d);
      lurd += stepChar(d, true);
      pushes++;
      player = box; // player follows into the box's vacated cell
      box += d;
    }
  }
  // Final walk onto the player goal, if the ruleset has one and we are not on it.
  if (p.playerGoal !== null && player !== p.playerGoal) {
    const { prev, dist } = walkBFS(p, boxes, player);
    if (dist.has(p.playerGoal)) {
      const walk = walkSteps(prev, p.playerGoal);
      for (let j = 1; j < walk.length; j++) lurd += stepChar(walk[j] - walk[j - 1], false);
      player = p.playerGoal; // we are now standing on it
    }
  }
  const valid = allCovered(p, boxes) && (p.playerGoal === null || player === p.playerGoal);
  return { lurd, moves: lurd.length, pushes, valid };
}

/** Render a solved result's colour ASCII view (auto colour by TTY / NO_COLOR). */
export function renderResult(grid: string, r: SolveResult, color?: boolean): string {
  if (!r.solvable || !r.plan || !r.route || !r.analysis || r.winning === null || r.moves === null || r.pushes === null) {
    return `not solvable — ${r.reason}`;
  }
  const on = color ?? (process.stdout.isTTY === true && !process.env.NO_COLOR);
  return renderSolution(grid, r.winning, r.plan, r.route, r.analysis, { moves: r.moves, pushes: r.pushes, optimal: r.optimal, mode: r.mode }, on);
}

export type OptimizeResult = {
  ok: boolean;
  valid: boolean; // the plan actually replays to a win on this grid
  ruleset: string;
  moves: number | null; // total player steps after condensing
  pushes: number | null;
  optimal: boolean; // proven minimum (only set true when the bounded re-search ran to completion)
  improvedFromMoves: number | null; // the move count before optimizing, when it was reduced
  plan: PlanStep[] | null;
  route: number[] | null;
  winning: string | null;
  reason: string;
};

/**
 * Replay a push-vector plan from the start, taking the SHORTEST player walk to
 * each pushing position — the local-condense step. The push sequence is fixed;
 * only the player's walking is minimized, so `moves` is ≤ the plan's original
 * length (a satisficing plan that wandered gets tightened for free). Validates
 * each push is legal so a bad plan is reported, not silently mis-rendered.
 */
function replayPlan(
  grid: string,
  plan: PlanStep[],
  rs: RuleSet,
): { ok: boolean; valid: boolean; moves: number; pushes: number; route: number[]; winning: string; reason: string } {
  const p = parse(grid, rs);
  if ("error" in p) return { ok: false, valid: false, moves: 0, pushes: 0, route: [], winning: grid, reason: p.error };
  const bad = (reason: string): { ok: boolean; valid: boolean; moves: number; pushes: number; route: number[]; winning: string; reason: string } => ({ ok: true, valid: false, moves: 0, pushes: 0, route: [], winning: grid, reason });

  const boxes = new Set(p.boxes);
  let player = p.player;
  const route: number[] = [player];
  let moves = 0;
  let pushes = 0;
  for (const v of plan) {
    const d = DIR_DELTA(v.dir, p.w);
    let box = v.box;
    for (let k = 0; k < v.len; k++) {
      if (!boxes.has(box)) return bad(`plan invalid: no box at (${Math.floor(box / p.w)},${box % p.w})`);
      const ahead = box + d;
      const pushFrom = box - d;
      if (p.walls.has(ahead) || boxes.has(ahead)) return bad("plan invalid: a push is blocked");
      const { prev, dist } = walkBFS(p, boxes, player);
      if (!dist.has(pushFrom)) return bad("plan invalid: player cannot reach a pushing side");
      const walk = walkSteps(prev, pushFrom);
      for (let j = 1; j < walk.length; j++) {
        route.push(walk[j]);
        moves++;
      }
      boxes.delete(box);
      boxes.add(ahead);
      player = box; // player follows into the box's old cell
      route.push(player);
      moves++;
      pushes++;
      box = ahead;
    }
  }
  if (p.playerGoal !== null && player !== p.playerGoal) {
    const { prev, dist } = walkBFS(p, boxes, player);
    if (dist.has(p.playerGoal)) {
      const walk = walkSteps(prev, p.playerGoal);
      for (let j = 1; j < walk.length; j++) {
        route.push(walk[j]);
        moves++;
      }
      player = p.playerGoal;
    }
  }
  const valid = allCovered(p, boxes) && (p.playerGoal === null || player === p.playerGoal);
  return { ok: true, valid, moves, pushes, route, winning: render(p, boxes, player), reason: valid ? "plan replays to a win" : "plan does not reach the goal" };
}

/**
 * The synthesizer/optimizer. Given a grid and a solver's push-VECTOR plan (no
 * re-analysis of the grid required), always LOCAL-CONDENSE (shortest walks). If
 * `proven`, additionally run a bounded optimal A* seeded by the condensed cost as
 * an upper bound: it returns a strictly cheaper plan if one exists, otherwise it
 * proves the condensed plan is already optimal — far cheaper than a cold solve
 * because the known cost prunes the search hard.
 */
export function optimize(grid: string, plan: PlanStep[], opts: { proven?: boolean; ruleset?: string } = {}): OptimizeResult {
  const rulesetName = opts.ruleset ?? DEFAULT_RULESET;
  const rs = getRuleSet(rulesetName);
  const c = replayPlan(grid, plan, rs);
  if (!c.ok || !c.valid) {
    return { ok: c.ok, valid: false, ruleset: rs.name, moves: null, pushes: null, optimal: false, improvedFromMoves: null, plan: null, route: null, winning: c.winning, reason: c.reason };
  }
  const route = c.route.length <= MAX_PATH ? c.route : c.route.slice(0, MAX_PATH);
  const condensed: OptimizeResult = { ok: true, valid: true, ruleset: rs.name, moves: c.moves, pushes: c.pushes, optimal: false, improvedFromMoves: null, plan, route, winning: c.winning, reason: "locally condensed (shortest walks between pushes)" };
  if (!opts.proven) return condensed;

  // Proven-optimal: bounded optimal re-search using the condensed cost as the upper bound.
  const bounded = solve(grid, rulesetName, "optimal", c.moves);
  if (bounded.solvable && (bounded.moves ?? Infinity) < c.moves) {
    return { ok: true, valid: true, ruleset: rs.name, moves: bounded.moves, pushes: bounded.pushes, optimal: true, improvedFromMoves: c.moves, plan: bounded.plan, route: bounded.route, winning: bounded.winning, reason: `proven optimal: bounded re-search improved ${c.moves} → ${bounded.moves} moves` };
  }
  if (bounded.ok && bounded.reason.includes("search limit")) {
    return { ...condensed, reason: "locally condensed; optimality NOT proven (bounded re-search hit the state cap)" };
  }
  return { ...condensed, optimal: true, reason: "proven optimal: no cheaper solution exists within the bound" };
}

export const optimizeTool = tool(
  "optimize",
  "Refine a solver's push-VECTOR plan WITHOUT re-analysing the grid. Always local-condenses (takes the shortest player walk between pushes, tightening a satisficing plan); with proven=true it also runs a bounded optimal re-search seeded by the plan's cost, returning a strictly shorter plan if one exists or proving the plan is already optimal. Input: the grid plus the `plan` (and optional `analysis`) from a solve result. Returns { valid, moves, pushes, optimal, improvedFromMoves, plan, winning }.",
  {
    grid: z.string().describe("the start state as an ASCII grid"),
    plan: z.array(z.unknown()).describe("the solver's push-vector plan (the `plan` field of a solve result)"),
    proven: z.boolean().optional().describe("also prove/achieve the optimum via bounded re-search (default false)"),
    ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
  },
  async (args) => {
    const r = optimize(args.grid, args.plan as PlanStep[], { proven: args.proven, ruleset: args.ruleset });
    const text = r.valid
      ? `${r.optimal ? "optimal" : "condensed"}: ${r.moves} move(s) / ${r.pushes} push(es)${r.improvedFromMoves !== null ? ` (was ${r.improvedFromMoves})` : ""} — ${r.reason}`
      : `cannot optimize — ${r.reason}`;
    return { content: [{ type: "text", text }], structuredContent: r };
  },
);
