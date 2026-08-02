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

`GSC_SECRET_PROVIDER` chooses where the OAuth client id and secret come from:

| Value            | How it resolves them                                         |
| ---------------- | ------------------------------------------------------------ |
| `file` (default) | The `installed` block of the JSON at `GSC_OAUTH_CLIENT_FILE` |
| `env`            | `GSC_CLIENT_ID` and `GSC_CLIENT_SECRET` directly             |
| `dotenv`         | Parses the file at `GSC_SECRET_DOTENV_PATH`                  |

Resolution fails closed: an unknown provider, a missing file, or an empty or placeholder
value aborts startup. There is no silent fallback to a weaker provider.

**The server runs no external CLI.** Credentials arrive by reading a path or an environment
variable, nothing more. Keep it that way: a GUI-launched host gives its children a minimal
environment, and any dependency on a CLI being present, on `PATH`, or on a per-process
authorisation is a failure that only appears once the server is launched by the app rather
than from a terminal.

1Password is supported through this route: create an Environment, have the app mount a
local `.env` for it, and point `GSC_SECRET_DOTENV_PATH` at the mount. The mount is backed
by a named pipe, so nothing is written to disk, and authorisation lasts until 1Password
locks rather than being requested per process.

## Token storage

The token goes to `GSC_TOKEN_FILE` via `FileTokenStore`: atomic write, mode `0600`, inside
a `0700` directory.

It is a file rather than a vault entry because it must be **written** as well as read —
Google can rotate the refresh token, and a read-only store cannot accept the replacement.

`accessToken()` persists **only when the refresh token rotates**, never on an access-token
refresh. Google issues a new access token roughly hourly; saving then produced a write on
every session. The access token is a cache worth one round trip; the refresh token is the
grant. Do not "fix" this back to saving on every change.

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
