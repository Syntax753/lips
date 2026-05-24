import { test } from "node:test";
import assert from "node:assert/strict";
import { string2int } from "./string2int.js";
import { json2id } from "./json2id.js";

test("string2int: words and digits", () => {
  assert.equal(string2int("twelve"), 12);
  assert.equal(string2int("12"), 12);
  assert.equal(string2int("three hundred forty two"), 342);
  assert.equal(string2int("one thousand two hundred"), 1200);
  assert.equal(string2int("negative five"), -5);
});

test("string2int: rejects non-numbers", () => {
  assert.throws(() => string2int("bananas"), /unknown number word/);
});

test("json2id: extracts a field as string", () => {
  assert.equal(json2id('{"id":42,"name":"x"}'), "42");
  assert.equal(json2id('{"sku":"A1"}', "sku"), "A1");
  assert.throws(() => json2id('{"name":"x"}'), /not found/);
  assert.throws(() => json2id("not json"), /not valid JSON/);
});
