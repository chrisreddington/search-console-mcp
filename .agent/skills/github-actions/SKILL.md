---
name: github-actions
description: Write or fix GitHub Actions workflows for this Node/TypeScript project. Use when creating or modifying .github/workflows/ files, pinning actions to SHAs, setting job permissions, choosing a Node version, or preventing script injection.
---

# GitHub Actions workflow development (Node/TypeScript)

Produce secure, minimal workflows that build, check, and test this project.

## Rules

### Permissions

- Set `permissions: contents: read` at the workflow level.
- Grant elevated permissions per-job only (e.g. `security-events: write` on the CodeQL job, `contents: write` on a release job) — never at the workflow level.

### SHA pinning

- Pin every third-party action to its full 40-character commit SHA with a version comment:
  `uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`
- Look up the current SHA for every action before writing or updating the workflow — never copy an existing SHA without verifying it.
- To resolve: `gh api repos/<owner>/<repo>/git/refs/tags/<tag>` and dereference the tag object one level when `object.type == "tag"`.

### Checkout

- Set `persist-credentials: false` on `actions/checkout` unless a later step must push.

### Node version

- Use `node-version-file: .node-version` in `actions/setup-node`; never hardcode a version string in the workflow.
- Keep `.node-version` and the `engines.node` range in `package.json` consistent.
- Install with `npm ci`, never `npm install`, and enable `cache: npm`.

### Script injection prevention

- Pass GitHub context values through `env:`, not inline `${{ }}` interpolation inside a `run:` script:
  ```yaml
  env:
    REF_NAME: ${{ github.ref_name }}
  run: |
    npm version --no-git-tag-version "$REF_NAME"
  ```

### Secrets

- Never add repository secrets for Google OAuth credentials; CI runs only offline checks and tests with injected fakes.
- If a workflow ever needs a token, scope it to the single job that uses it and pass it via `env:`.

## Checklist

- Every `uses:` line has a full 40-char SHA and a `# vX.Y.Z` comment, verified this session.
- `permissions: contents: read` is at the top of each workflow; elevated scopes are job-level only.
- `actions/checkout` sets `persist-credentials: false` (unless the job pushes).
- `actions/setup-node` uses `node-version-file: .node-version` with `cache: npm`; install step is `npm ci`.
- No `${{ github.* }}` or `${{ env.* }}` appears inside a `run:` block without an intermediary env var.
- The workflow runs the same commands `AGENTS.md` documents locally, so a green local gate means a green CI.
