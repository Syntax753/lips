import { solve, renderResult } from "../delegator/solve.js";
import { loadMicroban } from "./sokoban/microban.js";

/**
 * Solve EVERY Microban level and print, per level, the analysis and the full
 * solution steps (the same view the `solve` MCP tool renders: lower bound, box
 * trails, push vectors, player route). Colour is auto-off when piped to a file.
 *
 *   npx tsx src/corpus/microban-solve.mts                    # all 155 to stdout
 *   LIPS_MAX_STATES=300000 npx tsx src/corpus/microban-solve.mts > out.txt
 */

const levels = loadMicroban();
const pad = (s: string | number, n: number) => String(s).padStart(n);
const cap = process.env.LIPS_MAX_STATES ?? "1500000";

let solved = 0;
let optimal = 0;
let totalMs = 0;
const summary: string[] = [];

console.log(`Microban — solving all ${levels.length} levels (state cap = ${cap})`);

for (const lv of levels) {
  const rows = lv.grid.split("\n");
  const t0 = Date.now();
  const r = solve(lv.grid);
  const ms = Date.now() - t0;
  totalMs += ms;

  console.log(`\n\n${"═".repeat(64)}`);
  console.log(`MICROBAN LEVEL ${lv.number}  —  ${rows[0].length}×${rows.length} grid, ${lv.boxes} box(es)`);
  console.log("═".repeat(64));
  console.log("start state:");
  console.log(lv.grid);
  console.log();

  if (r.solvable) {
    solved++;
    if (r.optimal) optimal++;
    // renderResult prints: header (moves/pushes/optimal), lower bound (ANALYSIS),
    // the box-trail grid, the push VECTORS, and the player ROUTE (SOLUTION STEPS).
    console.log(renderResult(lv.grid, r, false));
    if (r.analysis) {
      const asg = r.analysis.assignment
        .map((a) => `box(${Math.floor(a.box / r.analysis!.w)},${a.box % r.analysis!.w})→goal(${Math.floor(a.goal / r.analysis!.w)},${a.goal % r.analysis!.w})[lb ${a.lb}]`)
        .join("  ");
      console.log(`\nanalysis · lower bound ${r.analysis.lowerBound} pushes · box→goal: ${asg}`);
    }
  } else {
    console.log(`analysis · NO solution within the state cap`);
    console.log(`solution · none — ${r.reason}`);
  }
  console.log(`(time ${ms} ms · explored ${r.explored} classes)`);

  const tag = r.solvable ? (r.optimal ? "OPTIMAL" : "satisf.") : "CAPPED ";
  summary.push(
    `${pad(lv.number, 3)}  boxes=${lv.boxes}  ${tag}  moves=${pad(r.moves ?? "-", 4)}  pushes=${pad(r.pushes ?? "-", 3)}  explored=${pad(r.explored, 8)}  ${pad(ms, 6)}ms`,
  );
}

console.log(`\n\n${"═".repeat(64)}`);
console.log(`SUMMARY — solved ${solved}/${levels.length} (${optimal} proven-optimal) · total ${totalMs} ms · cap ${cap}`);
console.log("═".repeat(64));
for (const s of summary) console.log(s);
const capped = levels.length - solved;
if (capped > 0) console.log(`\n${capped} level(s) hit the state cap (genuinely hard at this cap, not a bug).`);
