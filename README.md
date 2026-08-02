# Search Console MCP

A local, read-only Google Search Console MCP server and Codex skill. It supports:

- listing accessible Search Console properties;
- Search Analytics dimensions, filters, date ranges, and explicit pagination;
- comparing two date windows for one grain, with coverage metadata;
- listing submitted sitemaps; and
- inspecting Google's indexed version of a URL.

There are deliberately no mutation tools for sites or sitemaps, and no indexing-request
operation. Authorization requests only
`https://www.googleapis.com/auth/webmasters.readonly`.

## Requirements

- Node.js 26 or later, on macOS or Linux (paths are POSIX-only by design)
- A Google OAuth **Desktop** client with the Search Console API enabled
- Access to at least one Search Console property

## Setup

```sh
npm ci
export GSC_OAUTH_CLIENT_FILE=/absolute/path/to/oauth-desktop-client.json
export GSC_TOKEN_FILE=$HOME/.config/search-console-mcp/token.json
npm run auth
npm run build
```

`npm run auth` opens a browser, uses a loopback callback, and also prints the
authorization URL to stderr so it works over SSH. It never prints credential or token
contents, and writes the token to [`GSC_TOKEN_FILE`](#where-the-token-is-stored) with
mode `0600`.

The clone must stay on disk and stay built — every host below launches the same
self-locating `bin/search-console-mcp` wrapper out of this directory. Re-run
`npm ci && npm run build` after pulling changes; the wrapper prints which of the two is
missing rather than failing as an opaque MCP connection error.

## Installing

The same server and skill work in three ways. Pick one.

### Codex plugin

The repository is a Codex plugin as-is: `.codex-plugin/plugin.json` declares the skill in
`skills/` and points at `.codex-plugin/mcp.json` for the server. Add the plugin from a
local path with your normal Codex plugin workflow — no other configuration is needed.

Codex passes credentials through the `env_vars` allowlist in `.codex-plugin/mcp.json`, so
any `GSC_*` variable exported in your shell reaches the server. Add the variable name
there if you introduce a new one.

### Claude Code plugin

`.claude-plugin/plugin.json` is the manifest, and Claude Code auto-discovers the
`skills/` directory and the root `.mcp.json`, which launches the server via
`${CLAUDE_PLUGIN_ROOT}` so it resolves wherever the plugin is installed.

```sh
claude plugin validate .    # optional: check the manifest before installing
```

Plugin MCP servers inherit your user environment, so exported `GSC_*` variables are
picked up with no extra configuration.

### Plain MCP server

Any MCP client can launch the server directly over stdio. Use an absolute path to the
wrapper:

```json
{
  "mcpServers": {
    "search-console": {
      "command": "/absolute/path/to/search-console-mcp/bin/search-console-mcp",
      "env": {
        "GSC_OAUTH_CLIENT_FILE": "/absolute/path/to/oauth-desktop-client.json"
      }
    }
  }
}
```

For Claude Code without the plugin wrapper:

```sh
claude mcp add search-console -- /absolute/path/to/search-console-mcp/bin/search-console-mcp
```

Do not reuse the repository's root `.mcp.json` verbatim outside a Claude Code plugin
install — it contains the `${CLAUDE_PLUGIN_ROOT}` placeholder, which only Claude Code
expands.

## Supplying credentials

`GSC_SECRET_PROVIDER` chooses where the OAuth client id and secret come from:

| `GSC_SECRET_PROVIDER` | Required configuration                                                      |
| --------------------- | --------------------------------------------------------------------------- |
| `file` (default)      | `GSC_OAUTH_CLIENT_FILE` — the Desktop client JSON from Google Cloud console |
| `env`                 | `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`                                        |
| `dotenv`              | `GSC_SECRET_DOTENV_PATH` holding `GSC_CLIENT_ID` and `GSC_CLIENT_SECRET`    |

Resolution fails closed. An unknown provider, a missing file, or a value that is empty or
still a template placeholder (`your-…`, `changeme`, …) aborts startup with an actionable
message instead of failing later against the Google API. Error messages name the variable,
path, or file to fix — never the credential itself.

### Recommended: 1Password Environments

Store the credentials in a [1Password Environment](https://developer.1password.com/docs/environments/local-env-file/)
and have 1Password mount a local `.env` for them. The mount is backed by a named pipe, so
values are served on read and **never written to disk**, and authorisation lasts until
1Password locks rather than being requested per process.

1. In 1Password, create an Environment with `GSC_CLIENT_ID` and `GSC_CLIENT_SECRET`.
2. Mount a local `.env` file for it, for example at `~/.config/search-console-mcp/`.
3. Point the server at the mount:

```sh
export GSC_SECRET_PROVIDER=dotenv
export GSC_SECRET_DOTENV_PATH=~/.config/search-console-mcp/.env
```

The server only ever reads that path. It runs no external CLI, so it works unchanged when
launched by a GUI host such as the Codex or Claude desktop apps, which give their child
processes a minimal environment.

If the mount is missing — usually because 1Password is locked — startup fails with a
message saying exactly that.

## Authorising

`npm run auth` runs the OAuth flow. Google requires a human to approve consent in a
browser, so this step is interactive by nature and is a command you run, not something an
agent can complete for you.

Set `GSC_TOKEN_OP_ENVIRONMENT` to a 1Password Environment name and the refresh token is
written straight into that Environment over stdio — from the CLI process to 1Password,
never through a file and never through an agent's context:

```sh
export GSC_TOKEN_OP_ENVIRONMENT=search-console-mcp
npm run auth
```

The variable appears as `GSC_REFRESH_TOKEN` in the Environment, and therefore in the
mounted `.env` the server reads.

1Password's MCP server can add a variable but not replace one, so re-authorising means
deleting `GSC_REFRESH_TOKEN` in the 1Password app first. The command says so rather than
failing obscurely.

Leave `GSC_TOKEN_OP_ENVIRONMENT` unset and the token is written to `GSC_TOKEN_FILE`
instead.

## Where the token is stored

Authorisation produces a refresh token, which is the credential that actually grants access
to your data. It is written to `GSC_TOKEN_FILE` (default
`~/.config/search-console-mcp/token.json`) atomically, with mode `0600` inside a `0700`
directory.

It lives in a file rather than a vault because it must be **written** as well as read:
Google can rotate the refresh token, and a store that only serves reads cannot accept the
replacement. The server writes it only when that rotation happens, not on the routine
hourly access-token refresh.

Deleting the token file does not revoke anything. To revoke access, remove the app grant at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Tools

| Tool                           | Purpose                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `gsc_list_sites`               | List properties available to the authenticated account          |
| `gsc_query_search_analytics`   | Query Search Analytics with dimensions, filters, and pagination |
| `gsc_compare_search_analytics` | Compare two windows for one grain, with coverage metadata       |
| `gsc_list_sitemaps`            | List submitted sitemaps for a property                          |
| `gsc_inspect_url`              | Inspect Google's indexed version of a URL (not a live test)     |

All five are annotated `readOnlyHint: true`.

`gsc_compare_search_analytics` retrieves both windows, union-joins them by dimension key,
and returns `current`, `prior`, and `delta` metrics per row. Metric filtering, sorting, and
the row limit run **after** retrieval, and each retrieval is cached for the session, so
re-analysing one grain with different thresholds costs no further API requests.

`retrievalMode: "daily"` issues one paginated request per day and aggregates locally, which
widens the row budget at the cost of locally derived metrics; `"range"` (the default) lets
Google aggregate the window. Do not mix figures from the two. Every response carries a
`coverage` block: `rowCapReached: true` proves truncation, but `false` does not prove
completeness, because Search Analytics returns click-sorted top rows with no true total.

## Development

```sh
npm run check
```

Contributor and agent guidance lives in [AGENTS.md](AGENTS.md); reusable agent skills are
in [.agent/skills/](.agent/skills/).
