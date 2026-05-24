import type { Comparator } from "./comparator.js";
import { NumericComparator } from "./numeric.js";
import { AlphaComparator } from "./alpha.js";

export type { Comparator, Ordering } from "./comparator.js";
export { NumericComparator } from "./numeric.js";
export { AlphaComparator } from "./alpha.js";

/** The comparator kinds the validator understands. */
export type ComparatorName = "numeric" | "alpha";

export const COMPARATOR_NAMES: ComparatorName[] = ["numeric", "alpha"];

const registry: Record<ComparatorName, Comparator> = {
  numeric: new NumericComparator(),
  alpha: new AlphaComparator(),
};

/** Resolve a comparator implementation by name. */
export function getComparator(name: ComparatorName): Comparator {
  return registry[name];
}
