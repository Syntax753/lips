import { parseRule, type RuleSet } from "./types.js";

/**
 * Sokoban. The player `@` moves orthogonally onto an adjacent floor tile `.` or
 * the goal tile `x`; landing on `x` is success. Walls `#` are impassable. A box
 * `+` can be pushed when the tile one step beyond it is empty floor `.` (or an
 * empty box goal `~`) — the box slides there and the player takes the box's old
 * square. Box goals `~` are targets: when a grid has any, the objective becomes
 * covering them ALL with boxes (a box pushed onto `~` becomes `*`); a box on a
 * goal can be pushed off again (full Sokoban). The player on the goal `x` is
 * shown as `X`, and on an uncovered box goal `~` as `&` (both may step off). The
 * win is met when every box goal is covered AND the player is on `x`. The player
 * leaves floor `.` behind.
 */
export const sokoban: RuleSet = {
  name: "sokoban",
  rules: [parseRule("@ MOV ."), parseRule("@ MOV x")],
  floor: ".",
  goal: "x",
  wall: "#",
  box: "+",
  boxGoal: "~",
  boxOnGoal: "*",
  playerOnGoal: "X",
  playerOnBoxGoal: "&",
};
