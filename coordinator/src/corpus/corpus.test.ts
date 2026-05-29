import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../solvers/validate.js";
import { CASES } from "./cases.js";

/**
 * The corpus runner: every example flows through the single `validate` entry,
 * so this one loop tests classification, routing, and each solver together. A
 * failing case pinpoints the id, domain, and which expectation broke.
 */
for (const c of CASES) {
  test(`corpus [${c.domain}/${c.difficulty}] ${c.id}`, () => {
    const v = validate(c.input);

    assert.equal(v.kind, c.domain, `${c.id}: classified as ${v.kind}, expected ${c.domain}`);
    if (c.expect.valid !== undefined) {
      assert.equal(v.valid, c.expect.valid, `${c.id}: valid=${v.valid}, expected ${c.expect.valid} (${v.reason})`);
    }

    if (c.expect.moves !== undefined) {
      assert.equal(v.metrics.moves, c.expect.moves, `${c.id}: moves=${v.metrics.moves}, expected ${c.expect.moves}`);
    }
    if (c.expect.pushes !== undefined) {
      assert.equal(v.metrics.pushes, c.expect.pushes, `${c.id}: pushes=${v.metrics.pushes}, expected ${c.expect.pushes}`);
    }
    if (c.expect.solution !== undefined) {
      assert.deepEqual(v.witness, c.expect.solution, `${c.id}: solution mismatch`);
    }
  });
}

test("corpus covers every deterministic domain", () => {
  const domains = new Set(CASES.map((c) => c.domain));
  for (const d of ["boolean", "algebraic", "grid", "timeline"]) {
    assert.ok(domains.has(d as never), `corpus is missing the ${d} domain`);
  }
});
