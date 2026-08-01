---
name: writing-readable-code
description: Write plain, readable code over clever code. Use whenever writing or reviewing production code, naming things, or when code is dense, deeply nested, or hard to follow.
---

# Writing readable code

Write code that reads in plain English, with clear intent and minimal nesting.

## Rules

- Name by intent (`isReady`, `unpaidInvoices`); no single letters except loop indices.
- Split a function when it mixes concerns (I/O, parsing, validation, business logic).
- Use guard clauses and early returns for errors and edge cases; keep the happy path at the lowest indent.
- Do not combine branching, mutation, and error handling in one expression; a nested ternary is a rewrite, not a style choice.
- Replace magic numbers and strings with named constants.
- Comment the _why_ (constraint, trade-off, business rule); never narrate _what_ the next line does.

## Checklist

- Every name reveals intent without decoding.
- No function does more than one job; guard clauses keep the happy path at the lowest indent.
- No dense one-liner hides logic; no magic literals; no nested ternaries.
- Comments explain rationale, not mechanics.
