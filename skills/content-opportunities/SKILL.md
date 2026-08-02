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

| Mode      | Cadence   | Produces                                               |
| --------- | --------- | ------------------------------------------------------ |
| `propose` | Weekly    | Due outcomes first, then up to 3 proposals             |
| `outcome` | Ad hoc    | Due-outcome sweep only, for backfills or manual checks |
| `reflect` | Quarterly | A PR proposing changes to this skill                   |

## Shared setup

1. Property is `sc-domain:chrisreddington.com` unless the request names another. Call
   `gsc_list_sites` only if the identifier is unknown.
2. **Fixed windows, always.** `end = today − 3 days` (Search Console finalises with a
   2–3 day lag). `current = the 28 days ending at end`. `prior = the 28 days immediately
before current`. Never widen, narrow, or shift these to make a finding look better —
   run-to-run comparability is the point.
3. Ledger lives in the content repo at `.agents/content-loop/`. Read `topics.md` for focus
   areas, anti-topics, and discovery patterns. **If it is missing, still run.** Analyse and
   propose as normal, lead the output with one line saying anti-topic filtering was not
   applied, and offer to draft the file. A missing guardrail degrades confidence; it does
   not stop the run.
4. Read [ledger-schema.md](references/ledger-schema.md) before writing any ledger line, and
   [analysis-recipes.md](references/analysis-recipes.md) for the acquisition plan and the
   analysis per mode.
5. **Retrieve before you analyse.** Acquire the datasets named in the acquisition plan once,
   then run every opportunity class over them. A retrieval is cached for the session, so
   re-filtering or re-sorting a grain is free — but re-acquiring one because a later class
   wants a different cut of the same rows is the mistake this plan exists to prevent.
6. **Never end a run having produced nothing.** If something genuinely blocks proposals,
   still report the property totals and what you found, then say precisely what is needed.
   Silence is a failure mode, not a safe default.

## Mode: propose

1. **Measure due outcomes first.** Run the [due-outcome sweep](#due-outcome-sweep). A failed
   measurement stays due for the next weekly run; it never blocks the proposal pass.
2. **Note backlog pressure — it is advisory, never a stop.** Count open issues labelled
   `content-proposal`. Count only that label: unrelated issues in the repo are not this
   loop's backlog and must not affect the run. If more than 8 are open, still propose, but
   lead with one line naming the count and the stalest 2–3 worth closing, and prefer your
   highest-confidence items. Never reduce the run to a refusal.
3. Acquire the datasets in the [acquisition plan](references/analysis-recipes.md#phase-1-acquire),
   then read the `coverage` block of each. Property totals are context, not a finding.
4. Work the opportunity classes in [analysis-recipes.md](references/analysis-recipes.md)
   over those datasets, then run the focus-area cluster pass for every focus area in
   `topics.md`. Focus-area candidates compete with the metric-led classes on evidence,
   expected value and strategic fit; they get no reserved slot.
5. Validate each surviving candidate with a targeted `range` retrieval and quote those
   numbers, not the discovery figures.
6. Filter every candidate against `topics.md`. An anti-topic match is dropped silently —
   do not propose it and then explain why you nearly did. Entries may be **scoped to
   specific opportunity classes**: an entry that blocks `gap` but allows `ctr-gap` means
   no new content on that subject, while cheap fixes to existing pages stay in scope.
   Apply the stated scope exactly; do not widen it to a blanket ban.
7. Keep at most **3** proposals, ranked by expected value, each with a distinct action.
   Fewer is fine. Zero is fine only when the data genuinely offers nothing worth acting
   on — and then say what you checked and over how many rows, so "nothing" is a finding
   rather than a shrug.
8. Present them in chat in the format below and **stop for discussion**. Do not create
   issues yet.
9. After the human responds, create GitHub issues **only** for what they accepted. Before
   creating each issue, complete the [accepted-proposal handoff](#accepted-proposal-handoff),
   then append every proposal — accepted or not — to `proposals.jsonl` with its verdict.

## Accepted-proposal handoff

Acceptance authorises an issue, not an ungrounded implementation brief. For every accepted
proposal, do the following before creating or updating its issue:

1. **Recheck the target and duplicates.** Inspect the current source page (title,
   description, date, relevant sections, links, and existing series context) and search open
   issues. Reuse and update an existing matching issue instead of creating a duplicate.
2. **Research the current landscape.** Browse for 2–4 directly relevant, authoritative
   sources. Prefer primary documentation, standards, release notes, or product roadmaps.
   Record what has materially changed since the page was published and what that implies for
   the work. Treat trends as context, never as proof of traffic demand; Search Console remains
   the evidence for the opportunity.
3. **Set the scope to the subject.** Separate maintenance of an existing page from a new or
   expanded content investment. Honour every scoped anti-topic: a maintenance-only subject
   may receive accuracy, terminology, link, screenshot, and intent-alignment work, but not a
   newly invented companion post. A current focus area may justify a new series entry only
   when the Search Console evidence and landscape both support it.
4. **Create an implementation-ready issue** with these headings:

   ```md
   ## Why this matters now

   ## Search Console evidence

   ## Current content state

   ## Current landscape

   ## Recommended change

   ## Scope and non-goals

   ## Acceptance criteria

   ## Sources
   ```

   The evidence section must state the fixed windows, dimensions or filters, absolute clicks
   and impressions, positions, retrieval coverage, and the anonymised-query limitation. The
   current-content section must cite the actual local page state. The landscape section must
   use linked sources with publication or retrieval dates. Recommendations and acceptance
   criteria must be concrete, testable, and explicitly distinguish confirmed facts from
   editorial judgement.

5. **Record the decision accurately.** Append the ledger row only after issue creation or
   duplicate reuse. Use the human's verdict words, set `issue` to the canonical URL for an
   accepted item, and leave `shipped_url` and `shipped_at` null until work lands.

### Proposal format

```
### P-<YYYYMMDD>-<n> — <one-line action>
Class:      <ctr-gap | near-miss | gap | decay | focus-area>
Evidence:   <query or page>, <metric> <prior> → <current>, position <prior> → <current>
Reasoning:  <why this specific action follows from that evidence>
Action:     <the concrete change: rewrite title, expand section, new post on X>
Confidence: <high | medium | low>, because <what would falsify this>
```

Keep evidence and recommendation separate. Never present a position or CTR movement as a
traffic promise.

## Mode: outcome

The only source of truth about whether this system is any good.

Run the [due-outcome sweep](#due-outcome-sweep) and stop. Use this mode to backfill missed
measurements or inspect outcomes without running the weekly proposal pass.

Never infer an outcome you did not measure. If a page has too little data, record
`insufficient-data` rather than guessing.

## Due-outcome sweep

1. Read both ledgers. Select every accepted proposal with `shipped_url` and `shipped_at`, no
   outcome row, and a ship date at least 8 weeks ago. Eight to twelve weeks is the preferred
   measurement period, not an expiry window: an older unmeasured item remains due.
2. Report accepted rows whose shipping fields are still null as ledger hygiene. Never infer
   a ship date from an issue checkbox or a page timestamp.
3. Measure every due item with the outcome recipe in
   [analysis-recipes.md](references/analysis-recipes.md). Append an `outcomes.jsonl` row only
   after a complete, real retrieval.
4. If the linked issue records a target query or focus-cluster regex, repeat that diagnostic
   over the same windows. Keep the page-level click verdict primary; query detail omits
   anonymised queries.
5. Add the measured windows, metrics, verdict, and concise interpretation to the linked
   issue, then close it. If the issue write fails, retain the outcome row and report the exact
   follow-up needed; never discard a valid measurement because issue bookkeeping failed.
6. Report the running hit rate. If it is not improving across quarters, say so directly.
   A `flat` or `lost` result may inform a future proposal, but never authorises another edit.

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
- An accepted issue must contain current-content inspection, Search Console evidence, and
  current-landscape research; none may substitute for the others.
- Use authoritative linked sources for current-landscape claims, date them, and keep their
  implications distinct from Search Console evidence and editorial judgement.
- An existing matching issue is the accepted proposal's issue: update it with the current
  handoff rather than creating a duplicate.
- Retrieval never proves completeness. Say "no other candidate cleared the thresholds in the
  rows retrieved", never "no other candidate exists". Report truncation and failed days in
  the run output, not in a footnote.
- Quote validated `range` numbers in a proposal. Locally aggregated `daily` figures rank
  candidates; they never become the record, and the two are never mixed in one figure.
- A `gap` is a gap Search Console can see. It cannot reveal a topic the property earns no
  impressions for at all, so never present one as complete market coverage.
- Focus-area clusters must show their constituent queries. An aggregate nobody can
  decompose is not evidence.
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
- Each grain was acquired once; no class re-retrieved rows another class already had.
- The focus-area pass ran for every focus area, or the output says the discovery patterns
  were missing.
- Coverage was read and reported: truncation, failed days, and rows examined per class.
- Backlog pressure was reported as advice, counting only `content-proposal` issues.
- Every proposal has a stable ID, a class, dated evidence, and a falsifiable confidence.
- Every candidate was checked against `topics.md` anti-topics, or the output states plainly
  that the file was missing and filtering was skipped.
- No issue was created without explicit agreement in the conversation.
- Every weekly propose run scanned for due outcomes before looking for new work.
- Every accepted issue has the required handoff headings, current-source links, and a scope
  consistent with `topics.md`.
- Every proposal, including rejected ones, has a `proposals.jsonl` row with a verdict.
- Outcome rows contain measured numbers only; unmeasurable items are `insufficient-data`.
- Windows are stated, fixed, and identical to previous runs.
