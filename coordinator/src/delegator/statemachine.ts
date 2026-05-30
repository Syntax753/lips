import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { getRuleSet, DEFAULT_RULESET } from "../rules/index.js";

/**
 * State-machine delegator: given a game state as an ASCII grid and a ruleset,
 * deterministically enumerate ALL legal next states. Each next state is scored
 * by proximity of the player to the goal (lower = closer) and flagged `success`
 * when the move lands the player on the goal glyph.
 */

export type NextState = {
  grid: string;
  /** True when this move landed the player on the goal. */
  success: boolean;
  /** Manhattan distance from the player to the goal in this state (0 on win,
   *  null when there is no goal to measure against). Lower is closer. */
  score: number | null;
};

export type ExpandResult = {
  ok: boolean;
  ruleset: string;
  count: number;
  success: boolean; // any next state is a win
  states: NextState[];
  reason: string;
};

function parseGrid(grid: string): string[] {
  // Floor is a space (microban/XSB); `.` is a box goal, so spaces are left as-is.
  const rows = grid.replace(/\r/g, "").split("\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  if (rows.length === 0) throw new Error("empty grid");
  const width = rows[0].length;
  if (!rows.every((r) => r.length === width)) throw new Error("grid rows must all be the same width");
  return rows;
}

function findGlyph(rows: string[], glyph: string): [number, number] | null {
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].indexOf(glyph);
    if (c >= 0) return [r, c];
  }
  return null;
}

/** Manhattan distance between two glyphs in a grid, or null if either is absent. */
function distance(gridStr: string, a: string, b: string): number | null {
  const rows = gridStr.split("\n");
  const pa = findGlyph(rows, a);
  const pb = findGlyph(rows, b);
  if (!pa || !pb) return null;
  return Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]);
}

// Orthogonal neighbours: up, left, right, down.
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, 0],
];

export type GoalCheck = {
  met: boolean; // the win condition is satisfied
  boxGoalsCovered: boolean; // every box goal '~' is covered by a box
  playerOnGoal: boolean; // the player stands on the player goal 'x' (shown 'X')
  uncoveredBoxGoals: number; // '~' still uncovered
  reason: string;
};

/**
 * Postflight win validator: given a current grid, decide whether the goal has
 * been MET. The win is: every box goal `~` is covered by a box (none left), AND
 * — when the grid has a player goal — the player is standing on it (shown as the
 * `playerOnGoal` glyph 'X', so no uncovered `goal` 'x' remains). A grid with no
 * goals at all is not a win. This is the single decision point for completion.
 */
export function goalMet(grid: string, rulesetName: string = DEFAULT_RULESET): GoalCheck {
  const ruleset = getRuleSet(rulesetName);
  const has = (glyph?: string): boolean => !!glyph && grid.includes(glyph);
  const count = (glyph?: string): number => (glyph ? grid.split(glyph).length - 1 : 0);

  const hasBoxGoals = has(ruleset.boxGoal) || has(ruleset.boxOnGoal) || has(ruleset.playerOnBoxGoal); // '~','*','&'
  const hasPlayerGoal = has(ruleset.goal) || has(ruleset.playerOnGoal); // 'x' or 'X'
  // A box goal is uncovered if it's empty ('~') OR the player is standing on it ('&').
  const uncoveredBoxGoals = count(ruleset.boxGoal) + count(ruleset.playerOnBoxGoal);
  const uncoveredPlayerGoal = count(ruleset.goal); // 'x' the player hasn't reached

  const boxGoalsCovered = uncoveredBoxGoals === 0;
  const playerOnGoal = hasPlayerGoal && uncoveredPlayerGoal === 0; // reached -> shown as 'X'
  const boxGoalsMet = !hasBoxGoals || boxGoalsCovered;
  const playerGoalMet = !hasPlayerGoal || uncoveredPlayerGoal === 0;
  const met = (hasBoxGoals || hasPlayerGoal) && boxGoalsMet && playerGoalMet;

  let reason: string;
  if (!hasBoxGoals && !hasPlayerGoal) reason = "no goals in the grid";
  else if (met) reason = "win: all goals satisfied";
  else if (!boxGoalsMet) reason = `${uncoveredBoxGoals} box goal(s) still uncovered`;
  else reason = "player has not reached the goal 'x'";

  return { met, boxGoalsCovered, playerOnGoal, uncoveredBoxGoals, reason };
}

export function expand(grid: string, rulesetName: string = DEFAULT_RULESET): ExpandResult {
  const ruleset = getRuleSet(rulesetName);
  let rows: string[];
  try {
    rows = parseGrid(grid);
  } catch (err) {
    return { ok: false, ruleset: ruleset.name, count: 0, success: false, states: [], reason: (err as Error).message };
  }

  const height = rows.length;
  const width = rows[0].length;
  const states: NextState[] = [];
  const inBounds = (rr: number, cc: number): boolean => rr >= 0 && rr < height && cc >= 0 && cc < width;

  const boxGoal = ruleset.boxGoal;
  const boxOnGoal = ruleset.boxOnGoal;
  const playerOnBoxGoal = ruleset.playerOnBoxGoal;
  const countGlyph = (g: string, glyph?: string): number => (glyph ? g.split(glyph).length - 1 : 0);
  // Uncovered box goals: empty '~' plus any the player is standing on ('&').
  const uncovered = (g: string): number => countGlyph(g, boxGoal) + countGlyph(g, playerOnBoxGoal);
  const boxGoalMode =
    (!!boxGoal && grid.includes(boxGoal)) ||
    (!!boxOnGoal && grid.includes(boxOnGoal)) ||
    (!!playerOnBoxGoal && grid.includes(playerOnBoxGoal));

  // The player is '@' on floor, 'playerOnGoal' (X) on the player goal, or
  // 'playerOnBoxGoal' (&) on a box goal — it may step onto and off any of them.
  const playerGlyph = ruleset.rules[0]?.subject ?? "@";
  const playerOnGoal = ruleset.playerOnGoal;
  const isPlayer = (g: string): boolean =>
    g === playerGlyph || (!!playerOnGoal && g === playerOnGoal) || (!!playerOnBoxGoal && g === playerOnBoxGoal);
  // What the player leaves behind when stepping off a cell.
  const playerVacates = (g: string): string =>
    g === playerOnGoal ? ruleset.goal : g === playerOnBoxGoal && boxGoal ? boxGoal : ruleset.floor;
  // What the player becomes when stepping onto a destination cell.
  const playerEnters = (dest: string): string =>
    dest === ruleset.goal && playerOnGoal ? playerOnGoal : dest === boxGoal && playerOnBoxGoal ? playerOnBoxGoal : playerGlyph;

  // A box is '+' on floor or 'boxOnGoal' (*) on a box goal — both can be pushed.
  const isBox = (g: string): boolean => g === ruleset.box || (!!boxOnGoal && g === boxOnGoal);
  const boxVacates = (g: string): string => (g === boxOnGoal && boxGoal ? boxGoal : ruleset.floor);
  const boxEnters = (dest: string): string => (dest === boxGoal && boxOnGoal ? boxOnGoal : (ruleset.box as string));

  // Tiles the player may step directly onto: floor / player goal (per the MOV
  // rules) plus an empty box goal (which the player can cross).
  const walkable = new Set(ruleset.rules.filter((r) => r.subject === playerGlyph).map((r) => r.object));
  walkable.add(ruleset.floor);
  if (boxGoal) walkable.add(boxGoal);
  // A tile a box can be pushed into: empty floor or an empty box goal.
  const pushInto = (g: string): boolean => g === ruleset.floor || (!!boxGoal && g === boxGoal);

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const subject = rows[r][c];
      if (!isPlayer(subject)) continue; // only the player generates moves

      for (const [dr, dc] of DIRECTIONS) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        const target = rows[nr][nc];

        // Walls are impassable — the player may never move onto one.
        if (ruleset.wall && target === ruleset.wall) continue;

        // Box ('+' or '*'): moving onto it is legal ONLY if it can be pushed. The
        // tile one step further must be empty floor or an empty box goal; the box
        // slides there (covering a goal -> '*') and the player takes its square
        // (the box's old cell reverts to floor or — if it was on a goal — '~').
        if (isBox(target)) {
          const fr = nr + dr;
          const fc = nc + dc;
          if (!inBounds(fr, fc)) continue; // nothing beyond the box to push into
          const farTile = rows[fr][fc];
          if (!pushInto(farTile)) continue; // far side is not empty floor / box goal
          const next = rows.map((row) => row.split(""));
          next[r][c] = playerVacates(subject); // player leaves its cell
          next[nr][nc] = playerEnters(boxVacates(target)); // box's old cell reverts, player steps onto it
          next[fr][fc] = boxEnters(farTile); // box pushed one further (cover -> '*')
          const grid2 = next.map((row) => row.join("")).join("\n");
          const success = goalMet(grid2, ruleset.name).met;
          const score = boxGoalMode ? uncovered(grid2) : distance(grid2, playerGlyph, ruleset.goal);
          states.push({ grid: grid2, success, score });
          continue;
        }

        // Plain move onto a floor / player-goal / box-goal tile.
        if (walkable.has(target)) {
          const next = rows.map((row) => row.split(""));
          next[r][c] = playerVacates(subject); // player leaves its cell
          next[nr][nc] = playerEnters(target); // floor -> '@', 'x' -> 'X', '~' -> '&'
          const grid2 = next.map((row) => row.join("")).join("\n");
          const success = goalMet(grid2, ruleset.name).met;
          const score = boxGoalMode
            ? uncovered(grid2)
            : target === ruleset.goal
              ? 0
              : distance(grid2, playerGlyph, ruleset.goal);
          states.push({ grid: grid2, success, score });
        }
      }
    }
  }

  const success = states.some((s) => s.success);
  return {
    ok: true,
    ruleset: ruleset.name,
    count: states.length,
    success,
    states,
    reason: success ? "a move reaches the goal" : `${states.length} next state(s)`,
  };
}

export const statemachineTool = tool(
  "statemachine",
  "Given a game state as an ASCII grid and a ruleset (default 'sokoban', microban/XSB glyphs), return ALL legal next states. The player '@' moves orthogonally onto floor ' ' (space) or goal 'x' (standing on the goal is shown 'X'); walls '#' are impassable; a box '$' may be pushed only when the tile beyond it is empty floor or an empty box goal '.' (the box slides there — covering a goal makes it '*' — and the player takes its square). `success` is true when the WIN is met: every box goal '.' covered AND (if present) the player on 'x'. `score` is the count of uncovered box goals (or, with no box goals, the player's Manhattan distance to 'x'); lower = closer.",
  {
    grid: z.string().describe("the current state as an ASCII grid"),
    ruleset: z.string().optional().describe("ruleset name (default: sokoban)"),
  },
  async (args) => {
    const result = expand(args.grid, args.ruleset ?? DEFAULT_RULESET);
    const text = result.ok
      ? `${result.count} next state(s)${result.success ? " — one WINS" : ""}`
      : `invalid state: ${result.reason}`;
    return { content: [{ type: "text", text }], structuredContent: result };
  },
);
