import { getComparator, type ComparatorName, type Ordering } from "./index.js";

/**
 * "Which is better" lives in the comparator family: it is a comparator's
 * natural ordering plus a max/min goal. (Validators, by contrast, return a
 * boolean.) The result follows the spec's contract:
 *   -1  lhs is better,  +1  rhs is better,  0  equal.
 */

export type Goal = "max" | "min";

export type Verdict = {
  verdict: Ordering;
  winner: "lhs" | "rhs" | "tie";
  natural: Ordering; // the comparator's raw order, for transparency
};

export function decide(
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
