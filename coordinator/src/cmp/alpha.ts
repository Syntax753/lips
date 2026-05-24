import type { Comparator, Ordering } from "./comparator.js";

/** Compares two values alphabetically (locale-aware, case-insensitive primary). */
export class AlphaComparator implements Comparator {
  readonly name = "alpha";

  compare(lhs: string, rhs: string): Ordering {
    const order = lhs.localeCompare(rhs, undefined, { sensitivity: "base", numeric: false });
    return Math.sign(order) as Ordering;
  }
}
