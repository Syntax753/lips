import { test } from "node:test";
import assert from "node:assert/strict";
import { multiply } from "./arithmetic.js";

test("numeric multiply", () => {
  assert.equal(multiply("7", "7").product, "49");
  assert.equal(multiply("49", "14").product, "686");
  assert.equal(multiply("-5", "4").product, "-20");
});

test("rejects non-numbers", () => {
  assert.throws(() => multiply("a", "2"), /not a number/);
});
