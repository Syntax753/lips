import { solve } from "./src/delegator/solve.js";

const grid = [
  "    ##########     ",
  "####... ....####   ",
  "#     # $  $ #@ #  ",
  "# #######$####  ###",
  "# #    ## #  #$ . #",
  "# # $$ ...#$ #  #.#",
  "# # $  #   . #$ . #",
  "# #  ### ##. $  #.#",
  "# ###  #  #  #  . #",
  "# #   $# $####  #.#",
  "# #$   $  $  #$ . #",
  "#    $ # $ $ #  #.#",
  "#### $###    #$ . #",
  " # $  $ $$ ###....#",
  " #        ## ######",
  " #   ######        ",
  " #####             ",
].join("\n");

// width + box/goal census (microban/XSB glyphs)
const rows = grid.split("\n");
const widths = [...new Set(rows.map((r) => r.length))];
const boxes = (grid.match(/[$]/g) ?? []).length + (grid.match(/[*]/g) ?? []).length;
const goals = (grid.match(/[.]/g) ?? []).length + (grid.match(/[*+]/g) ?? []).length;
console.log(`grid ${rows[0].length}x${rows.length}, row widths: ${JSON.stringify(widths)}`);
console.log(`boxes($)=${boxes}  boxGoals(.)=${goals}  (heuristic/decompose need them equal: ${boxes === goals})`);

const mode = process.env.LIPS_SEARCH ?? "optimal";
console.log(`\n=== solving (mode=${mode}, LIPS_MAX_STATES=${process.env.LIPS_MAX_STATES ?? "default"}) ===`);
const t0 = Date.now();
const r = solve(grid);
const ms = Date.now() - t0;
console.log(`ok=${r.ok} solvable=${r.solvable} moves=${r.moves} pushes=${r.pushes} explored=${r.explored} pushed=${r.pushed} pruned=${r.pruned}  (${ms} ms)`);
console.log(`reason: ${r.reason}`);
if (r.solvable && r.winning) {
  console.log("\nfinal grid:");
  console.log(r.winning);
}
