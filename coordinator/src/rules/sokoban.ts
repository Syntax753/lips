import { parseRule, type RuleSet } from "./types.js";

/**
 * Sokoban. The player `@` moves orthogonally onto an adjacent floor tile `.` or
 * the goal tile `x`; landing on `x` is success. Walls `#` are impassable. A box
 * `+` can be pushed: moving onto a box is legal only when the tile one step
 * beyond it (away from the player) is empty floor `.` — the box slides onto that
 * floor and the player takes the box's old square. The player leaves floor `.`
 * behind.
 */
export const sokoban: RuleSet = {
  name: "sokoban",
  rules: [parseRule("@ MOV ."), parseRule("@ MOV x")],
  floor: ".",
  goal: "x",
  wall: "#",
  box: "+",
};
