import { test } from "node:test";
import assert from "node:assert/strict";
import { OutcomeComparator } from "./outcome.js";
import { decide } from "./decide.js";

const safe = JSON.stringify({ expectedValue: 1000, survivalProbability: 0.9 });
const risky = JSON.stringify({ expectedValue: 5000, survivalProbability: 0.4 });

test("outcome comparator ranks survival first, then value", () => {
  const c = new OutcomeComparator();
  assert.equal(c.compare(safe, risky), 1); // safer outcome ranks higher
  const a = JSON.stringify({ expectedValue: 100, survivalProbability: 0.5 });
  const b = JSON.stringify({ expectedValue: 200, survivalProbability: 0.5 });
  assert.equal(c.compare(a, b), -1); // tie on survival -> higher value wins
});

test("decide(outcome, max) picks the safer outcome over the higher-value one", () => {
  assert.equal(decide(safe, risky, "outcome", "max").winner, "lhs");
});
