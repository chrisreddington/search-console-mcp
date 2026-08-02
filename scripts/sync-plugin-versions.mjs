#!/usr/bin/env node
// Runs from npm's `version` lifecycle, after npm has written the new version
// into package.json/package-lock.json but before it commits. Propagates that
// version into the two plugin manifests, which are JSON and so cannot import
// package.json the way src/server.ts and src/one-password.ts do.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8"));

const manifests = [
  `${root}.claude-plugin/plugin.json`,
  `${root}.codex-plugin/plugin.json`,
];

for (const path of manifests) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.version = pkg.version;
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

execFileSync("npx", ["prettier", "--write", ...manifests], {
  cwd: root,
  stdio: "inherit",
});
execFileSync("git", ["add", ...manifests], { cwd: root, stdio: "inherit" });
