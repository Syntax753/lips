/**
 * Rules in a PuzzleScript-ish notation: `subject verb object`.
 * For now the only verb is MOV: `"@ MOV ."` means the `@` glyph may move
 * orthogonally onto any adjacent `.` glyph.
 */

export type Verb = "MOV";

export type Rule = { subject: string; verb: Verb; object: string };

export type RuleSet = {
  name: string;
  rules: Rule[];
  /** Glyph left behind when a subject moves off a cell (the floor). */
  floor: string;
  /** Victory glyph — a move that lands the player on it is success. */
  goal: string;
  /** Impassable glyph: no subject may ever move onto it (e.g. a wall). Optional. */
  wall?: string;
  /**
   * Pushable glyph (e.g. a box): a subject may move onto it ONLY if the tile one
   * step further in the same direction is empty floor (or an empty box goal); the
   * box slides there and the subject takes the box's old square. Optional.
   */
  box?: string;
  /**
   * Box-goal glyph: a target a box must be pushed onto. When a grid contains any
   * box goals, the objective becomes covering them ALL with boxes (rather than
   * walking the player to `goal`). A box pushed onto an empty box goal becomes
   * `boxOnGoal`. Optional.
   */
  boxGoal?: string;
  /** Glyph for a box sitting on a box goal (a covered goal). Optional. */
  boxOnGoal?: string;
  /**
   * Glyph for the player standing on the player goal `goal`. Lets the player
   * step onto and off the goal (reverting to `goal`), so the win check — player
   * currently on the goal — is robust. Optional.
   */
  playerOnGoal?: string;
  /**
   * Glyph for the player standing on an (uncovered) box goal `boxGoal`. Lets the
   * player cross box goals and end on one after pushing a covered box off it
   * (reverting to `boxGoal`). Optional.
   */
  playerOnBoxGoal?: string;
};

export function parseRule(text: string): Rule {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 3) {
    throw new Error(`rule must read "<subject> <verb> <object>": "${text}"`);
  }
  const [subject, verb, object] = parts;
  if (verb !== "MOV") throw new Error(`unsupported verb "${verb}" (only MOV is defined)`);
  if (subject.length !== 1 || object.length !== 1) {
    throw new Error(`subject and object must be single glyphs: "${text}"`);
  }
  return { subject, verb: "MOV", object };
}
