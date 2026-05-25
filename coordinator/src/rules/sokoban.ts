import { parseRule, type RuleSet } from "./types.js";

/**
 * Sokoban — without boxes (for now). The player `@` may move orthogonally onto
 * an adjacent floor tile `.` or the goal tile `x`; landing on `x` is success.
 * Walls `#` are impassable — the player can never move onto one. The player
 * leaves floor `.` behind. (Boxes come later.)
 */
export const sokoban: RuleSet = {
  name: "sokoban",
  rules: [parseRule("@ MOV ."), parseRule("@ MOV x")],
  floor: ".",
  goal: "x",
  wall: "#",
};
