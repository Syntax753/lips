import { test } from "node:test";
import assert from "node:assert/strict";
import { calc, multiply } from "./arithmetic.js";

test("numeric arithmetic ops", () => {
  assert.equal(multiply("7", "7").result, "49");
  assert.equal(calc("add", "49", "14").result, "63");
  assert.equal(calc("subtract", "100", "10").result, "90");
  assert.equal(calc("divide", "20", "4").result, "5");
});

test("guards", () => {
  assert.throws(() => calc("divide", "1", "0"), /division by zero/);
  assert.throws(() => multiply("a", "2"), /not a number/);
});
