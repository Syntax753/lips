import { getComparator, type ComparatorName, type Ordering } from "./cmp/index.js";

/** Which extreme counts as "better". */
export type Goal = "max" | "min";

export type Verdict = {
  /** -1: lhs is better, +1: rhs is better, 0: equal — the validator's contract. */
  verdict: Ordering;
  /** Convenience label for the verdict. */
  winner: "lhs" | "rhs" | "tie";
  /** Raw natural order from the comparator (-1: lhs<rhs, +1: lhs>rhs), for transparency. */
  natural: Ordering;
};

/**
 * Decide which of two values is better.
 *
 * The chosen comparator yields the natural order; the goal then defines
 * "better": with `max`, the larger/later value wins; with `min`, the
 * smaller/earlier one does.
 *
 *   verdict = (natural === 0) ? 0 : (goal === "max" ? -natural : natural)
 */
export function validate(
  lhs: string,
  rhs: string,
  comparator: ComparatorName,
  goal: Goal,
): Verdict {
  const natural = getComparator(comparator).compare(lhs, rhs);
  const verdict: Ordering = natural === 0 ? 0 : goal === "max" ? ((-natural) as Ordering) : natural;
  const winner = verdict < 0 ? "lhs" : verdict > 0 ? "rhs" : "tie";
  return { verdict, winner, natural };
}
