# Search Console interpretation limits

- Search Analytics dates use Pacific Time. Finalized data commonly lags the current date.
- Detailed query data omits anonymized queries. Totals grouped by query therefore need not match property totals.
- Grouping/filtering by page changes aggregation behavior; do not compare differently aggregated requests as if equivalent.
- One response is limited to 25,000 rows. `startRow` paginates, while Google exposes at most 50,000 rows per day per search type, sorted by clicks.
- No retrieval here is exhaustive. Google returns click-sorted top rows, does not guarantee every row, and reports no true total, so `allPages: true` over a range is a complete _pull_ and not a complete _dataset_. Never describe one as such.
- Because rows are click-sorted, a row cap truncates from the zero-click end first — exactly where high-impression opportunities sit. Google recommends day-by-day paginated retrieval when comprehensiveness matters.
- Day-by-day retrieval and whole-range retrieval are different measurements. Range metrics are Google's own aggregation; daily metrics summed locally need not reconcile with them. Never combine the two in one figure.
- It is plausible but **not documented** that a long-tail query visible over a range disappears from every single-day request. Measured once on `sc-domain:chrisreddington.com` (2026-08-02, 28-day windows, page / query / page-query grains), the two modes returned identical key sets, metrics and long-tail counts, so the effect did not appear on a property of that size. Treat it as an open hypothesis, not as refuted and not as established, and re-measure rather than assuming either way.
- Search appearance analysis may require first discovering appearance values and then filtering subsequent queries.
- URL Inspection describes the indexed Google version. It is neither a live test nor an indexing request.
- A submitted sitemap is a discovery hint, not proof of indexing or canonical selection.

Official references:

- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data
- https://developers.google.com/webmaster-tools/v1/api_reference_index
