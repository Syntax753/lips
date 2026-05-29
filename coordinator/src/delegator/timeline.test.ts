import { test } from "node:test";
import assert from "node:assert/strict";
import { solveTimeline, parseTimeline } from "./timeline.js";

// A meets B at place P; B meets C at place Q. A-B-C is one connected chain, so
// from any character the player can encounter all three.
const CONNECTED_CHAIN = [
  { id: "A", intervals: [{ starttime: 0, endtime: 5, locationid: "P" }] },
  { id: "B", intervals: [
    { starttime: 3, endtime: 8, locationid: "P" }, // overlaps A at P
    { starttime: 10, endtime: 15, locationid: "Q" }, // sets up the meet with C
  ] },
  { id: "C", intervals: [{ starttime: 12, endtime: 20, locationid: "Q" }] },
];

test("connected chain: everyone reachable from anyone", () => {
  const r = solveTimeline(CONNECTED_CHAIN);
  assert.equal(r.ok, true);
  assert.equal(r.connected, true);
  assert.equal(r.components.length, 1);
  assert.equal(r.edges.length, 2); // A-B and B-C
  assert.equal(r.encounter.length, 2); // a walk visiting all three
});

test("two cliques that never meet: not connected", () => {
  const r = solveTimeline([
    { id: "A", intervals: [{ starttime: 0, endtime: 5, locationid: "P" }] },
    { id: "B", intervals: [{ starttime: 1, endtime: 2, locationid: "P" }] }, // meets A
    { id: "C", intervals: [{ starttime: 0, endtime: 9, locationid: "Z" }] },
    { id: "D", intervals: [{ starttime: 1, endtime: 3, locationid: "Z" }] }, // meets C
  ]);
  assert.equal(r.connected, false);
  assert.equal(r.components.length, 2);
});

test("same place, disjoint times: no interaction", () => {
  const r = solveTimeline([
    { id: "A", intervals: [{ starttime: 0, endtime: 5, locationid: "P" }] },
    { id: "B", intervals: [{ starttime: 6, endtime: 9, locationid: "P" }] },
  ]);
  assert.equal(r.connected, false);
});

test("touching endpoints count as the same time (inclusive overlap)", () => {
  const r = solveTimeline([
    { id: "A", intervals: [{ starttime: 0, endtime: 5, locationid: "P" }] },
    { id: "B", intervals: [{ starttime: 5, endtime: 9, locationid: "P" }] },
  ]);
  assert.equal(r.connected, true);
});

test("a single character is trivially connected", () => {
  const r = solveTimeline([{ id: "solo", intervals: [{ starttime: 0, endtime: 1, locationid: "P" }] }]);
  assert.equal(r.connected, true);
});

test("accepts bare interval lists (index-named) and { characters: [...] }", () => {
  const bare = solveTimeline([
    [{ starttime: 0, endtime: 5, locationid: "P" }],
    [{ starttime: 2, endtime: 6, locationid: "P" }],
  ]);
  assert.equal(bare.connected, true);
  assert.deepEqual(bare.characters, ["char0", "char1"]);

  const wrapped = solveTimeline({ characters: CONNECTED_CHAIN });
  assert.equal(wrapped.connected, true);
});

test("parse tolerates field aliases and reversed ranges", () => {
  const p = parseTimeline([{ id: "X", timeline: [{ start: 5, end: 0, location: "P" }] }]);
  assert.ok(!("error" in p));
  if (!("error" in p)) {
    assert.deepEqual(p.characters[0].intervals[0], { starttime: 0, endtime: 5, locationid: "P" });
  }
});

test("bad input reports an error, not a crash", () => {
  assert.equal(solveTimeline([]).ok, false);
  assert.equal(solveTimeline([{ id: "A" }]).ok, false); // no interval list
});
