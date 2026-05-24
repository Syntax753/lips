import type { Comparator, Ordering } from "./comparator.js";

/**
 * Compares multi-attribute outcomes. An outcome is a JSON object
 * `{ expectedValue: number, survivalProbability: number }`. Ranking is
 * lexicographic: survival dominates, expected value breaks ties — higher is
 * better, so `decide(..., goal="max")` picks the best outcome.
 */
type Outcome = { expectedValue: number; survivalProbability: number };

function parseOutcome(s: string): Outcome {
  let o: unknown;
  try {
    o = JSON.parse(s);
  } catch {
    throw new Error(`outcome comparator: "${s}" is not valid JSON`);
  }
  if (typeof o !== "object" || o === null) throw new Error("outcome must be a JSON object");
  const rec = o as Record<string, unknown>;
  const expectedValue = Number(rec.expectedValue);
  const survivalProbability = Number(rec.survivalProbability);
  if (Number.isNaN(expectedValue)) throw new Error("outcome.expectedValue must be a number");
  if (Number.isNaN(survivalProbability)) throw new Error("outcome.survivalProbability must be a number");
  return { expectedValue, survivalProbability };
}

export class OutcomeComparator implements Comparator {
  readonly name = "outcome";

  compare(lhs: string, rhs: string): Ordering {
    const a = parseOutcome(lhs);
    const b = parseOutcome(rhs);
    const bySurvival = Math.sign(a.survivalProbability - b.survivalProbability);
    if (bySurvival !== 0) return bySurvival as Ordering;
    return Math.sign(a.expectedValue - b.expectedValue) as Ordering;
  }
}
