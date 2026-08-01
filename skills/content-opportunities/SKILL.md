---
name: content-opportunities
description: Turn Google Search Console evidence into a small set of actionable content proposals, record the human verdict on each, measure what shipped actually earned, and refine the method over time. Use for a scheduled or ad-hoc content review of a property, for measuring outcomes of previously shipped content, or when reviewing whether the proposal method itself is working.
---

# Content opportunities

Produce a short, evidence-backed set of content proposals for one Search Console property,
record the verdict on each, and later measure whether what shipped actually earned traffic.

The value of this skill is restraint: three good proposals a human acts on beat twenty they
ignore. Restraint means proposing few things, **not** refusing to run. Missing guardrails
and a full backlog change how a run is framed; they never cancel it.

## Modes

Pick the mode from the request. Default to `propose`.

| Mode      | Cadence   | Produces                                                     |
| --------- | --------- | ------------------------------------------------------------ |
| `propose` | Weekly    | Up to 3 proposals, discussed in chat, appended to the ledger |
| `outcome` | Monthly   | Measured deltas for content shipped 8–12 weeks ago           |
| `reflect` | Quarterly | A PR proposing changes to this skill                         |

## Shared setup

1. Property is `sc-domain:chrisreddington.com` unless the request names another. Call
   `gsc_list_sites` only if the identifier is unknown.
2. **Fixed windows, always.** `end = today − 3 days` (Search Console finalises with a
   2–3 day lag). `current = the 28 days ending at end`. `prior = the 28 days immediately
before current`. Never widen, narrow, or shift these to make a finding look better —
   run-to-run comparability is the point.
3. Ledger lives in the content repo at `.agents/content-loop/`. Read `topics.md` for focus
   areas and anti-topics. **If it is missing, still run.** Analyse and propose as normal,
   lead the output with one line saying anti-topic filtering was not applied, and offer to
   draft the file. A missing guardrail degrades confidence; it does not stop the run.
4. Read [ledger-schema.md](references/ledger-schema.md) before writing any ledger line, and
   [analysis-recipes.md](references/analysis-recipes.md) for the exact queries per mode.
5. **Never end a run having produced nothing.** If something genuinely blocks proposals,
   still report the property totals and what you found, then say precisely what is needed.
   Silence is a failure mode, not a safe default.

## Mode: propose

1. **Note backlog pressure — it is advisory, never a stop.** Count open issues labelled
   `content-proposal`. Count only that label: unrelated issues in the repo are not this
   loop's backlog and must not affect the run. If more than 8 are open, still propose, but
   lead with one line naming the count and the stalest 2–3 worth closing, and prefer your
   highest-confidence items. Never reduce the run to a refusal.
2. Pull property totals for `current` and `prior`. This is context, not a finding.
3. Work the opportunity classes in [analysis-recipes.md](references/analysis-recipes.md).
4. Filter every candidate against `topics.md`. An anti-topic match is dropped silently —
   do not propose it and then explain why you nearly did. Entries may be **scoped to
   specific opportunity classes**: an entry that blocks `gap` but allows `ctr-gap` means
   no new content on that subject, while cheap fixes to existing pages stay in scope.
   Apply the stated scope exactly; do not widen it to a blanket ban.
5. Keep at most **3** proposals, ranked by expected value, each with a distinct action.
   Fewer is fine. Zero is fine only when the data genuinely offers nothing worth acting
   on — and then say what you checked, so "nothing" is a finding rather than a shrug.
6. Present them in chat in the format below and **stop for discussion**. Do not create
   issues yet.
7. After the human responds, create GitHub issues **only** for what they accepted, and
   append every proposal — accepted or not — to `proposals.jsonl` with its verdict.

### Proposal format

```
### P-<YYYYMMDD>-<n> — <one-line action>
Class:      <ctr-gap | near-miss | gap | decay>
Evidence:   <query or page>, <metric> <prior> → <current>, position <prior> → <current>
Reasoning:  <why this specific action follows from that evidence>
Action:     <the concrete change: rewrite title, expand section, new post on X>
Confidence: <high | medium | low>, because <what would falsify this>
```

Keep evidence and recommendation separate. Never present a position or CTR movement as a
traffic promise.

## Mode: outcome

The only source of truth about whether this system is any good.

1. Read `proposals.jsonl` for accepted items whose linked content shipped 8–12 weeks ago
   and that have no row yet in `outcomes.jsonl`.
2. For each, compare the 28 days after shipping against the recorded pre-ship baseline,
   filtered to that page. Recipes are in
   [analysis-recipes.md](references/analysis-recipes.md).
3. Append one `outcomes.jsonl` row per item with the measured deltas and a `verdict` of
   `won`, `flat`, or `lost`.
4. Report the running hit rate. If it is not improving across quarters, say so directly —
   that is the signal the method needs changing, and suppressing it defeats the loop.

Never infer an outcome you did not measure. If a page has too little data, record
`insufficient-data` rather than guessing.

## Mode: reflect

1. Read `proposals.jsonl` and `outcomes.jsonl` in full. Compute acceptance rate by class,
   and win rate by class.
2. Identify classes that are consistently rejected or consistently lose, and classes that
   consistently win.
3. Open a PR against this skill proposing concrete edits — drop a class that never lands,
   change a threshold, tighten a rule. Cite the numbers that justify each change.
4. Propose `topics.md` edits separately; that file is human-owned, so suggest, never edit.

## Rules

- Three proposals maximum. Proposing nothing is valid **only when the data shows nothing
  worth acting on** — never as a reaction to a missing file or a full backlog.
- Every run produces something: proposals, or the totals plus what is needed to proceed.
- Missing or malformed `topics.md` degrades the run to unfiltered, clearly labelled. It
  never halts it.
- Never create a GitHub issue before the human has agreed to that specific proposal.
- Treat CTR as a query-mix metric. Losing low-CTR impressions raises CTR while traffic
  falls, so never report a CTR rise as improvement without checking clicks and impressions.
- Report absolute clicks alongside every rate. A percentage on a handful of clicks is noise.
- Detailed query data omits anonymised queries, so query totals need not match property
  totals. Do not present the difference as a discrepancy or a finding.
- Do not compare differently aggregated requests. A page-grouped query and a property total
  are not the same measurement.
- State the window on every finding. Undated numbers are unusable next week.
- Anti-topics in `topics.md` are absolute within their stated class scope. Do not
  relitigate them, and do not broaden a scoped entry into a blanket ban.
- Never edit `topics.md`; it is human-owned. Propose changes instead.
- Record every proposal in the ledger, including rejected ones. Rejections are the training
  signal — dropping them destroys the loop.

## Checklist

- The run produced something useful; it did not end in a refusal.
- Backlog pressure was reported as advice, counting only `content-proposal` issues.
- Every proposal has a stable ID, a class, dated evidence, and a falsifiable confidence.
- Every candidate was checked against `topics.md` anti-topics, or the output states plainly
  that the file was missing and filtering was skipped.
- No issue was created without explicit agreement in the conversation.
- Every proposal, including rejected ones, has a `proposals.jsonl` row with a verdict.
- Outcome rows contain measured numbers only; unmeasurable items are `insufficient-data`.
- Windows are stated, fixed, and identical to previous runs.
