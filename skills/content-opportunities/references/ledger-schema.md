# Ledger schema

Two append-only JSONL files in the content repo under `.agents/content-loop/`. One JSON
object per line, no trailing commas, newest at the end.

These files hold the **hard facts** — exact IDs, URLs, dates and numbers. Soft preferences
("Chris prefers practical walkthroughs") belong in Codex's own memory, which consolidates
and rewords over time. Anything the outcome loop must compute against lives here instead,
where it is exact, diffable and revertible.

## proposals.jsonl

One row per proposal, written in the same run that proposed it. Rejected proposals are
recorded too — rejections are the training signal.

```json
{
  "id": "P-20260804-1",
  "proposed_at": "2026-08-04",
  "site": "sc-domain:chrisreddington.com",
  "class": "ctr-gap",
  "target_page": "https://chrisreddington.com/blog/some-post/",
  "target_query": "github actions matrix strategy",
  "action": "Rewrite title and meta description to lead with the matrix use case",
  "evidence": {
    "window_current": ["2026-07-05", "2026-08-01"],
    "window_prior": ["2026-06-07", "2026-07-04"],
    "clicks": [4, 6],
    "impressions": [1820, 2140],
    "position": [11.4, 9.8]
  },
  "confidence": "medium",
  "verdict": "accepted",
  "verdict_reason": "",
  "verdict_at": "2026-08-04",
  "issue": "https://github.com/chrisreddington/chrisreddington.github.io/issues/61",
  "shipped_url": null,
  "shipped_at": null
}
```

Field notes:

- `id` — `P-<YYYYMMDD>-<n>`, unique forever. Outcomes join on it.
- `class` — one of `ctr-gap`, `near-miss`, `gap`, `decay`.
- `evidence` — paired arrays are always `[prior, current]`. Keep both windows so a later
  run can tell whether the evidence itself was sound.
- `verdict` — `accepted`, `rejected`, `deferred`, or `pending` until the human responds.
- `verdict_reason` — free text, and the highest-value field in the file. Capture the actual
  words ("not focusing on Azure any more"), not a paraphrase.
- `issue` — set only when an issue was actually created.
- `shipped_url` / `shipped_at` — filled in later, when the content lands. Without these the
  outcome loop cannot run, so backfill them when merging content.

## outcomes.jsonl

One row per measured proposal, written by `outcome` mode.

```json
{
  "proposal_id": "P-20260804-1",
  "measured_at": "2026-10-06",
  "url": "https://chrisreddington.com/blog/some-post/",
  "shipped_at": "2026-08-08",
  "baseline": {
    "window": ["2026-07-11", "2026-08-07"],
    "clicks": 6,
    "impressions": 2140,
    "position": 9.8
  },
  "result": {
    "window": ["2026-09-08", "2026-10-05"],
    "clicks": 31,
    "impressions": 3980,
    "position": 6.2
  },
  "verdict": "won",
  "note": ""
}
```

Field notes:

- `verdict` — `won`, `flat`, `lost`, or `insufficient-data`. Thresholds are in
  [analysis-recipes.md](analysis-recipes.md).
- Every number must come from a real query. Never infer, interpolate, or estimate a figure
  to fill a row; use `insufficient-data`.
- Never rewrite an existing row. If a measurement was wrong, append a corrected row with a
  later `measured_at` and explain in `note`.

## topics.md

Human-owned Markdown, never edited by the skill. Two sections that gate every proposal:

- **Focus areas** — what to look for. Weight proposals matching these upward.
- **Anti-topics** — what to never propose, with the reason. An anti-topic match is dropped
  silently and is never relitigated.

`reflect` mode may _suggest_ edits in its PR description, but must not change the file.
