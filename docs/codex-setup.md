# Codex setup

How this plugin is installed in Codex, and how the weekly content loop is scheduled.

## Install

Codex discovers a "personal" marketplace at `~/.agents/plugins/marketplace.json`
implicitly — it does not need `codex plugin marketplace add`.

```json
{
  "name": "personal",
  "interface": { "displayName": "Personal" },
  "plugins": [
    {
      "name": "search-console-mcp",
      "source": { "source": "local", "path": "./plugins/search-console-mcp" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_USE" },
      "category": "Developer Tools"
    }
  ]
}
```

`source.path` **must be `./`-relative** to the marketplace file's directory (`~`). An
absolute path is silently ignored: the marketplace still loads, but the plugin never
appears in `codex plugin list` — with no error explaining why.

Because the path must be relative to `~`, a checkout living elsewhere is linked in:

```sh
mkdir -p ~/plugins
ln -sfn /path/to/search-console-mcp ~/plugins/search-console-mcp
```

The `codex` binary is not on `PATH` when the desktop app is installed. It ships inside the
app bundle:

```sh
CODEX=/Applications/ChatGPT.app/Contents/Resources/codex
"$CODEX" plugin list                       # personal marketplace should appear
"$CODEX" plugin add search-console-mcp@personal
```

Then start a **new thread** — Codex only picks up new skills and tools on a new thread.

## Updating after a change

`codex plugin add` copies the plugin into a **version-keyed cache**:

```
~/.codex/plugins/cache/personal/search-console-mcp/<version>/
```

That copy is a snapshot, including `dist/` and `node_modules/`. Editing the checkout does
not change what Codex runs. To ship a change:

```sh
npm version patch                                # bumps package.json and both manifests together
npm run build                                    # cache copies dist/, so build first
"$CODEX" plugin add search-console-mcp@personal  # re-copies into a new cache dir
# then fully quit and relaunch the Codex desktop app — see below
```

`npm version <patch|minor|major>` is the cachebuster. It updates `package.json` and
`package-lock.json`, then `scripts/sync-plugin-versions.mjs` (wired to npm's `version`
lifecycle) copies the new version into `.codex-plugin/plugin.json` and
`.claude-plugin/plugin.json` and stages them, so a single command keeps every manifest, the
`McpServer` identity in `src/server.ts`, and the 1Password client identity in
`src/one-password.ts` in step — the latter two import `PACKAGE_VERSION` rather than
hardcoding it. Do not hand-edit `version` in either plugin manifest.

A real release bump is the right cachebuster **here** because this plugin is also a versioned
npm project. Codex's own `plugin-creator` guidance instead prescribes a build-metadata suffix
(`<base-version>+codex.<timestamp>`, applied by its `update_plugin_cachebuster.py`) and says
not to increment numeric version components merely to force a reinstall. Both produce a new
version-keyed cache directory; prefer the suffix for throwaway local iteration, and a genuine
`npm version` bump for anything you intend to ship.

### Restarting the desktop app is part of the update

A new thread is **not** enough. The desktop app resolves the plugin catalogue once at launch
and holds it in memory, so after `codex plugin add` a still-running app keeps serving the
previous version — pointing skills at a cache directory the reinstall has already deleted,
and attaching whatever MCP config that stale version declared. The symptom is a fresh thread
whose skills load but whose `gsc_*` tools are missing, with the skill paths naming an old
version. Fully quit and relaunch the app, then start a new thread.

Confirm what the running app actually resolved, rather than assuming:

```sh
"$CODEX" plugin list | grep search-console   # installed version and source path
"$CODEX" mcp list | grep search-console      # exactly one entry, cwd in the current cache dir
```

## Scheduled tasks

Codex's own rule: **skills define the method, scheduled tasks define the schedule.** The
prompts below stay one line each; all the logic lives in
`skills/content-opportunities/SKILL.md`.

Create these from the **Scheduled** page in the ChatGPT desktop app. Set project to your
content repo and run in your **local environment**, not a worktree — the run needs your
real environment for `op` (1Password) and for ledger writes.

Before scheduling anything, publish the OAuth client to production (see
[Authorising](../README.md#authorising) in the README) — a client left in Testing status has
its refresh token revoked after 7 days, which silently breaks the weekly task mid-cycle with
no error visible until the next scheduled run fails.

| Task              | Cadence   | Create it                   | Prompt                                                                                     |
| ----------------- | --------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| Content loop      | Weekly    | **Inside an existing chat** | `Run the content-opportunities skill in propose mode for sc-domain:chrisreddington.com.`   |
| Method reflection | Quarterly | Standalone                  | `Run the content-opportunities skill in reflect mode and open a PR with proposed changes.` |

The weekly task must be created **inside a chat** ("schedule a task inside that chat"), so
each run continues the same thread and your replies accumulate as context. It scans for due
outcomes before proposing new work. An accepted, shipped proposal becomes due after eight
weeks and remains due until measured, so skipped or failed runs cannot lose it. `outcome`
mode remains available for manual backfills; it does not need a separate schedule.

A standalone task starts a new chat every run, which is what you want for method reflection.

Before scheduling anything, run the prompt manually in a normal chat until the output is
reliable. That is the documented workflow, and it avoids scheduling a prompt that misfires
weekly.

## How learning actually works

Two tiers, deliberately:

- **Preferences → Codex memories.** Already enabled (`[features] memories = true`).
  `~/.codex/memories/` is a git repo that Codex consolidates in the background. Your
  in-chat corrections ("stop proposing Azure", "I care about agent tooling") land here
  without any extra machinery.
- **Facts → the ledger** in the content repo's `.agents/content-loop/`. Proposal IDs, URLs,
  ship dates and metrics must stay exact for outcome measurement, and memory consolidation
  rewords things. JSONL in git gives exactness, diffs and history.

One landmine: `memories.disable_on_external_context`. If set to `true`, threads that use
MCP tool calls are excluded from memory generation — which is every run of this loop. It is
currently unset (defaults to `false`), so learning is active. Do not enable it without
knowing this loop depends on it.
