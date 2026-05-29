import { readFileSync } from "node:fs";
import { solveTimeline } from "../delegator/timeline.js";

/**
 * Deterministic timeline-connectivity CLI — the verification step of the
 * `connect-people` skill. Reads a characters JSON (a path arg, or stdin) and
 * prints whether everyone is mutually reachable through shared, time-overlapping
 * locations, plus the encounter walk (or the stranded groups). No network, no
 * model: the skill does the discovery, this proves the link.
 *
 *   npm run connect -- timeline.json
 *   cat timeline.json | npm run connect
 *
 * Input shape (locationid = a shared work/event; times = years):
 *   [ { "id": "Alice", "intervals": [ { "starttime": 1994, "endtime": 1994, "locationid": "Pulp Fiction" } ] }, ... ]
 */

const arg = process.argv[2];
let raw: string;
try {
  raw = arg ? readFileSync(arg, "utf8") : readFileSync(0, "utf8");
} catch (e) {
  console.error(`could not read input (${arg ?? "stdin"}): ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

let data: unknown;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error(`input is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

const r = solveTimeline(data);
if (!r.ok) {
  console.error(`bad timeline: ${r.reason}`);
  process.exit(1);
}

console.log(r.connected ? `CONNECTED — ${r.reason}` : `NOT CONNECTED — ${r.reason}`);
if (r.connected && r.encounter.length > 0) {
  console.log("\nencounter walk:");
  for (const s of r.encounter) console.log(`  ${s.from} → ${s.to}  via "${s.locationid}"  [${s.start}..${s.end}]`);
} else if (!r.connected) {
  console.log("\nunreachable groups:");
  for (const g of r.components) console.log(`  { ${g.join(", ")} }`);
}
console.log(`\n${JSON.stringify(r)}`);
