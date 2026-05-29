---
name: connect-people
description: Determine whether real people are connectable through documented, time-overlapping shared works/events (films, TV, concerts, recordings) — a "six degrees" link — using web search to discover appearances and the lips timeline solver to verify connectivity deterministically. Use when asked "are X and Y connected/associated?", "how is X linked to Y?", "find a path between these people", "do these people connect?", or to verify a whole set of people are mutually relatable. Also the target when a yes/no association question can't be answered from provided data and must be discovered.
---

# connect-people

Discover whether a set of real people are all mutually connectable through
**documented shared works/events**, and produce the linking chain. This is the
*open-timeline* path: when no timeline is provided, you find one. The web search
is yours to run; the connectivity verdict is delegated to the deterministic lips
timeline solver so the answer is reproducible and not a hallucinated guess.

The model: each shared work/event is a **co-location in time**. Two people are
linked when they appear in the same documented work whose years overlap; chaining
those links connects the whole set (the solver computes **transitive**
connectivity, so an A→B→C link needs no special handling). A boolean "are X and Y
associated?" reduces to connecting exactly those two.

## Mode — closed-world vs open-world (decide this FIRST)

- **Closed-world — the request PROVIDES timelines/intervals.** Analyse *only* the
  given data. Pass it straight to the solver and report the verdict as final. A
  `NOT CONNECTED` here is a real answer (the world is exactly what was given) — do
  **not** search for more.

- **Open-world — only the people/entities are named, no timeline data.** Absence of
  a connection in nothing is not evidence of none. You **must search** to discover
  their documented appearances (and likely intermediaries) before concluding. Here
  a "not connected" is only ever *"no link found within the search budget"* — never
  a proof of unrelatedness. Only closed-world disconnection is a proof.

## Steps

1. **Identify the people** (2+) and pick the mode above. If only two and the ask is
   yes/no, that's still a connect of those two. If intervals were supplied, skip to
   step 6 (verify) on exactly those.

2. **Discover appearances (web search) — open-world only.** For each person, search
   authoritative sources for documented works/events they appeared in — films, TV,
   concerts, albums/recordings, notable co-credited events — and their **birth/death
   years**.
   - Fan out: one focused search per person, plus targeted "X and Y same film/
     project" searches between pairs you suspect connect.
   - Record each appearance as a presence interval: `locationid` = the work's
     canonical title, `starttime`/`endtime` = its **year** (a single year is fine;
     use a range only for multi-year runs). **Year granularity by default.**

2b. **Find the transitive bridge (open-world).** If no *direct* shared work links
   the targets, look for a path through intermediaries (the "six degrees" case):
   search each target's frequent collaborators / shared franchises, add those people
   and their relevant works, and let the solver find the chain. Expand outward in
   **bounded hops** (≈2–3) — log what you searched. If still unconnected after the
   budget, that is *"no link found within N hops"*, **not** proof of unrelatedness.
   (Feasibility still applies: people whose lifespans never overlap — e.g. a
   1st-century figure and a modern actor — cannot share a documented appearance, so
   no bridge can exist; say so.)

3. **Edge rule (be strict).** An edge exists ONLY between two people who appear in
   the **same documented work/event** with overlapping years. Birth/death years are
   *feasibility bounds* only — never invent a co-appearance outside both lifespans,
   and co-existing in time is NOT itself a link. Do not fabricate shared works: if a
   shared credit is uncertain, search to confirm it or drop it.

4. **Adversarially verify each link.** Before relying on a shared-work edge, confirm
   from a source that both people are actually credited in that work. Mark any edge
   you cannot confirm as *unverified* and exclude it from the deterministic check
   (or note the result depends on it).

5. **Assemble the timeline** as JSON — a list of characters, each a list of
   intervals:

   ```json
   [
     { "id": "John Travolta", "intervals": [ { "starttime": 1994, "endtime": 1994, "locationid": "Pulp Fiction" } ] },
     { "id": "Bruce Willis",  "intervals": [ { "starttime": 1994, "endtime": 1994, "locationid": "Pulp Fiction" },
                                             { "starttime": 1995, "endtime": 1995, "locationid": "Twelve Monkeys" } ] },
     { "id": "Brad Pitt",     "intervals": [ { "starttime": 1995, "endtime": 1995, "locationid": "Twelve Monkeys" } ] }
   ]
   ```

6. **Verify deterministically.** Use the lips timeline solver — do NOT eyeball
   connectivity. Either:
   - call the **`reachable`** tool on the `lips` MCP server with the characters, or
   - run the repo CLI: write the JSON to a file and, from `coordinator/`, run
     `npm run connect -- <file.json>` (or pipe the JSON via stdin).

   It returns `{ connected, edges, encounter, components, reason }`: `connected` is
   the verdict, `encounter` the walk reaching everyone, `components` the unreachable
   groups when it is false.

7. **Report.**
   - **Connected:** state it, then narrate the encounter walk —
     *"Travolta → Willis via *Pulp Fiction* (1994); Willis → Pitt via *Twelve
     Monkeys* (1995)"* — citing a source for each linking work.
   - **Not connected:** name the separate `components` (the groups that never share
     a work) so the user sees exactly what's stranded, and what evidence would
     bridge them. State the mode: in **closed-world** this is a definitive *no*; in
     **open-world** it is only *"no link found within the search budget"* — say which
     intermediaries you tried and that a deeper search could still find one.
   - Always flag any *unverified* link the conclusion leaned on.

## Notes
- Keep the discovery (search) and the verdict (solver) separate: the solver is the
  source of truth for connectivity; your job is to assemble accurate intervals.
- Prefer well-documented co-credits (cast lists, official discographies) over
  inferred associations. Quality of edges > quantity.
