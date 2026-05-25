import { parseRule, type RuleSet } from "./types.js";

/**
 * Sokoban — without boxes (for now). The player `@` may move orthogonally onto
 * an adjacent floor tile `.` or the goal tile `x`; landing on `x` is success.
 * The player leaves floor `.` behind. (Walls and boxes come later.)
 */
export const sokoban: RuleSet = {
  name: "sokoban",
  rules: [parseRule("@ MOV ."), parseRule("@ MOV x")],
  floor: ".",
  goal: "x",
};
