/**
 * Demo report harness — run the deterministic Sokoban solver across the whole
 * Microban corpus and print a professional, scannable report:
 *
 *   1. a per-level TABLE (boxes · result · moves · pushes · time), and
 *   2. the actual PLAYER MOVES to solve each level, in canonical LURD notation
 *      (lowercase u/d/l/r = a step, UPPERCASE = a push).
 *
 * Every printed move string is independently REPLAYED to a win before it is
 * accepted (planToLURD validates), so the report is self-checking, not just a
 * dump of solver claims.
 *
 *   npm run report                 # all 155 levels
 *   npm run report -- 1-40         # a range (fast demo)
 *   npm run report -- 3,7,93       # specific levels
 *   npm run report -- --boards     # also print each start board (microban glyphs)
 *   LIPS_MAX_STATES=1500000 npm run report   # full-strength search cap
 *   NO_COLOR=1 npm run report      # plain text
 *
 * Boards/grids are shown in the standard microban/XSB glyph set
 * (# wall  @ player  $ box  . goal  * box-on-goal  + player-on-goal).
 */
import { loadMicroban, type MicrobanLevel } from "./sokoban/microban.js";

// A snappy default cap for the demo (≈150/155 solved in a few minutes); override
// with LIPS_MAX_STATES. Set BEFORE importing the solver, which reads it at load.
if (!process.env.LIPS_MAX_STATES) process.env.LIPS_MAX_STATES = "300000";
const { solve, planToLURD } = await import("../delegator/solve.js");

// ── argv: an optional level selector ("1-40" | "3,7,93") plus flags ──
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const selector = argv.find((a) => !a.startsWith("--"));
const showBoards = flags.has("--boards");

// ── colour (auto: on for a TTY unless NO_COLOR) ──
const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
const sgr = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = sgr("1");
const dim = sgr("2");
const gray = sgr("90");
const green = sgr("92");
const red = sgr("91");
const yellow = sgr("93");
const cyan = sgr("96");

// ── formatting helpers ──
const int = (n: number): string => n.toLocaleString("en-US");
const fmtTime = (ms: number): string =>
  ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} m`;
const padL = (s: string, n: number): string => s.padStart(n);
const padR = (s: string, n: number): string => s.padEnd(n);
const wrap = (s: string, n: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
};

function pickLevels(all: MicrobanLevel[], sel?: string): MicrobanLevel[] {
  if (!sel) return all;
  const range = /^(\d+)-(\d+)$/.exec(sel);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    return all.filter((l) => l.number >= a && l.number <= b);
  }
  const set = new Set(sel.split(",").map((s) => Number(s.trim())));
  return all.filter((l) => set.has(l.number));
}

type Outcome = "optimal" | "satisficing" | "capped" | "unsolved" | "invalid";
interface Row {
  lv: MicrobanLevel;
  outcome: Outcome;
  moves: number | null;
  pushes: number | null;
  ms: number;
  lurd: string | null;
}

const STATUS: Record<Outcome, { label: string; paint: (s: string) => string }> = {
  optimal: { label: "✓ optimal", paint: green },
  satisficing: { label: "✓ solved*", paint: yellow },
  capped: { label: "✗ capped", paint: red },
  unsolved: { label: "✗ unsolved", paint: red },
  invalid: { label: "✗ bad-plan", paint: red },
};

const all = loadMicroban();
const levels = pickLevels(all, selector);
const capStr = int(Number(process.env.LIPS_MAX_STATES));
const COLW = 64;

// ── header ──
console.log(cyan(bold("lips · Sokoban solver — Microban corpus")));
console.log(gray(`David W. Skinner · ${all.length} public-domain levels`));
console.log(gray(`search: auto (optimal → satisficing)   ·   cap: ${capStr} states   ·   running ${levels.length} level(s)`));
console.log(gray("glyphs: # wall   @ player   $ box   . goal   * box-on-goal   + player-on-goal"));
console.log();

// ── table ──
console.log(bold(`${padL("Lvl", 4)}  ${padL("Box", 3)}  ${padR("Result", 11)}  ${padL("Moves", 6)}  ${padL("Pushes", 7)}  ${padL("Time", 8)}`));
console.log(gray("─".repeat(COLW)));

const rows: Row[] = [];
const t0all = Date.now();
for (const lv of levels) {
  const t0 = Date.now();
  const r = solve(lv.grid); // auto mode (optimal, falling back to satisficing)
  const ms = Date.now() - t0;

  let outcome: Outcome;
  let moves: number | null = null;
  let pushes: number | null = null;
  let lurd: string | null = null;

  if (r.solvable && r.plan) {
    const rep = planToLURD(lv.grid, r.plan); // replay → the verified move string
    if (rep.valid) {
      moves = rep.moves;
      pushes = rep.pushes;
      lurd = rep.lurd;
      outcome = r.optimal ? "optimal" : "satisficing";
    } else {
      outcome = "invalid"; // solver claimed a win the plan does not actually reach
    }
  } else {
    outcome = /search limit|too large/.test(r.reason) ? "capped" : "unsolved";
  }

  rows.push({ lv, outcome, moves, pushes, ms, lurd });

  const st = STATUS[outcome];
  console.log(
    `${padL(String(lv.number), 4)}  ${padL(String(lv.boxes), 3)}  ${st.paint(padR(st.label, 11))}  ` +
      `${padL(moves === null ? "–" : int(moves), 6)}  ${padL(pushes === null ? "–" : int(pushes), 7)}  ` +
      `${padL(fmtTime(ms), 8)}`,
  );
}
const totalMs = Date.now() - t0all;

// ── summary ──
const count = (o: Outcome): number => rows.filter((r) => r.outcome === o).length;
const solved = count("optimal") + count("satisficing");
console.log(gray("─".repeat(COLW)));
console.log(
  bold(`${solved}/${rows.length} solved`) +
    gray(`   (${count("optimal")} optimal · ${count("satisficing")} satisficing)`) +
    (count("capped") ? gray(`   ${count("capped")} capped`) : "") +
    (count("unsolved") ? gray(`   ${count("unsolved")} unsolved`) : "") +
    (count("invalid") ? red(`   ${count("invalid")} bad-plan`) : "") +
    gray(`   ·   total ${fmtTime(totalMs)}`),
);
if (count("satisficing") > 0) console.log(dim("* satisficing — a valid solution, not proven minimal"));

// ── solutions (the actual player moves) ──
console.log();
console.log(cyan(bold("Solutions")) + gray("   player moves · lowercase = step, UPPERCASE = push"));
console.log();
for (const row of rows) {
  if (!row.lurd) continue;
  const tag = row.outcome === "optimal" ? green("optimal") : yellow("satisficing");
  console.log(
    `${bold(`Level ${row.lv.number}`)}  ${gray(`${row.lv.boxes} box · ${row.moves} moves · ${row.pushes} pushes ·`)} ${tag}`,
  );
  if (showBoards) {
    for (const ln of row.lv.grid.split("\n")) console.log(gray("    " + ln));
    console.log();
  }
  for (const ln of wrap(row.lurd, COLW - 4)) console.log("    " + ln);
  console.log();
}
