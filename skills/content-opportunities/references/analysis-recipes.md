# Analysis recipes

Retrieval and analysis are separate phases. Acquire the evidence once, then run every
opportunity class over it. Read
[limitations.md](../../search-console/references/limitations.md) first — every caveat there
applies, and several of these recipes exist specifically to avoid tripping over one.

All phases use the fixed windows from `SKILL.md`: `current` is the 28 days ending
`today − 3`, `prior` is the 28 days immediately before it.

## Contents

- [Phase 1: acquire](#phase-1-acquire)
- [Phase 2: analyse](#phase-2-analyse)
  - [Class: ctr-gap](#class-ctr-gap)
  - [Class: near-miss](#class-near-miss)
  - [Class: gap](#class-gap)
  - [Class: decay](#class-decay)
  - [Focus-area clusters](#focus-area-clusters)
- [Phase 3: validate a candidate](#phase-3-validate-a-candidate)
- [Outcome measurement](#outcome-measurement)
- [Reporting coverage honestly](#reporting-coverage-honestly)

## Phase 1: acquire

`gsc_compare_search_analytics` retrieves both windows for one grain, union-joins them, and
returns `current`, `prior`, and `delta` metrics per row. A retrieval is cached for the
session and keyed on what Google sees — property, both windows, dimensions, API filters,
search type, aggregation, data state, retrieval mode. `where`, `sort`, and `limit` are
applied afterwards, so **calling the same grain again with different thresholds costs no
API requests**. Never re-acquire a grain because a later class wants a different cut of the
same rows.

Acquire these four datasets, once each, at the start of a propose run.

| Dataset            | `dimensions`       | `retrievalMode` | Used by                     |
| ------------------ | ------------------ | --------------- | --------------------------- |
| `property_totals`  | omit               | `range`         | context                     |
| `page_comparison`  | `["page"]`         | `range`         | decay, ctr-gap denominators |
| `query_comparison` | `["query"]`        | `range`         | gap                         |
| `page_query`       | `["page","query"]` | `range`         | ctr-gap, near-miss          |

That is **8 API requests** for the whole evidence base, and every opportunity class runs on
it for free. The only further retrievals a run should need are the ones that must be
narrowed by an API filter, because `where` selects on metrics and never on key values:
resolving a `gap` candidate's page, a focus-area cluster, and a Phase 3 validation. A full
propose run against `sc-domain:chrisreddington.com` measured **26 requests in about seven
seconds** end to end: 8 to acquire, 0 for all four opportunity classes, 6 to resolve three
gap candidates, 10 for three focus-area clusters with two drill-downs, and 2 to validate.

`page_query` is the **only** page/query grain. Do not also acquire `["query","page"]`; it is
the same grouped data with the keys reordered.

### Choosing a retrieval mode

`range` is the default. Google aggregates the whole window itself, so the metrics are its
own and one request per window covers the grain.

`daily` issues one paginated request per day and aggregates locally — 56 requests per grain
across the two windows instead of 2. It exists for a property large enough that a single
click-sorted response truncates before the long tail, which is where high-impression
zero-click rows sit. Its metrics are locally derived: use it to **find candidate keys**,
never to quote a proposal's numbers.

Escalate a grain to `daily` when either holds:

- `coverage.rowCapReached` was `true` for that grain, which proves truncation; or
- the benchmark below shows the two modes disagreeing for that grain.

`rowCapReached: false` on its own is **not** grounds to stay on `range`, because it does not
prove completeness. What justifies `range` is the measured equivalence, not the absent flag.

Never combine a daily-derived figure and a range-derived figure in one number or one
comparison. If a finding needs both, state which window each came from.

### Benchmark: verify the mode choice, do not assume it

Re-run this when the property grows materially, or roughly once a quarter. Acquire a grain
both ways over one fixed window pair and compare below the row limit, so truncation cannot
masquerade as a difference:

- keys present in one mode only, in each direction;
- summed clicks and impressions;
- how many keys sit in the long tail (≤3 impressions);
- maximum per-key drift in position, clicks and impressions.

Measured for `sc-domain:chrisreddington.com` on 2026-08-02, windows `2026-07-03..2026-07-30`
against `2026-06-05..2026-07-02`:

| Grain      | daily      | range      | Key differences | Max drift |
| ---------- | ---------- | ---------- | --------------- | --------- |
| query      | 3,328 keys | 3,328 keys | 0 / 0           | 0         |
| page/query | 3,799 keys | 3,799 keys | 0 / 0           | 0         |
| page       | 440 keys   | 440 keys   | 0 / 0           | 0         |

Identical clicks, impressions and long-tail counts (2,177 queries at ≤3 impressions in both,
at the query grain). No grain came close to the 25,000-row ceiling. On this property `daily`
costs 28× the requests for byte-identical data, so `range` is the evidence-backed choice —
not a saving taken on faith.

## Phase 2: analyse

Every class below reads the datasets from Phase 1. None of them retrieves anything.

Push every absolute threshold into a `where` clause so the response stays small. Relative
tests — a percentage change against `prior`, a CTR compared with its position band — cannot
be expressed as a `where` clause and are computed on the returned rows. Judging whether a
selected row is worth acting on is yours.

### Class: ctr-gap

A page earning impressions but converting far fewer clicks than its position warrants.
Usually a title or meta description problem — cheap to fix, fast to show effect.

Two cuts of `page_query`, both free once it is acquired:

1. **The band denominator.** `current.impressions ≥ 20` and `current.position ≤ 15`. This is
   the population you compare against — a few hundred rows. Group it into position bands and
   compute each band's CTR on this property. Do not import external CTR-by-position
   benchmarks; they vary wildly by intent and SERP layout.
2. **The candidates.** `current.impressions ≥ 200` and `current.position ≤ 15`, which is a
   handful of rows. Flag those whose CTR sits well below their own band.

Taking only the ≥ 200 rows and banding _those_ is the mistake to avoid: it leaves too few
rows per band to say what typical looks like, and each candidate ends up compared with
itself.

Action: rewrite title and meta description to match the query intent.

### Class: near-miss

A page ranking just off page one for a query it nearly wins. Small content improvements can
move position 8–20 materially; position 40+ rarely responds to a tweak.

From `page_query`, take rows where `current.position` is between 8 and 20 and
`current.impressions ≥ 100`. Prefer rows with a negative `delta.position` — momentum is
easier to extend than to create. A null `delta` means the key was absent from `prior` and
the trend is unknown, not flat.

Action: expand the section that addresses the query, or add the missing subtopic.

### Class: gap

A query the property already earns impressions for, with no page genuinely about it.

From `query_comparison`, take queries where `current.impressions ≥ 100` and
`current.position > 20`.

Then find which page absorbs each one. `where` filters on metrics, not on key values, so
this needs a retrieval filtered to that query — 2 requests each:

```
dimensions: ["page"]
filters: [{ dimension: "query", operator: "equals", expression: "<query>" }]
```

**Rank the candidates by current impressions and resolve at most the top 3.** The class
proposes at most one item per run, so resolving a dozen candidates buys nothing and costs
two requests apiece. Do not reach for the unfiltered `page_query` rows instead: retrieving
thousands of rows to find one query's page is the context blowout this plan exists to
prevent.

If the absorbing page is only tangentially related, it is a genuine gap.

This class means **a gap Search Console can see**: the property already earns impressions
for the query. It cannot find topics the property has no presence for at all, because those
produce no rows. Do not present a `gap` finding as complete market coverage.

Action: propose new content. This is the most expensive class — hold it to a higher bar and
propose at most one per run.

### Class: decay

A page losing ground against its own recent baseline.

From `page_comparison`, select `prior.clicks ≥ 20` and `delta.clicks < 0`, then keep the
rows whose loss exceeds 30% of `prior.clicks`. Below 20 prior clicks the swing is noise.
Check position alongside: position steady with impressions falling is usually falling
demand, not a page problem, and is not worth acting on.

Action: refresh the page, but only when position also slipped.

### Focus-area clusters

Per-query thresholds hide real demand that is spread across variants. `agents md`,
`agents md template`, and `agent instructions md` may each fall under 100 impressions while
the cluster is substantial. Run this pass on every focus area in `topics.md`.

`topics.md` is human-owned. It supplies the patterns; never infer a regex from prose in the
file, and never edit the file to add one. The expected shape is one line per cluster under a
`## Discovery patterns` heading:

```
- agent-tooling: (?i)agents?[ ._-]?md|skills[ ._-]?md
- context-engineering: (?i)context engineering|context window management
```

If the heading is absent, say so in the run output, skip this pass, and offer to draft the
patterns. Do not substitute your own.

For each pattern, one `range` retrieval:

```
dimensions: ["page"]
filters: [{ dimension: "query", operator: "includingRegex", expression: "<pattern>" }]
retrievalMode: "range"
```

Filtering by `query` while grouping by `page` is supported and gives compact landing-page
totals for the whole cluster. Treat a cluster with at least 100 combined current
impressions as worth examining.

Only for a cluster that clears that bar, retrieve `dimensions: ["query","page"]` with the
same filter, so the constituent queries stay auditable in the output. Show them — an
aggregate nobody can decompose is not evidence.

Then decide which the cluster indicates: a title/snippet mismatch, a missing section,
cannibalisation across several pages, or a genuine new-content gap.

A focus-area candidate competes with the metric-led classes on evidence, expected value and
strategic fit. It gets no reserved slot.

## Phase 3: validate a candidate

Validate only what is about to become a proposal — at most three keys, so at most six
requests. Do not re-measure every candidate the classes surfaced.

Skip it entirely when the candidate came from a `range` grain and needs no change of
aggregation: those numbers are already Google's own for the window, and re-requesting them
returns the same figures. Validate when either applies:

- the grain was acquired with `daily`, so its metrics are locally derived and must not enter
  the ledger; or
- the proposal will quote a page total while the evidence came from `page_query` rows.
  Grouping by page and grouping by page-and-query aggregate differently, and the skill
  forbids presenting one as the other.

```
dimensions: ["page"] or ["query","page"]
filters: [{ dimension: "page", operator: "equals", expression: "<url>" }]
retrievalMode: "range"
```

The ledger has to stay comparable across runs, and outcome measurement uses range windows.

## Outcome measurement

For an accepted proposal whose content shipped on `S`:

- Baseline: the 28 days ending the day before `S`, filtered to the page.
- Result: the 28 days ending `today − 3`, filtered to the same page, run no earlier than
  8 weeks after `S`.
- Eligibility has no upper bound. Eight to twelve weeks is the preferred measurement period;
  an older proposal without an outcome remains due until measured.

One `range` comparison covers both:

```
dimensions: ["page"]
filters: [{ dimension: "page", operator: "equals", expression: "<url>" }]
current: the result window, prior: the baseline window, retrievalMode: "range"
```

Record clicks, impressions, and position for both windows.

If the linked issue preserves a target query or focus-cluster regex, repeat the comparison
with that query filter and the same page and windows. Report it as a diagnostic of the
editorial hypothesis, not as the verdict: query detail omits anonymised queries and can be
too sparse to represent the page.

Verdicts: `won` if clicks rose ≥ 20%; `lost` if clicks fell ≥ 20%; `flat` otherwise.
Record `insufficient-data` when baseline clicks were under 10, where percentage change is
meaningless.

For a new page with no baseline, `prior` is null rather than zero. Record baseline as zero
and judge on absolute clicks in the result window.

## Reporting coverage honestly

Every compare response carries a `coverage` block. Read it before characterising any result.

- `rowCapReached: true` proves the retrieval was truncated. Say so, and say which grain.
- `rowCapReached: false` does **not** prove completeness. Google returns click-sorted top
  rows, does not guarantee every row, and reports no true total.
- `paginationExhausted: true` only means no further rows were offered for that request
  shape.
- `failedDates` lists days that errored in `daily` mode. Their rows are missing from the
  aggregate.
- `counts.unionKeys` versus `counts.matchedFilters` is how many rows a class actually
  examined.

Write "no other candidate cleared the thresholds **in the rows retrieved**", never "no other
candidate exists". If `rowCapReached` was true or any day failed, state that in the run
output rather than in a footnote.
