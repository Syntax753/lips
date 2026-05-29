---
name: connect-people
description: Determine whether real people are connectable through a chain of documented interpersonal relationships over time — met, starred with, sang with, married, friends with (and shared works or events) — chaining transitively so the endpoints need not overlap in time. Uses web search to discover the relationship chain and the lips timeline solver to verify connectivity deterministically. Use for are X and Y related or connected, how is X linked to Y, find a path between these people, six degrees, or to verify a set of people are mutually relatable. The target when an association question has no provided data and must be discovered.
---

# connect-people

Discover whether people are connectable through a chain of **documented
relationships** over time, and produce the linking chain. The web search is yours
to run; the connectivity verdict is delegated to the deterministic lips timeline
solver, so the answer is reproducible and not a hallucinated guess.

The model: each documented relationship is a shared, time-stamped event between two
people (a `locationid` naming the relationship/work, and the year/range it held).
Two people are linked by an edge when they share such an event while both were
alive and active. The link is **transitive**: A–B–C–…–Z connects A and Z, and the
solver computes that transitive connectivity for free.

**Transitivity beats the lifespan gap — DO NOT reject on it.** Only each
*consecutive pair* on the chain must overlap in time; the **endpoints need not**.
So a 1st-century figure and a modern actor are not *directly* connectable (no
shared event in either lifetime), yet a **chain of overlapping relationships
laddering forward through time can still bridge them**. An endpoint lifespan gap
rules out only a *direct* edge — never a transitive chain. The one true
impossibility is a person with *no documented relationships at all* (an isolated
node). (My earlier "no bridge can exist across 1,900 years" was wrong for exactly
this reason.)

## Edge types

An edge is any documented, time-located relationship between two people:
`met` · `starred with` (shared film/TV) · `sang with` (shared concert/recording) ·
`married` · `friends with`. Encode the kind and the year(s) in the shared event,
e.g. `locationid: "married"`, `"co-star: Heat"`, `"met: Geneva Summit 1985"`.

## Mode — closed-world vs open-world (decide FIRST)

- **Closed-world — the request PROVIDES timelines/relationships.** Analyse *only*
  the given data; pass it to the solver and report the verdict as final. A
  `NOT CONNECTED` here is real — do **not** search for more.
- **Open-world — only the people are named.** Absence of a link in no data is not
  evidence of none. You **must search** to discover relationships (and
  intermediaries) before concluding. "Not connected" here means only *"no chain
  found within the search budget"*, never a proof of unrelatedness.

## Steps

1. **Identify the people** (2+) and pick the mode. If intervals/relationships were
   supplied, skip to step 6 (verify) on exactly those.

2. **Discover relationships (open-world).** For each person, search authoritative
   sources for documented edges of the types above, plus their **birth/death (active)
   years**. Record each as a shared event: `locationid` = the relationship/work,
   `starttime`/`endtime` = its **year** (year granularity by default).

2b. **Bridge a time gap with a time-directed DFS** (the key to avoiding exponential
   blow-up). To connect an EARLIER person to a LATER one:
   - Run a depth-first search from the earlier endpoint that, at each step, expands
     through the relationship reaching **latest in time** — the person met toward the
     END of the current person's timeline — so the frontier marches FORWARD toward
     the target's era instead of fanning out. (Symmetrically you may search BACKWARD
     from the later endpoint and meet in the middle.)
   - Prefer contacts whose active years approach the target's; prune anyone who
     can't advance the reached time. Bound depth/breadth and **log the path tried**.
   - Each hop must be a real, verified relationship (step 4). A dead end is "no chain
     found within budget" — keep the honest framing.

3. **Edge rule (be strict, per-edge).** An edge needs (a) a documented relationship
   of one of the types AND (b) the two people's active lifespans overlapping at that
   time. Feasibility is checked **per edge, not on the endpoints**. Don't fabricate a
   relationship: confirm it from a source or drop it.

4. **Adversarially verify each edge.** Confirm from a source that the relationship is
   real and time-located. Mark any edge you can't confirm as *unverified* and exclude
   it from the deterministic check (or note the result depends on it).

5. **Assemble the timeline** as JSON — a list of people, each a list of shared-event
   intervals (the `locationid` encodes the relationship):

   ```json
   [
     { "id": "A", "intervals": [ { "starttime": 30,   "endtime": 30,   "locationid": "met: Jerusalem" } ] },
     { "id": "B", "intervals": [ { "starttime": 30,   "endtime": 70,   "locationid": "met: Jerusalem" },
                                 { "starttime": 65,   "endtime": 65,   "locationid": "friends with: B-C" } ] },
     { "id": "C", "intervals": [ { "starttime": 65,   "endtime": 65,   "locationid": "friends with: B-C" } ] }
   ]
   ```

6. **Verify deterministically.** Use the lips timeline solver — do NOT eyeball it.
   Either call the **`reachable`** tool on the `lips` MCP server with the people, or
   from `coordinator/` run `npm run connect -- <file.json>` (or pipe JSON via stdin).
   It returns `{ connected, edges, encounter, components, reason }`.

7. **Report.**
   - **Connected:** narrate the chain — each hop's relationship type, year, and a
     source (*"A met B in Jerusalem (~30); B was friends with C (~65); …"*).
   - **Not connected:** in **closed-world** a definitive *no*; in **open-world** only
     *"no chain found within the search budget"* — say which intermediaries/eras you
     tried and that a deeper search could still find one. Call it **impossible** ONLY
     when a person has zero documented relationships — **never** from an endpoint
     lifespan gap.
   - Flag any *unverified* edge the conclusion leaned on.

## Notes
- Keep discovery (search) and the verdict (solver) separate: the solver is the
  source of truth; your job is to assemble accurate, verified edges.
- Quality of edges > quantity. Prefer well-documented relationships (cast lists,
  marriage records, biographies) over inferred ones.
