import { test } from "node:test";
import assert from "node:assert/strict";
import { calc, calcUnary, multiply } from "./arithmetic.js";

test("numeric arithmetic ops", () => {
  assert.equal(multiply("7", "7").result, "49");
  assert.equal(calc("add", "49", "14").result, "63");
  assert.equal(calc("subtract", "100", "10").result, "90");
  assert.equal(calc("divide", "20", "4").result, "5");
});

test("power (exponent and root via 0.5)", () => {
  assert.equal(calc("power", "2", "10").result, "1024");
  assert.equal(calc("power", "410", "0.5").result, String(Math.sqrt(410)));
  assert.equal(calc("power", "9", "0.5").result, "3");
});

test("unary ops: sqrt and negate", () => {
  assert.equal(calcUnary("sqrt", "144").result, "12");
  assert.equal(calcUnary("sqrt", "410").result, String(Math.sqrt(410)));
  assert.equal(calcUnary("negate", "7").result, "-7");
  assert.equal(calcUnary("negate", "-3").result, "3");
});

test("guards", () => {
  assert.throws(() => calc("divide", "1", "0"), /division by zero/);
  assert.throws(() => multiply("a", "2"), /not a number/);
  assert.throws(() => calcUnary("sqrt", "-4"), /negative/);
  assert.throws(() => calcUnary("sqrt", "x"), /not a number/);
});
