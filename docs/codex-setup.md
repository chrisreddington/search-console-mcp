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
npm run build                                    # cache copies dist/, so build first
# bump "version" in .codex-plugin/plugin.json (the cachebuster)
"$CODEX" plugin add search-console-mcp@personal  # re-copies into a new cache dir
```

Keep `version` in step across `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`,
and `package.json`.

## Scheduled tasks

Codex's own rule: **skills define the method, scheduled tasks define the schedule.** The
prompts below stay one line each; all the logic lives in
`skills/content-opportunities/SKILL.md`.

Create these from the **Scheduled** page in the ChatGPT desktop app. Set project to your
content repo and run in your **local environment**, not a worktree — the run needs your
real environment for `op` (1Password) and for ledger writes.

| Task                  | Cadence   | Create it                   | Prompt                                                                                     |
| --------------------- | --------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| Content opportunities | Weekly    | **Inside an existing chat** | `Run the content-opportunities skill in propose mode for sc-domain:chrisreddington.com.`   |
| Outcome measurement   | Monthly   | Standalone                  | `Run the content-opportunities skill in outcome mode.`                                     |
| Method reflection     | Quarterly | Standalone                  | `Run the content-opportunities skill in reflect mode and open a PR with proposed changes.` |

The weekly task must be created **inside a chat** ("schedule a task inside that chat"), so
each run continues the same thread and your replies accumulate as context. A standalone
task starts a new chat every run, which is what you want for the other two.

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
