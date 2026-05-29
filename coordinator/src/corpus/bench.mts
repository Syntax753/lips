import { solve } from "../delegator/solve.js";
import { HARD_CASES } from "./cases.js";
import { loadMicroban } from "./sokoban/microban.js";

/**
 * Tuning bench. Two modes:
 *
 *   npm run bench                 # the HARD_CASES boards, every search mode
 *   npm run bench -- <id>         # one hard case by id
 *   npm run bench -- microban     # the full Microban difficulty curve (optimal)
 *   LIPS_MAX_STATES=100000 npm run bench -- microban
 *
 * It is for tuning, not pass/fail: it reports solvability and search effort
 * (explored / pushed / pruned / ms) so a heuristic change can be measured, and
 * shows where the solver falls off the difficulty curve.
 */

const pad = (s: string | number, n: number) => String(s).padStart(n);
const arg = process.argv[2];

if (arg === "microban") {
  benchMicroban();
} else {
  benchHard(arg);
}

/** Run every Microban level under the OPTIMAL solver and print the curve. */
function benchMicroban(): void {
  delete process.env.LIPS_SEARCH; // force optimal mode
  const levels = loadMicroban();
  console.log(`Microban — ${levels.length} levels, optimal mode, cap=${process.env.LIPS_MAX_STATES ?? "1500000"}\n`);
  console.log("  #   boxes  cells   solvable  moves  pushes   explored      ms");

  let solved = 0;
  let firstMiss = 0;
  let totalMs = 0;
  const misses: number[] = [];
  for (const lv of levels) {
    const t0 = Date.now();
    const r = solve(lv.grid);
    const ms = Date.now() - t0;
    totalMs += ms;
    if (r.solvable) solved++;
    else {
      misses.push(lv.number);
      if (firstMiss === 0) firstMiss = lv.number;
    }
    console.log(
      `${pad(lv.number, 3)}   ${pad(lv.boxes, 3)}   ${pad(lv.cells, 5)}   ` +
        `${pad(String(r.solvable), 8)}  ${pad(r.moves ?? "-", 5)}  ${pad(r.pushes ?? "-", 6)}  ` +
        `${pad(r.explored, 9)}  ${pad(ms, 6)}`,
    );
  }
  console.log(
    `\nsolved ${solved}/${levels.length} within the cap; first miss at level ${firstMiss || "none"}; ` +
      `total ${totalMs} ms`,
  );
  if (misses.length > 0) console.log(`misses (tuning targets): ${misses.join(", ")}`);
}

/** Run the HARD_CASES boards under every search mode. */
function benchHard(onlyId?: string): void {
  type Mode = "optimal" | "rooms" | "decompose";
  const MODES: Mode[] = ["optimal", "rooms", "decompose"];
  const cases = onlyId ? HARD_CASES.filter((c) => c.id === onlyId) : HARD_CASES;
  if (cases.length === 0) {
    console.error(`no hard case matches "${onlyId}". have: ${HARD_CASES.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
  for (const c of cases) {
    const boxes = (c.input.match(/[+*]/g) ?? []).length;
    const goals = (c.input.match(/[~*&]/g) ?? []).length;
    console.log(`\n=== ${c.id} (${c.difficulty}) — boxes=${boxes} goals=${goals} — ${c.source} ===`);
    console.log("mode        ok    solvable  moves  pushes   explored    pushed    pruned     ms");
    for (const mode of MODES) {
      process.env.LIPS_SEARCH = mode;
      const t0 = Date.now();
      const r = solve(c.input);
      const ms = Date.now() - t0;
      console.log(
        `${mode.padEnd(10)}  ${pad(String(r.ok), 4)}  ${pad(String(r.solvable), 8)}  ` +
          `${pad(r.moves ?? "-", 5)}  ${pad(r.pushes ?? "-", 6)}  ${pad(r.explored, 9)}  ` +
          `${pad(r.pushed, 8)}  ${pad(r.pruned, 8)}  ${pad(ms, 6)}`,
      );
    }
  }
  console.log();
}
