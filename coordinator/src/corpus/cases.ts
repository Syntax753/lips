import type { SolverKind } from "../solvers/contract.js";

/**
 * The example corpus: one place to collect solvable-input examples across every
 * domain, each with its expected verdict. The runner (`corpus.test.ts`) feeds
 * every case through the SINGLE deterministic entry point — `validate(input)` —
 * and asserts the result, so the corpus exercises classify -> route -> solve end
 * to end. Adding a case is the unit test for that capability.
 *
 * `expect.valid` is always asserted. `moves` / `pushes` / `solution`, when given,
 * are asserted too. For grids, `moves` is the proven MINIMUM step count; `pushes`
 * is the solver's push-EVENT count (a tunnel macro that slides a box several
 * cells counts as one). Small grids are hand-verified; larger ones are regression
 * baselines captured from the solver (see `source`).
 *
 * HARD_CASES are large boards used by the tuning bench (`bench.mts`), NOT the
 * pass/fail suite — they may exceed the optimal search cap and are about metrics
 * (explored / pushed / pruned / ms) under different search modes, not a verdict.
 */

export interface Case {
  id: string;
  domain: SolverKind;
  /** The raw input, exactly as a host would pass it to `validate`. */
  input: string;
  expect: {
    /** Omit when solvability is genuinely unknown (open tuning targets). */
    valid?: boolean;
    moves?: number;
    pushes?: number;
    solution?: Record<string, number>;
  };
  difficulty: "trivial" | "easy" | "medium" | "hard";
  /** "hand-verified" = independently checked; "baseline" = captured from solve(). */
  source: string;
  note?: string;
}

const g = (...rows: string[]): string => rows.join("\n");

export const BOOLEAN_CASES: Case[] = [
  { id: "bool-gt-false", domain: "boolean", input: "12 > 14", expect: { valid: false }, difficulty: "trivial", source: "hand-verified" },
  { id: "bool-gte-true", domain: "boolean", input: "is 14 >= 14?", expect: { valid: true }, difficulty: "trivial", source: "hand-verified" },
  { id: "bool-and", domain: "boolean", input: "5 > 3 and 2 < 1", expect: { valid: false }, difficulty: "easy", source: "hand-verified" },
  { id: "bool-or", domain: "boolean", input: "5 > 3 or 2 < 1", expect: { valid: true }, difficulty: "easy", source: "hand-verified" },
  { id: "bool-neq", domain: "boolean", input: "100 != 99", expect: { valid: true }, difficulty: "trivial", source: "hand-verified" },
  { id: "bool-eq-true", domain: "boolean", input: "5 = 5", expect: { valid: true }, difficulty: "trivial", source: "hand-verified" },
];

export const ALGEBRA_CASES: Case[] = [
  { id: "alg-2x2", domain: "algebraic", input: "x + y = 10; x - y = 2", expect: { valid: true, solution: { x: 6, y: 4 } }, difficulty: "easy", source: "hand-verified" },
  { id: "alg-tony", domain: "algebraic", input: "M = 4*T; M - 10 = 2*(T - 10)", expect: { valid: true, solution: { T: -5, M: -20 } }, difficulty: "easy", source: "hand-verified", note: "negative age — mathematically sound, real-world impossible" },
  { id: "alg-1x1", domain: "algebraic", input: "2*a = 10", expect: { valid: true, solution: { a: 5 } }, difficulty: "trivial", source: "hand-verified" },
  { id: "alg-underdetermined", domain: "algebraic", input: "x + y = 3", expect: { valid: false }, difficulty: "easy", source: "hand-verified", note: "one equation, two unknowns" },
  { id: "alg-inconsistent", domain: "algebraic", input: "x = 1; x = 2", expect: { valid: false }, difficulty: "easy", source: "hand-verified", note: "no solution" },
];

export const GRID_CASES: Case[] = [
  { id: "grid-push1", domain: "grid", input: g("#####", "#@+~#", "#####"), expect: { valid: true, moves: 1, pushes: 1 }, difficulty: "trivial", source: "hand-verified" },
  { id: "grid-push2", domain: "grid", input: g("######", "#@+.~#", "######"), expect: { valid: true, moves: 2, pushes: 2 }, difficulty: "trivial", source: "hand-verified", note: "box pushed two cells = two single-cell push events" },
  { id: "grid-push-left", domain: "grid", input: g("#######", "#~ + @#", "#######"), expect: { valid: true, moves: 3, pushes: 2 }, difficulty: "easy", source: "hand-verified" },
  { id: "grid-walk-around", domain: "grid", input: g("#######", "#~ +  #", "#   @ #", "#######"), expect: { valid: true, moves: 3, pushes: 2 }, difficulty: "easy", source: "hand-verified" },
  { id: "grid-player-goal", domain: "grid", input: g("#####", "#@.x#", "#####"), expect: { valid: true, moves: 2, pushes: 0 }, difficulty: "trivial", source: "hand-verified", note: "player-goal only, no boxes" },
  { id: "grid-two-box-row", domain: "grid", input: g("#######", "#@ +.~#", "#  +.~#", "#######"), expect: { valid: true, moves: 8, pushes: 4 }, difficulty: "medium", source: "baseline (solve)" },
  { id: "grid-classic-small", domain: "grid", input: g("######", "#.  .#", "#.+@.#", "#.+ .#", "#. ~~#", "######"), expect: { valid: true, moves: 16, pushes: 6 }, difficulty: "medium", source: "baseline (solve)" },
  { id: "grid-corner-deadlock", domain: "grid", input: g("#####", "#@ +#", "#  ~#", "#####"), expect: { valid: false }, difficulty: "easy", source: "hand-verified", note: "box pinned against a wall, off-goal — simple deadlock" },
];

// Timelines are passed to `validate` as JSON text (the host's MCP payload).
const tl = (characters: unknown): string => JSON.stringify(characters);

export const TIMELINE_CASES: Case[] = [
  {
    id: "tl-chain-connected",
    domain: "timeline",
    input: tl([
      { id: "A", intervals: [{ starttime: 0, endtime: 5, locationid: "P" }] },
      { id: "B", intervals: [{ starttime: 3, endtime: 8, locationid: "P" }, { starttime: 10, endtime: 15, locationid: "Q" }] },
      { id: "C", intervals: [{ starttime: 12, endtime: 20, locationid: "Q" }] },
    ]),
    expect: { valid: true },
    difficulty: "easy",
    source: "hand-verified",
    note: "A-B meet at P, B-C at Q -> one connected chain",
  },
  {
    id: "tl-two-groups",
    domain: "timeline",
    input: tl([
      { id: "A", intervals: [{ starttime: 0, endtime: 5, locationid: "P" }] },
      { id: "B", intervals: [{ starttime: 1, endtime: 2, locationid: "P" }] },
      { id: "C", intervals: [{ starttime: 0, endtime: 9, locationid: "Z" }] },
      { id: "D", intervals: [{ starttime: 1, endtime: 3, locationid: "Z" }] },
    ]),
    expect: { valid: false },
    difficulty: "easy",
    source: "hand-verified",
    note: "{A,B} and {C,D} never share a place — two components",
  },
  {
    id: "tl-same-place-disjoint-time",
    domain: "timeline",
    input: tl([
      { id: "A", intervals: [{ starttime: 0, endtime: 5, locationid: "P" }] },
      { id: "B", intervals: [{ starttime: 6, endtime: 9, locationid: "P" }] },
    ]),
    expect: { valid: false },
    difficulty: "easy",
    source: "hand-verified",
    note: "same location, no time overlap -> no encounter",
  },
  {
    // The open-timeline framing: locationid = a shared work, time = its year.
    // A "six degrees" chain — the connect-people skill assembles these from search.
    id: "tl-co-appearance-chain",
    domain: "timeline",
    input: tl([
      { id: "Travolta", intervals: [{ starttime: 1994, endtime: 1994, locationid: "Pulp Fiction" }] },
      { id: "Willis", intervals: [
        { starttime: 1994, endtime: 1994, locationid: "Pulp Fiction" },
        { starttime: 1995, endtime: 1995, locationid: "Twelve Monkeys" },
      ] },
      { id: "Pitt", intervals: [{ starttime: 1995, endtime: 1995, locationid: "Twelve Monkeys" }] },
    ]),
    expect: { valid: true },
    difficulty: "easy",
    source: "hand-verified",
    note: "co-stars link via shared films across years",
  },
];

/** All assertable cases, across domains. */
export const CASES: Case[] = [...BOOLEAN_CASES, ...ALGEBRA_CASES, ...GRID_CASES, ...TIMELINE_CASES];

/**
 * Large boards for the tuning bench — NOT asserted. The headline example from
 * run_solve.mts: 19x17, many boxes/goals. Used to tune the satisficing modes
 * (LIPS_SEARCH=rooms|decompose) and track search metrics, not a pass/fail.
 */
export const HARD_CASES: Case[] = [
  {
    id: "hard-19x17",
    domain: "grid",
    input: g(
      "....##########.....",
      "####~~~ ~~~~####...",
      "#     # +  + #@ #..",
      "# #######+####  ###",
      "# #    ## #  #+ ~ #",
      "# # ++ ~~~#+ #  #~#",
      "# # +  #   ~ #+ ~ #",
      "# #  ### ##~ +  #~#",
      "# ###  #  #  #  ~ #",
      "# #   +# +####  #~#",
      "# #+   +  +  #+ ~ #",
      "#    + # + + #  #~#",
      "#### +###    #+ ~ #",
      ".# +  + ++ ###~~~~#",
      ".#        ## ######",
      ".#   ######........",
      ".#####.............",
    ),
    expect: {}, // solvability UNCONFIRMED — see note
    difficulty: "hard",
    source: "run_solve.mts headline board",
    note: "OPEN TUNING TARGET: as of this writing no mode (optimal/rooms/decompose) finds a solution within 200k states — solvability is unconfirmed. The bench tracks search effort here.",
  },
];
