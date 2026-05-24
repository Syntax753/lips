import { sokoban } from "./sokoban.js";
import type { RuleSet } from "./types.js";

export type { Rule, RuleSet, Verb } from "./types.js";
export { parseRule } from "./types.js";
export { sokoban } from "./sokoban.js";

export const DEFAULT_RULESET = "sokoban";

const registry: Record<string, RuleSet> = { sokoban };

export function getRuleSet(name: string = DEFAULT_RULESET): RuleSet {
  const ruleset = registry[name];
  if (!ruleset) {
    throw new Error(`unknown ruleset "${name}" (have: ${Object.keys(registry).join(", ")})`);
  }
  return ruleset;
}
