---
name: search-console
description: Analyze Google Search Console performance and indexing through the bundled read-only MCP server. Use when Codex needs to list accessible properties, query Search Analytics by page or query, compare date ranges, inspect indexed URL status, review submitted sitemaps, or turn Google organic-search evidence into SEO priorities.
---

# Google Search Console

Use the bundled `search-console` MCP tools. Keep all operations read-only.

## Workflow

1. Call `gsc_list_sites` when the property identifier is unknown. Preserve identifiers exactly; domain properties use `sc-domain:example.com`.
2. Establish the latest finalized date with a small `gsc_query_search_analytics` request grouped by `date` before comparing periods.
3. Query totals without `page` or `query` dimensions, then query the dimensions needed for diagnosis. Do not add every dimension reflexively.
4. Use `allPages: true` only when row-level analysis needs it. Set a deliberate `maxRows`; the default ceiling is 25,000.
5. Compare equal-length periods and distinguish impression growth, ranking movement, and CTR changes. Treat average CTR as a query-mix metric, not a site-quality score.
6. Use `gsc_inspect_url` for Google's indexed status and canonical selection. State clearly that it is not a live inspection and does not request indexing.
7. Use `gsc_list_sitemaps` to assess submitted sitemap state, not to infer that every discovered URL is canonical or indexed.

Read [limitations.md](references/limitations.md) before interpreting detailed or exhaustive-looking query results.

## Authentication

If tools report that no token exists, direct the user to configure `GSC_OAUTH_CLIENT_FILE` with an external OAuth Desktop client file and optionally `GSC_TOKEN_FILE`, then run `npm run auth` from the plugin source. Never request, display, log, paste, or copy credential/token contents. The OAuth scope is fixed to `webmasters.readonly` and token files are written with private permissions.

## Reporting

- Lead with material changes and actionable page/query opportunities.
- Include date ranges, search type, dimensions, and important filters.
- Label partial/fresh data and privacy-related omissions.
- Avoid claiming that the API bypasses Search Console anonymization or row limits.
- Separate evidence from recommendations and avoid promising traffic gains.
