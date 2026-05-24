/**
 * Programmatic comparators used by the orchestrator's validator.
 *
 * A Comparator returns the STANDARD natural order of two values (the same
 * convention as Array.prototype.sort's comparator):
 *   -1  lhs precedes rhs   (numeric: smaller; alpha: earlier)
 *    0  equal
 *   +1  lhs follows rhs    (numeric: larger;  alpha: later)
 *
 * The "which is better" inversion (-1 = lhs better) lives in the validator,
 * which layers a max/min goal on top of this natural order.
 */
export type Ordering = -1 | 0 | 1;

export interface Comparator {
  /** Stable identifier, also the value accepted by the validate tool. */
  readonly name: string;
  /** Natural order of lhs relative to rhs. */
  compare(lhs: string, rhs: string): Ordering;
}
