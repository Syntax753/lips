import { parseRule, type RuleSet } from "./types.js";

/**
 * Sokoban — without boxes (for now). The player `@` may move orthogonally onto
 * any adjacent floor tile `.`. (Walls, boxes and goals come later.)
 */
export const sokoban: RuleSet = {
  name: "sokoban",
  rules: [parseRule("@ MOV .")],
};
