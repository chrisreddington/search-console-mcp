# Search Console MCP

A local, read-only Google Search Console MCP server and Codex skill. It supports:

- listing accessible Search Console properties;
- Search Analytics dimensions, filters, date ranges, and explicit pagination;
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
contents, and stores the resulting token through whichever backend
[`GSC_TOKEN_PROVIDER`](#where-the-token-is-stored) names — by default a `0600` file.

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

The server never reads credentials out of `.mcp.json`. Set `GSC_SECRET_PROVIDER` to
choose where the OAuth client id and secret come from:

| `GSC_SECRET_PROVIDER` | Required configuration                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `file` (default)      | `GSC_OAUTH_CLIENT_FILE` — path to the Desktop client JSON from Google Cloud console                 |
| `env`                 | `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`                                                                |
| `dotenv`              | `GSC_SECRET_DOTENV_PATH` (default `.env`) holding `GSC_CLIENT_ID` and `GSC_CLIENT_SECRET`           |
| `1password`           | `op` on PATH, `GSC_SECRET_OP_VAULT`, `GSC_SECRET_OP_ITEM`; item exposes `client_id`/`client_secret` |
| `keychain`            | macOS `security` or Linux `secret-tool`, service `search-console-mcp`                               |
| `doppler`             | `doppler` on PATH, with `GSC_CLIENT_ID` and `GSC_CLIENT_SECRET` in the active config                |

Resolution fails closed. An unknown provider, a backend error, or a value that is empty
or still a template placeholder (`your-…`, `changeme`, …) aborts startup with an
actionable message instead of failing later against the Google API. Error messages name
the variable, path, or CLI to fix — never the credential itself.

See [.env.example](.env.example) for every variable, including the exact `security` and
`secret-tool` commands for storing keychain entries.

## Where the token is stored

Authorization produces a refresh token, and that token — not the client secret — is
the thing that actually grants access to your data. `GSC_TOKEN_PROVIDER` chooses where
it lives:

| `GSC_TOKEN_PROVIDER` | Storage                                         | Protection                        |
| -------------------- | ----------------------------------------------- | --------------------------------- |
| `file` (default)     | `GSC_TOKEN_FILE`, atomic write, mode `0600`     | Filesystem permissions only       |
| `1password`          | A vault document, written and read through `op` | Vault encryption, unlock required |

For the `1password` backend set `GSC_TOKEN_OP_ITEM` (default `Search Console Token`);
the vault falls back to `GSC_SECRET_OP_VAULT`, so the common case needs no extra
variable.

```sh
export GSC_TOKEN_PROVIDER=1password
```

Two honest caveats about the 1Password backend. `op` rejects a document body on stdin
when it is spawned rather than shell-piped, so the token is staged in a `0600` file
inside a `0700` temporary directory, passed to `op` by path, then overwritten and
deleted — it touches the disk briefly, and on a copy-on-write filesystem that overwrite
is best-effort. And every read and refresh needs the vault unlocked, so a locked
1Password makes the server fail to start rather than fall back.

`GSC_TOKEN_FILE` is a location rather than a secret; it defaults to
`~/.config/search-console-mcp/token.json`.

Deleting a stored token does not revoke anything. To actually revoke access, remove the
app grant at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

### Examples

```sh
# 1Password
export GSC_SECRET_PROVIDER=1password
export GSC_SECRET_OP_VAULT=Private
export GSC_SECRET_OP_ITEM='Search Console'

# macOS Keychain
security add-generic-password -s search-console-mcp -a GSC_CLIENT_ID -w '<client id>'
security add-generic-password -s search-console-mcp -a GSC_CLIENT_SECRET -w '<client secret>'
export GSC_SECRET_PROVIDER=keychain
```

## Tools

| Tool                         | Purpose                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `gsc_list_sites`             | List properties available to the authenticated account          |
| `gsc_query_search_analytics` | Query Search Analytics with dimensions, filters, and pagination |
| `gsc_list_sitemaps`          | List submitted sitemaps for a property                          |
| `gsc_inspect_url`            | Inspect Google's indexed version of a URL (not a live test)     |

All four are annotated `readOnlyHint: true`.

## Development

```sh
npm run check
```

Contributor and agent guidance lives in [AGENTS.md](AGENTS.md); reusable agent skills are
in [.agent/skills/](.agent/skills/).
