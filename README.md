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

The quickstart below uses a client file on disk, since it needs no prior setup. For
day-to-day use, [1Password Environments](#recommended-1password-environments) is the
preferred way to supply credentials — see [Supplying credentials](#supplying-credentials)
before you settle on one.

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
`skills/` and the server in its own `mcpServers` object. Add the plugin from a local path
with your normal Codex plugin workflow — no other configuration is needed.

Codex passes credentials through the `env_vars` allowlist in that `mcpServers` entry, so
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

`GSC_SECRET_PROVIDER` chooses where the OAuth client id and secret come from: `dotenv`
(recommended — see below), `file`, or `env`. Resolution fails closed — an unknown
provider, a missing file, or a value that is empty or still a template placeholder
(`your-…`, `changeme`, …) aborts startup with an actionable message instead of failing
later against the Google API. Error messages name the variable, path, or file to fix —
never the credential itself.

### Recommended: 1Password Environments

This is the primary way the maintainer runs this server. Store the client id and secret in
a [1Password Environment](https://developer.1password.com/docs/environments/) and have
1Password mount a [local `.env` file](https://developer.1password.com/docs/environments/local-env-file/)
for it, backed by a named pipe:

1. In 1Password, create an Environment with `GSC_CLIENT_ID` and `GSC_CLIENT_SECRET`.
2. Mount a local `.env` file for it, for example at `~/.config/search-console-mcp/` — see
   [Access secrets through local .env files](https://developer.1password.com/docs/environments/local-env-file/)
   for how the mount and its named pipe work.
3. Point the server at the mount:

```sh
export GSC_SECRET_PROVIDER=dotenv
export GSC_SECRET_DOTENV_PATH=~/.config/search-console-mcp/.env
```

**Why this is preferred over a file on disk:**

- **Nothing sits on disk in the clear.** The mount is a named pipe: 1Password serves the
  value on read and never writes it out, so there's no plaintext client secret file for a
  backup, a Time Machine snapshot, a synced `~/.config`, or a forensic disk image to pick
  up.
- **Access is gated by 1Password's own unlock, not just filesystem permissions.** A `0600`
  file is only as safe as "nobody else is logged in as you right now." The mount instead
  requires 1Password to be unlocked, so the credential stops being readable the moment you
  lock your session, independent of whatever else has read access to your home directory.
  See [1Password's security model](https://support.1password.com/1password-security/) for
  what unlocking actually gates.
- **One place to revoke.** Locking 1Password, or deleting the Environment, immediately cuts
  off every process reading the mount; a file has to be found and deleted everywhere it was
  copied to.
- **The refresh token can live alongside it** (see [Authorising](#authorising)), so the
  whole grant — client id, client secret, and refresh token — is one 1Password Environment
  instead of scattered across a JSON file and a token file.

The server only ever reads that path. It runs no external CLI, so it works unchanged when
launched by a GUI host such as the Codex or Claude desktop apps, which give their child
processes a minimal environment.

If the mount is missing — usually because 1Password is locked — startup fails with a
message saying exactly that.

### Alternative: a file on disk

```sh
export GSC_SECRET_PROVIDER=file   # the default
export GSC_OAUTH_CLIENT_FILE=/absolute/path/to/oauth-desktop-client.json
```

This is the quickest way to get started — no 1Password Environment to set up first — and
it's what the [Setup](#setup) quickstart above uses. It comes with a real tradeoff, though:
the client secret sits in **plaintext on disk, permanently**. Filesystem permissions (keep
`GSC_OAUTH_CLIENT_FILE` outside this repository, mode `0600`) and full-disk encryption are
the only things standing between it and anyone who gets read access to your account — a
stolen or unlocked laptop, malware running as you, another local process, a misdirected
backup, or a synced folder. Unlike the 1Password mount, there's no separate unlock gate: if
your session is accessible, the file is too, and it can end up copied without you noticing
— a backup tool or a dotfiles sync picking up `~/.config` along with everything else in it.

If you use this option, never commit the file (`.gitignore` already blocks anything named
like a credential). If the machine is ever compromised, the leaked client secret and the
grant are two separate things to clean up: reset the client secret in
[Google Cloud Console](https://console.cloud.google.com/apis/credentials) (APIs & Services
→ Credentials → your OAuth client → Add Secret, then delete the old one), and revoke the
grant at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) — see
[Where the token is stored](#where-the-token-is-stored).

### Also available: environment variables directly

```sh
export GSC_SECRET_PROVIDER=env
export GSC_CLIENT_ID=...
export GSC_CLIENT_SECRET=...
```

Convenient for a quick local test or a CI job that already injects secrets as environment
variables, but the least durable of the three: values live in shell history and process
environment rather than a managed store. Prefer `dotenv` (1Password) or `file` for anything
you'll keep using.

## Authorising

`npm run auth` runs the OAuth flow. Google requires a human to approve consent in a
browser, so this step is interactive by nature and is a command you run, not something an
agent can complete for you.

### How often you need to re-run it

This is set by your OAuth client's **Publishing status** in Google Cloud Console
(APIs & Services → OAuth consent screen), not by anything in this repo:

- **Testing** (the default for a new client) — Google revokes the refresh token after
  **7 days**, regardless of use. A weekly scheduled task will silently start failing
  mid-week if it lands on day 8. This is Google's behaviour for every "External" testing
  app, not something the server can work around.
- **In production** — the refresh token has no fixed expiry. It only stops working if it
  goes unused for 6 months, you revoke it, your Google Account password changes, or the
  Google Account exceeds its refresh-token limit for the client.

For a single-user read-only tool like this one, publish to production directly from the
consent screen; you do **not** need to submit for Google's verification review just to get
past the 7-day limit. Google will show a one-time "Google hasn't verified this app" warning
during `npm run auth` — click through it (Advanced → Go to \<app name\> (unsafe)) — and the
resulting refresh token is then long-lived. Re-run `npm run auth` only if you see the
rotation warning below, or if the server reports an `invalid_grant` error.

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

## Running this as a weekly, self-improving content loop

The server is one half of the product; [`skills/content-opportunities/`](skills/content-opportunities/)
is the other. Point it at a content repo and it turns Search Console evidence into a small,
disciplined loop instead of a one-off report:

```
propose (weekly)  →  human accepts/rejects  →  ship  →  measure outcome (8+ weeks later)  →
                                                            ↓
                                        reflect (quarterly): which classes actually win?
                                                            ↓
                                          PR against this skill, cited with real numbers
```

Every weekly `propose` run does two things in one pass: it sweeps for any accepted proposal
that shipped 8+ weeks ago and has no measured outcome yet, then proposes up to 3 new items.
There is no separate outcome schedule to remember — a skipped or failed week just leaves the
item due for the next one. `reflect` closes the loop quarterly by mining the ledger for
which opportunity classes actually convert into wins, and proposes edits to the skill's own
thresholds, cited with the numbers that justify them.

**Where the learning actually lives**, so a consolidation memory or a stale prompt can't
quietly erode it — two tiers, on purpose:

- **Taste → your agent host's memory.** In-chat corrections ("stop proposing Azure", "I
  care about agent tooling more than DevOps") belong here. Memory is _meant_ to consolidate
  and reword over time, which is right for preferences and wrong for facts.
- **Facts → the ledger**, three JSONL/Markdown files the skill reads and writes in the
  content repo at `.agents/content-loop/`: proposal IDs, verdicts and reasons
  (`proposals.jsonl`), measured deltas (`outcomes.jsonl`), and your hand-maintained focus
  areas, anti-topics and discovery patterns (`topics.md`). These need to stay exact and
  diffable, so they live in git next to the content, not in a system that rewords them.

To set it up in a content repo:

1. Create `.agents/content-loop/topics.md` by hand — focus areas, anti-topics (optionally
   scoped to specific opportunity classes), and `## Discovery patterns` regexes for query
   clusters. The skill runs without it, but degrades to unfiltered and says so.
2. Let the skill create `proposals.jsonl` and `outcomes.jsonl` on first run; the exact shape
   of every row is in [ledger-schema.md](skills/content-opportunities/references/ledger-schema.md).
3. Schedule `propose` weekly and `reflect` quarterly. For Codex specifically — including the
   task prompts, the local-environment requirement, and why the weekly task must live inside
   one continuing chat — see [docs/codex-setup.md](docs/codex-setup.md#scheduled-tasks).

The method itself — modes, evidence recipes, the acceptance handoff, the rules that keep
proposals falsifiable — is documented once, in
[skills/content-opportunities/SKILL.md](skills/content-opportunities/SKILL.md); this section
is only the operational shape of the loop.

## Development

```sh
npm run check
```

Contributor and agent guidance lives in [AGENTS.md](AGENTS.md); reusable agent skills are
in [.agent/skills/](.agent/skills/).
