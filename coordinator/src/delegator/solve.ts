import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { getRuleSet, DEFAULT_RULESET } from "../rules/index.js";
import type { RuleSet } from "../rules/index.js";
import { logVerbose, getLogLevel } from "../logger.js";

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

export type SolveResult = {
  ok: boolean;
  solvable: boolean;
  ruleset: string;
  moves: number | null; // minimum player steps (null if unsolvable)
  pushes: number | null; // box pushes in the solution
  explored: number; // equivalence classes dequeued
  pushed: number; // classes added to the frontier
  pruned: number; // classes skipped (already reached at <= cost)
  path: string[] | null; // start .. winning grid, per player step (capped)
  winning: string | null;
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
  const rows = grid.replace(/\r/g, "").replace(/ /g, ".").split("\n");
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
      if (g === rs.boxGoal || g === rs.boxOnGoal || g === rs.playerOnBoxGoal) boxGoals.add(cell); // '~','*','&'
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
      else if (boxes.has(cell)) row += p.boxGoals.has(cell) ? p.rs.boxOnGoal ?? "+" : p.rs.box ?? "+";
      else if (cell === p.playerGoal) row += p.rs.goal ?? "x";
      else if (p.boxGoals.has(cell)) row += p.rs.boxGoal ?? "~";
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

export function solve(grid: string, rulesetName: string = DEFAULT_RULESET): SolveResult {
  const rs = getRuleSet(rulesetName);
  const fail = (reason: string, ok = true, explored = 0, pushed = 0, pruned = 0): SolveResult => ({
    ok,
    solvable: false,
    ruleset: rs.name,
    moves: null,
    pushes: null,
    explored,
    pushed,
    pruned,
    path: null,
    winning: null,
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
    return { ok: true, solvable: true, ruleset: rs.name, moves: 0, pushes: 0, explored: 0, pushed: 1, pruned: 0, path: [g], winning: g, reason: "goal already met" };
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

  // Room-guided satisficing mode (LIPS_SEARCH=rooms): a greedy best-first search
  // that drives boxes out of goal-less rooms toward goal rooms. It finds *a*
  // solution on boards too large for the optimal search, but `moves` is no
  // longer guaranteed minimal. Only meaningful when the box-goal heuristic is
  // active (so goal rooms are defined); otherwise we stay optimal.
  const useRooms = (process.env.LIPS_SEARCH ?? "").toLowerCase() === "rooms" && goalDist !== null;
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

  let bestWin = Infinity;
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

    // Expand pushes: for each box, each direction, if the player can reach the
    // pushing side and the far tile is empty (floor or box goal), push it.
    for (const b of boxes) {
      const br = Math.floor(b / p.w);
      const bc = b % p.w;
      for (const [dr, dc] of DIRS) {
        const fr = br + dr;
        const fc = bc + dc;
        const pr = br - dr;
        const pc = bc - dc;
        if (fr < 0 || fr >= p.h || fc < 0 || fc >= p.w) continue;
        if (pr < 0 || pr >= p.h || pc < 0 || pc >= p.w) continue;
        const far = fr * p.w + fc;
        const pushFrom = pr * p.w + pc;
        if (p.walls.has(far) || boxes.has(far)) continue; // far must be empty (floor or box goal)
        if (goalDist !== null && goalDist[far] === Infinity) {
          pruned++;
          continue;
        } // simple deadlock: box would land where it can never reach a goal
        if (!dist.has(pushFrom)) continue; // player cannot reach the pushing side
        const boxes2 = new Set(boxes);
        boxes2.delete(b);
        boxes2.add(far);
        if (goalDist !== null && freezeDeadlock(p, boxes2, goalDist, far)) {
          pruned++;
          continue;
        } // freeze deadlock: this push pins a box off-goal forever
        const player2 = b; // player ends where the box was
        const cost = cur.g + (dist.get(pushFrom) ?? 0) + 1;
        const info = regionInfo(p, boxes2, player2);
        const key2 = `${boxesKey(boxes2)}|${info.canonical}`;
        const prev2 = reached.get(key2);
        if (prev2 !== undefined && prev2.g <= cost) {
          pruned++;
          continue;
        }
        // O(1) component updates: only box `b` moved, from b to far.
        const h2 = goalDist === null ? 0 : cur.h - goalDist[b] + goalDist[far];
        const unc2 = cur.unc + (p.boxGoals.has(b) ? 1 : 0) - (p.boxGoals.has(far) ? 1 : 0);
        const nhome2 = cur.nhome - notHome(b) + notHome(far);
        reached.set(key2, { g: cost, parent: cur.key, viaBox: b, viaTo: far });
        heap.push({ key: key2, player: player2, g: cost, h: h2, unc: unc2, nhome: nhome2, pri: priOf(cost, h2, unc2, nhome2), region: info.size });
        pushed++;
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

  const states: { boxes: Set<number>; player: number }[] = [{ boxes: new Set(p.boxes), player: p.player }];
  for (let i = 1; i < keyChain.length; i++) {
    const e = reached.get(keyChain[i])!;
    const boxes = new Set(states[i - 1].boxes);
    boxes.delete(e.viaBox);
    boxes.add(e.viaTo);
    states.push({ boxes, player: e.viaBox }); // player ends where the pushed box was
  }

  // Expand each push into single player steps: walk to the pushing side, then push.
  const path: string[] = [render(p, states[0].boxes, states[0].player)];
  for (let i = 1; i < keyChain.length; i++) {
    const before = states[i - 1];
    const after = states[i];
    const e = reached.get(keyChain[i])!;
    const pushFrom = 2 * e.viaBox - e.viaTo; // cell the player stood on to push (box - dir)
    const { prev } = walkBFS(p, before.boxes, before.player);
    const walk = walkSteps(prev, pushFrom);
    for (let j = 1; j < walk.length; j++) path.push(render(p, before.boxes, walk[j]));
    path.push(render(p, after.boxes, after.player));
  }
  // Final walk to the player goal (if any), ending on it.
  if (winFrom.walkToGoal.length > 1) {
    const last = states[states.length - 1];
    for (let j = 1; j < winFrom.walkToGoal.length; j++) path.push(render(p, last.boxes, winFrom.walkToGoal[j]));
  }

  const moves = path.length - 1;
  const winning = path[path.length - 1];
  // Cap the returned path so the tool result stays small (full play is logged).
  const cappedPath = path.length <= MAX_PATH ? path : [...path.slice(0, MAX_PATH - 1), winning];

  return {
    ok: true,
    solvable: true,
    ruleset: rs.name,
    moves,
    pushes: keyChain.length - 1,
    explored,
    pushed,
    pruned,
    path: cappedPath,
    winning,
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
  "Deterministically solve a grid (ruleset default 'sokoban') and report the MINIMUM number of player moves. Full Sokoban: the player '@' moves onto floor '.', player goal 'x' (shown 'X') or an empty box goal '~' (shown '&'); walls '#' impassable; a box '+' (or one on a goal '*') is pushed when the tile beyond it is empty floor/box-goal. WIN: every box goal covered by a box AND (if present) the player on 'x'. The search is equivalence-collapsed over PUSHES (states differing only by where the player walked are one node) and ordered by player-step cost, so `moves` is the minimum step count; `pushes` is the box-push count. Very large state spaces stop at a cap (see `reason`). The per-state search progress is logged to the terminal, not returned here. Returns { solvable, moves, pushes, winning, explored, pushed, pruned }.",
  {
    grid: z.string().describe("the start state as an ASCII grid"),
    ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
  },
  async (args) => {
    const r = solve(args.grid, args.ruleset ?? DEFAULT_RULESET);
    const text = r.solvable
      ? `solvable in ${r.moves} move(s) / ${r.pushes} push(es) (explored ${r.explored} classes, pruned ${r.pruned})`
      : `not solvable — ${r.reason} (explored ${r.explored} classes, pruned ${r.pruned})`;
    // Omit the (potentially large) per-step `path` from the model-facing payload —
    // the full play streams to the terminal log instead. Keep just the win grid.
    const { path: _path, ...summary } = r;
    return { content: [{ type: "text", text }], structuredContent: summary };
  },
);
