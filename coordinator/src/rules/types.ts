/**
 * Rules in a PuzzleScript-ish notation: `subject verb object`.
 * For now the only verb is MOV: `"@ MOV ."` means the `@` glyph may move
 * orthogonally onto any adjacent `.` glyph.
 */

export type Verb = "MOV";

export type Rule = { subject: string; verb: Verb; object: string };

export type RuleSet = { name: string; rules: Rule[] };

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
