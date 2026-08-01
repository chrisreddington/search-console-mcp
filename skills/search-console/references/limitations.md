# Search Console interpretation limits

- Search Analytics dates use Pacific Time. Finalized data commonly lags the current date.
- Detailed query data omits anonymized queries. Totals grouped by query therefore need not match property totals.
- Grouping/filtering by page changes aggregation behavior; do not compare differently aggregated requests as if equivalent.
- One response is limited to 25,000 rows. `startRow` paginates, while Google exposes at most 50,000 rows per day per search type, sorted by clicks.
- Search appearance analysis may require first discovering appearance values and then filtering subsequent queries.
- URL Inspection describes the indexed Google version. It is neither a live test nor an indexing request.
- A submitted sitemap is a discovery hint, not proof of indexing or canonical selection.

Official references:

- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data
- https://developers.google.com/webmaster-tools/v1/api_reference_index
