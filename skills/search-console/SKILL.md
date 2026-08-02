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

## When a tool fails for want of credentials

The server reads credentials from wherever `GSC_SECRET_PROVIDER` points; it never runs a
CLI and never needs a value passed to it. Its errors name the exact thing to fix, so read
them before acting.

If an error says a dotenv file is missing, that path is a 1Password Environment mount and
it is not currently there — almost always because 1Password is locked, or restarted without
remounting. Recover it without asking the user:

1. Use the 1Password MCP server to list local env files for the Environment.
2. If the mount is absent, recreate it at the same path the error named.
3. Retry the original tool call once.

Only report a block if that fails, and say which cause it was.

Never ask the user to paste a credential, and never write one through a tool call —
`append_variables` takes the value as an argument, which would place the secret in your
context. Values are added in the 1Password app by the user.

## Authentication

If tools report that no token exists, direct the user to run `npm run auth` from the plugin source. Authorization is interactive and needs a browser, so never attempt it yourself. Never request, display, log, paste, or copy credential/token contents. The OAuth scope is fixed to `webmasters.readonly` and token files are written with private permissions.

## Reporting

- Lead with material changes and actionable page/query opportunities.
- Include date ranges, search type, dimensions, and important filters.
- Label partial/fresh data and privacy-related omissions.
- Avoid claiming that the API bypasses Search Console anonymization or row limits.
- Separate evidence from recommendations and avoid promising traffic gains.
