import { test } from "node:test";
import assert from "node:assert/strict";
import { comparable } from "./comparable.js";

test("comparable: numeric flags non-numbers and suggests a converter", () => {
  assert.equal(comparable("12", "14", "numeric").ok, true);
  const r = comparable("twelve", "14", "numeric");
  assert.equal(r.ok, false);
  assert.match(r.suggestion ?? "", /string2int/);
});

test("comparable: outcome requires the right object shape", () => {
  const a = '{"expectedValue":1,"survivalProbability":0.5}';
  const b = '{"expectedValue":2,"survivalProbability":0.6}';
  assert.equal(comparable(a, b, "outcome").ok, true);
  assert.equal(comparable("12", "14", "outcome").ok, false);
});
