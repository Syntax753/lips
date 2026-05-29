import { solve } from "../delegator/solve.js";
import { HARD_CASES } from "./cases.js";

/**
 * Tuning bench for the hard boards: run each HARD_CASE under every search mode
 * and print the metrics that matter for tuning — solvability, moves/pushes, and
 * the search effort (explored / pushed / pruned / ms). This is the harness for
 * "use the complex ones to fine-tune the algorithms": change a heuristic, re-run,
 * compare. It is NOT a pass/fail test (the optimal mode may hit the state cap).
 *
 *   npm run bench                       # all hard cases, all modes
 *   LIPS_MAX_STATES=300000 npm run bench
 *
 * Each mode is set via LIPS_SEARCH, which solve() reads per call.
 */

type Mode = "optimal" | "rooms" | "decompose";
const MODES: Mode[] = ["optimal", "rooms", "decompose"];

const onlyId = process.argv[2]; // optional: bench a single case by id
const cases = onlyId ? HARD_CASES.filter((c) => c.id === onlyId) : HARD_CASES;
if (cases.length === 0) {
  console.error(`no hard case matches "${onlyId}". have: ${HARD_CASES.map((c) => c.id).join(", ")}`);
  process.exit(1);
}

const pad = (s: string | number, n: number) => String(s).padStart(n);

for (const c of cases) {
  const boxes = (c.input.match(/\+/g) ?? []).length + (c.input.match(/\*/g) ?? []).length;
  const goals = (c.input.match(/~/g) ?? []).length + (c.input.match(/\*/g) ?? []).length;
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
