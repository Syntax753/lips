import type { Comparator, Ordering } from "./comparator.js";

/** Compares two values as numbers. Rejects inputs that are not numeric. */
export class NumericComparator implements Comparator {
  readonly name = "numeric";

  compare(lhs: string, rhs: string): Ordering {
    const a = this.toNumber(lhs);
    const b = this.toNumber(rhs);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  private toNumber(value: string): number {
    const n = Number(value);
    if (Number.isNaN(n)) {
      throw new Error(`numeric comparator: "${value}" is not a number`);
    }
    return n;
  }
}
