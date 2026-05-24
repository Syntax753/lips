import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "./decide.js";
import { NumericComparator } from "./numeric.js";
import { AlphaComparator } from "./alpha.js";

test("comparators return natural order (-1 / 0 / +1)", () => {
  const num = new NumericComparator();
  assert.equal(num.compare("12", "14"), -1);
  assert.equal(num.compare("14", "12"), 1);
  assert.equal(num.compare("5", "5"), 0);

  const alpha = new AlphaComparator();
  assert.equal(alpha.compare("apple", "banana"), -1);
  assert.equal(alpha.compare("banana", "apple"), 1);
});

test("decide applies the goal: -1 lhs better, +1 rhs better, 0 tie", () => {
  assert.equal(decide("12", "14", "numeric", "max").verdict, 1); // 14 larger -> rhs better
  assert.equal(decide("12", "14", "numeric", "min").verdict, -1); // 12 smaller -> lhs better
  assert.equal(decide("8", "8", "numeric", "max").verdict, 0);
  assert.equal(decide("apple", "banana", "alpha", "min").verdict, -1); // apple first -> lhs better
  assert.equal(decide("apple", "banana", "alpha", "max").verdict, 1); // banana later -> rhs better
});
