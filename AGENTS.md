# AGENTS.md

## What this repository is

`search-console-mcp` is a local, **read-only** Google Search Console MCP server plus a
bundled skill. It ships three ways — as a Codex plugin, as a Claude Code plugin, and as a
plain stdio MCP server (see [Distribution targets](#distribution-targets)). Agents connect
over stdio via the
[Model Context Protocol](https://modelcontextprotocol.io) to list properties, query
Search Analytics, list submitted sitemaps, and inspect Google's indexed version of a URL.

The server is deliberately narrow. It exposes no mutation tools for sites or sitemaps,
and no indexing-request operation. The OAuth scope is fixed to
`https://www.googleapis.com/auth/webmasters.readonly`. Widening either of those is a
product decision, not a convenience change.

## Toolchain

Node 26 (`.node-version`, `engines.node`), TypeScript 7 — the native compiler, which
ships per-platform binaries as optional dependencies, so `package-lock.json` must keep
all of them for `npm ci` to work on Linux CI. `target` and `lib` are `ES2025`, the newest
TypeScript 7 accepts and fully supported by Node 26. Keep these aligned when bumping any
one of them.

## Build, test, and validate

Run all commands from the repo root.

```bash
npm ci              # install exactly what package-lock.json pins
npm run build       # tsc -p tsconfig.json
npm run typecheck   # tsc --noEmit
npm run format:check
npm run format      # prettier --write .
npm test            # builds, then node --test dist/src/*.test.js
npm run check       # format:check + typecheck + test
npm run auth        # interactive OAuth; needs real credentials, never run in CI
```

These mirror CI (`.github/workflows/ci.yml`) — match them locally before opening a PR.

## Mandatory pre-commit / pre-push gate

**Do not commit or push without running and passing:**

```bash
npm run check
```

If it fails, fix it before committing. CI enforces the same commands, so a failing
local gate always means failing CI.

## Project layout

```
src/secrets.ts        Pluggable OAuth credential resolution. The ONLY module that reads a secret.
src/config.ts         Path expansion and token-file location (locations, not secrets).
src/auth.ts           OAuth2 client construction and access-token refresh.
src/auth-cli.ts       `npm run auth` — loopback OAuth authorization flow.
src/token-store.ts    Atomic 0600 token persistence.
src/google-client.ts  Search Console HTTP calls, pagination, error sanitisation.
src/server.ts         MCP tool registration and stdio entrypoint.
src/*.test.ts         Tests live next to the module they cover. There is no test/ directory.
bin/search-console-mcp  Self-locating POSIX wrapper every host launches.
skills/search-console/        Product skill: how to query Search Console safely.
skills/content-opportunities/ Product skill: the weekly content loop (propose/outcome/reflect).
docs/codex-setup.md           Codex install, cachebuster flow, and scheduled tasks.
.agent/skills/        Agent skills for working on this repo. Not shipped.
```

## Distribution targets

One server, three install paths. Each host owns its own MCP config file so no host sees
another's keys — do not merge them back into one file.

| Host               | Manifest                     | MCP config               | Launch path                               |
| ------------------ | ---------------------------- | ------------------------ | ----------------------------------------- |
| Codex plugin       | `.codex-plugin/plugin.json`  | `.codex-plugin/mcp.json` | relative `command` + `cwd` (plugin root)  |
| Claude Code plugin | `.claude-plugin/plugin.json` | `.mcp.json` (root)       | `${CLAUDE_PLUGIN_ROOT}` placeholder       |
| Plain MCP client   | none                         | the user's own config    | absolute path to `bin/search-console-mcp` |

Constraints behind that split:

- `cwd` and `env_vars` are Codex-only keys. `${CLAUDE_PLUGIN_ROOT}` is Claude-only, and
  Codex passes it through as a literal string, so a shared file breaks one host or the other.
- Codex resolves a relative `cwd` against the plugin root but does **not** resolve a
  relative `command`; the relative command only works because `cwd` is set.
- A string-valued `mcpServers` in the Codex manifest _replaces_ default `.mcp.json`
  discovery, which is why pointing it at `.codex-plugin/mcp.json` keeps Codex away from
  the Claude-shaped root file.
- `.claude-plugin/plugin.json` deliberately declares neither `skills` nor `mcpServers`:
  Claude Code auto-discovers `skills/` and root `.mcp.json`, and naming them would either
  replace the default scan or trigger an ignored-folder warning.
- Claude Code also puts `bin/` on the Bash tool's `PATH` when the plugin is enabled.

Keep `version` in both manifests in step with `package.json`.

`codex plugin add` copies the plugin into a version-keyed cache
(`~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`), including `dist/` and
`node_modules/`. That snapshot is what Codex runs, so editing the checkout changes nothing
until you `npm run build`, bump `version`, and re-add. See `docs/codex-setup.md`.

The Codex personal marketplace only accepts a `./`-relative `source.path`; an absolute path
loads the marketplace but silently hides the plugin.

## Secret providers

The server never takes credentials from `.mcp.json` directly. Set `GSC_SECRET_PROVIDER`
to choose where the OAuth Desktop client id and secret come from:

| Value       | How it resolves the client id and secret                                     |
| ----------- | ---------------------------------------------------------------------------- |
| `file`      | Reads the `installed` block of the JSON at `GSC_OAUTH_CLIENT_FILE` (default) |
| `env`       | `GSC_CLIENT_ID` and `GSC_CLIENT_SECRET` directly                             |
| `dotenv`    | Parses the file at `GSC_SECRET_DOTENV_PATH` (default `.env`)                 |
| `1password` | Shells out to `op`; uses `GSC_SECRET_OP_VAULT` + `GSC_SECRET_OP_ITEM`        |
| `keychain`  | macOS `security` / Linux `secret-tool`, service `search-console-mcp`         |
| `doppler`   | Shells out to `doppler secrets download --no-file --format env`              |

Resolution fails closed: an unknown provider, a backend error, or an empty or
placeholder value aborts startup. There is no silent fallback to a weaker provider.

`GSC_TOKEN_FILE` (default `~/.config/search-console-mcp/token.json`) is a _location_, not
a secret, and is safe to name in error messages.

## Token storage

`GSC_TOKEN_PROVIDER` selects the `TokenStore` implementation: `file` (default, atomic
`0600` write) or `1password` (a vault document via `op`). The refresh token is the real
access grant, so it deserves at least the protection given to the client secret.

Constraints that shaped the 1Password backend:

- `op` probes stdin at startup and fails with "expected data on stdin but none found"
  when spawned rather than shell-piped, so a document body cannot be piped from Node.
- Passing the token as a command argument is not an option — arguments are readable by
  any local process.
- Hence a `0600` staging file in a `0700` temp directory, passed by path, then
  overwritten and removed in a `finally`. Tests assert the staging file never survives,
  including on failure, and that the token never appears in argv.
- `CommandRunner` intentionally takes no stdin parameter; nothing can use it.

## GUI hosts and PATH

A GUI-launched host (Codex.app, Claude Desktop, Finder) never sources a shell profile, so
its child processes inherit a minimal `PATH` — typically `/usr/bin:/bin:/usr/sbin:/sbin`.
Homebrew's `bin` is absent, which makes `node`, `op`, and `doppler` all invisible. The
symptom is a server that works from a terminal and fails only under the app.

Both layers therefore resolve binaries themselves rather than trusting `PATH`:

- `bin/search-console-mcp` locates `node` via PATH, then Homebrew, MacPorts, `~/.local/bin`,
  Volta and nvm.
- `src/run-command.ts` locates secret CLIs the same way and raises `CommandNotFoundError`,
  which names every directory searched.

Do not "simplify" either back to a bare `PATH` lookup. Fixing the user's shell profile does
not help: the app is not a shell.

## Engineering expectations

- stdout is the MCP transport. Diagnostics go to **stderr only** — a stray `console.log`
  corrupts the protocol stream.
- Tool handlers return `isError` results rather than throwing, so a failed API call does
  not tear down the session.
- Never let a credential, token, raw file body, or secret-CLI stdout reach an error
  message; see the `handling-secrets` skill.
- Add or update tests when behavior changes; prefer table-driven cases.
- Keep changes scoped; avoid unrelated refactors.
- Paths are POSIX-only by design (`bin/search-console-mcp` is a `/bin/sh` script, and
  `config.ts` requires absolute POSIX paths). Windows is not a supported host.
- Update `AGENTS.md` when architecture, commands, or workflows change.

## Shared agent skills

Reusable, agent-agnostic skills live in `.agent/skills/<name>/SKILL.md`.
Read the relevant skill before a task that matches it.

- `creating-a-skill` — how to write a robust, terse skill (read before writing a new skill).
- `handling-secrets` — credential and token safety; read before touching auth or secrets.
- `writing-readable-code` — plain, readable code with why-comments.
- `writing-clean-tests` — behavior-focused `node:test` tests with injected I/O seams.
- `writing-idiomatic-typescript` — this repo's strict compiler settings and Node ESM rules.
- `github-actions` — secure, SHA-pinned workflows for this Node/TypeScript project.
