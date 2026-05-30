---
name: political
description: Decide whether a geopolitical or factual claim is true or false by researching it on the web, then reducing it to a deterministic check (a comparator on researched numbers/dates, or the lips timeline solver) so the verdict is verifiable, not a guess. Use for is-this-true questions about wars, treaties, borders, countries, leaders, elections, or resource/economy comparisons (e.g. "does X have more oil than Y", "did war Z end in 1918"), and for event-participation questions ("find someone who fought in both world wars"). Returns true / false / indeterminate with the decisive facts and sources.
---

# political — geopolitical truth, researched then verified

Decide the truth of a geopolitical/factual claim. The **web search is yours to run**
(you are "the web search agent"); the **verdict is delegated to a deterministic leaf**
— the lips comparator (`validate`) for numbers/dates, or the timeline solver
(`reachable`) for event participation — so the answer is reproducible and sourced,
not a hallucinated true/false.

The principle, same as `connect-people`: **keep discovery (search) separate from the
verdict (a deterministic leaf).** You gather the facts; the leaf decides. Never assert
a number or a comparison from memory — research it, then let the comparator compare.

## Claim shapes (decide which FIRST)

- **Settled fact / date** — "did WW1 end in 1918?", "is France in the EU?". Research
  the fact, then verify with an equality/membership check.
- **Quantitative comparison** — "does the UAE have more oil than the US?", "is China's
  GDP larger than Japan's?". Research **both** quantities (with units + sources), then
  feed them to the comparator.
- **Event participation / overlap** — "find someone who fought in both WWI and WWII".
  Research a candidate, then verify their dates straddle **both** events with the
  timeline solver.
- **Predictive or contested** — "will country X invade Y?", "is leader Z good?". These
  are **not** truth-bearing for a deterministic engine. Return **indeterminate** with
  the evidence — do **not** force a true/false.

## Steps

1. **Classify the claim** into one of the shapes above. Note the entities and the exact
   quantities/dates/events the truth hinges on.

2. **Research with web search.** Find the decisive fact(s) from authoritative sources
   (official statistics, encyclopaedic/reference works, primary records). For a
   comparison, research **each** side independently and record the number **with its
   units, year, and source**. Prefer the most recent authoritative figure; note the
   date (reserves/GDP/population drift over time).

3. **Reduce to a deterministic leaf** — this is the verdict, and it must not be done in
   your head (route the arithmetic/compare through the tool):
   - **Comparison** → call the lips **`validate`** tool with the bare comparison of the
     researched numbers, e.g. `validate("113 > 35")` for "UAE 113 Bbbl vs US 35 Bbbl
     proven reserves" → the comparator returns the boolean. (Normalise units first;
     if a conversion is needed, route it through the arithmetic ops, not by hand.)
   - **Date / equality** → `validate("1918 = 1918")` for "did WW1 end in 1918?".
   - **Event participation / overlap** → build a timeline and call **`reachable`** (or a
     date-overlap comparison): give the person a presence interval at each event's
     window and confirm both are covered (see below).

4. **Compose with the timeline solver for participation questions.** "Find someone who
   fought in both WWI (1914–1918) and WWII (1939–1945)":
   - Research a real candidate and their **service dates** (e.g. a soldier who served
     1916–1918 and again 1939–1945), with a source.
   - Verify deterministically that their service **intersects both** windows — either
     two comparator overlap checks, or a `reachable` timeline where the candidate shares
     an interval with a `WWI` node (1914–1918) **and** a `WWII` node (1939–1945). The
     candidate is the answer only if both edges hold.

5. **Verdict + report.**
   - **true / false** for settled facts and comparisons — state the decisive numbers/
     dates, the tool call that decided it, and the source for each fact.
   - **indeterminate** for predictive/contested claims — present the evidence and say
     why it isn't a deterministic truth, rather than guessing.
   - **Flag every soft step**: an estimate, a disputed figure, a units assumption, or a
     source you couldn't fully corroborate. If the verdict flips on a contested number,
     say so.

## Notes
- The deterministic core has no web access — that's why this runs as a skill in the
  main session. The comparator/timeline leaf is the source of truth; your job is to
  feed it accurate, sourced facts.
- Watch units and vintage: "more oil" can mean **proven reserves** vs **production** vs
  **exports** — pick one explicitly, research both sides on the same basis, and say
  which. The honest answer names its basis.
- A figure you can't source is *unverified* — exclude it or flag that the verdict
  depends on it. Quality of facts > a confident-sounding guess.

## Examples
- `did World War 1 end in 1918?` → research end date (11 Nov 1918) → `validate("1918 = 1918")` → **true**.
- `does the UAE have more oil than the United States?` → research proven reserves (UAE ≈ 113 Bbbl, US ≈ 35 Bbbl) → `validate("113 > 35")` → **true** (basis: proven reserves; flag that *production* gives the opposite answer).
- `find someone who fought in both world wars` → research a candidate + service dates → `reachable` confirms intervals cover 1914–1918 **and** 1939–1945 → name them, sourced.
- `will country X invade country Y next year?` → **indeterminate** — predictive; present the evidence, don't force a boolean.
