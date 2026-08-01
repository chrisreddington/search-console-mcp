# Analysis recipes

Exact queries per opportunity class. Read
[limitations.md](../../search-console/references/limitations.md) first — every caveat there
applies, and several of these recipes exist specifically to avoid tripping over one.

All recipes use the fixed windows from `SKILL.md`: `current` is the 28 days ending
`today − 3`, `prior` is the 28 days immediately before it.

## Contents

- [Property totals (context)](#property-totals-context)
- [Class: ctr-gap](#class-ctr-gap)
- [Class: near-miss](#class-near-miss)
- [Class: gap](#class-gap)
- [Class: decay](#class-decay)
- [Outcome measurement](#outcome-measurement)

## Property totals (context)

Two calls, no dimensions, one per window. Establishes direction of travel only — never a
proposal on its own.

```
gsc_query_search_analytics: siteUrl, startDate, endDate    (no dimensions)
```

Read the pair together. Impressions down with CTR up usually means low-CTR impressions were
lost, not that anything improved. Always quote clicks first.

## Class: ctr-gap

A page earning impressions but converting far fewer clicks than its position warrants.
Usually a title or meta description problem — cheap to fix, fast to show effect.

```
dimensions: ["page", "query"], window: current, pageSize: 1000
```

Select rows where impressions ≥ 200, position ≤ 15, and CTR is well below the typical CTR
of other rows at a comparable position on this property. Derive that comparison from the
data in hand; do not import external CTR-by-position benchmarks, which vary wildly by intent
and SERP layout.

Action: rewrite title and meta description to match the query intent.

## Class: near-miss

A page ranking just off page one for a query it nearly wins. Small content improvements can
move position 8–20 materially; position 40+ rarely responds to a tweak.

```
dimensions: ["query", "page"], window: current, pageSize: 1000
```

Select rows where position is between 8 and 20 and impressions ≥ 100. Prefer queries where
position improved versus `prior` — momentum is easier to extend than to create.

Action: expand the section that addresses the query, or add the missing subtopic.

## Class: gap

A query the property already earns impressions for, with no page genuinely about it.

```
dimensions: ["query"], window: current, pageSize: 1000
```

Take queries with impressions ≥ 100 and position > 20. For each candidate, re-query with
`dimensions: ["query","page"]` to see which page currently absorbs it. If that page is only
tangentially related, it is a genuine gap.

Action: propose new content. This is the most expensive class — hold it to a higher bar and
propose at most one per run.

## Class: decay

A page losing ground against its own recent baseline.

```
dimensions: ["page"], one call per window, pageSize: 1000
```

Compare a page's `current` against its `prior`. Flag drops greater than 30% in clicks where
`prior` clicks were at least 20 — below that, the swing is noise. Check position alongside:
position steady with impressions falling is usually falling demand, not a page problem, and
is not worth acting on.

Action: refresh the page, but only when position also slipped.

## Outcome measurement

For an accepted proposal whose content shipped on `S`:

- Baseline: the 28 days ending the day before `S`, filtered to the page.
- Result: the 28 days ending `today − 3`, filtered to the same page, run no earlier than
  8 weeks after `S`.

```
dimensions: ["page"], filters: [{dimension:"page", operator:"equals", expression:"<url>"}]
```

Record clicks, impressions, and position for both windows.

Verdicts: `won` if clicks rose ≥ 20%; `lost` if clicks fell ≥ 20%; `flat` otherwise.
Record `insufficient-data` when baseline clicks were under 10, where percentage change is
meaningless.

For a new page with no baseline, record baseline as zero and judge on absolute clicks in
the result window.
