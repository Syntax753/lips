import { test } from "node:test";
import assert from "node:assert/strict";
import { breakdown, escalateBreakdown } from "./breakdown.js";

test("a boolean chain splits into binary sections and composes", () => {
  const b = breakdown("5 > 3 and 2 < 1");
  assert.equal(b.sections.length, 2);
  assert.ok(b.sections.every((s) => s.type === "binary"));
  assert.equal(b.sections[0].valid, true);
  assert.equal(b.sections[1].valid, false);
  assert.equal(b.sections[1].connector, "and");
  assert.match(b.composition, /→ false/);
});

test("a mixed compound shows binary + analysed sections with their tools", () => {
  const b = breakdown("5 > 3 and x^2 + y^2 = -1");
  assert.equal(b.sections.length, 2);
  assert.equal(b.sections[0].type, "binary");
  assert.equal(b.sections[0].kind, "boolean");
  assert.equal(b.sections[1].type, "analysed");
  assert.equal(b.sections[1].kind, "algebraic");
  assert.match(b.sections[1].tool, /nonlinear/);
  assert.equal(b.sections[1].valid, false); // no real solution
  assert.match(b.composition, /mixed-domain/);
});

test("a free-NL clause is flagged deferred, not mis-analysed", () => {
  const b = breakdown("is the larger of three and eight over five");
  // un-parseable NL → at least one deferred section (agentic territory)
  assert.ok(b.sections.some((s) => s.type === "deferred"));
});

test("a single comparison is one binary section", () => {
  const b = breakdown("12 > 14");
  assert.equal(b.sections.length, 1);
  assert.equal(b.sections[0].type, "binary");
  assert.equal(b.sections[0].valid, false);
});

test("escalateBreakdown resolves deferred sections via the resolver, leaving deterministic ones", async () => {
  const b = breakdown("is jesus related to stalone and 5 > 3");
  let calls = 0;
  const full = await escalateBreakdown(b, async (clause) => {
    calls++;
    return { answer: `resolved: ${clause}`, value: false, trace: ["coordinator (...)", "  --> false"] };
  });
  assert.equal(calls, 1); // only the deferred section is escalated
  const deferred = full.sections.find((s) => s.clause.toLowerCase().includes("jesus"))!;
  assert.match(deferred.tool, /agentic/);
  assert.equal(deferred.valid, false);
  assert.ok(deferred.agentic?.answer.startsWith("resolved:"));
  const bool = full.sections.find((s) => s.kind === "boolean")!;
  assert.equal(bool.agentic, undefined); // deterministic section untouched
  assert.equal(bool.valid, true);
});
