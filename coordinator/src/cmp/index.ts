import type { Comparator } from "./comparator.js";
import { NumericComparator } from "./numeric.js";
import { AlphaComparator } from "./alpha.js";
import { OutcomeComparator } from "./outcome.js";

export type { Comparator, Ordering } from "./comparator.js";
export { NumericComparator } from "./numeric.js";
export { AlphaComparator } from "./alpha.js";
export { OutcomeComparator } from "./outcome.js";

/** The comparator kinds, specialised by input type. */
export type ComparatorName = "numeric" | "alpha" | "outcome";

export const COMPARATOR_NAMES: ComparatorName[] = ["numeric", "alpha", "outcome"];

const registry: Record<ComparatorName, Comparator> = {
  numeric: new NumericComparator(),
  alpha: new AlphaComparator(),
  outcome: new OutcomeComparator(),
};

/** Resolve a comparator implementation by name. */
export function getComparator(name: ComparatorName): Comparator {
  return registry[name];
}
