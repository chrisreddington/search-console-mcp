import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CommandNotFoundError,
  resolveExecutable,
  runCommand,
} from "./run-command.js";

/** Write an executable stub and return its directory and path. */
async function stubExecutable(
  name: string,
  script: string,
): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "gsc-bin-"));
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\n${script}\n`, { encoding: "utf8" });
  await chmod(path, 0o755);
  return { directory, path };
}

test("resolves an executable found on PATH", async () => {
  const { directory, path } = await stubExecutable("gsc-stub", "echo hi");
  const previous = process.env.PATH;
  process.env.PATH = directory;
  try {
    assert.equal(resolveExecutable("gsc-stub"), path);
  } finally {
    process.env.PATH = previous;
  }
});

test("returns undefined when the command is nowhere to be found", () => {
  assert.equal(resolveExecutable("gsc-definitely-not-installed"), undefined);
});

test("passes an explicit path through untouched", () => {
  assert.equal(resolveExecutable("/opt/custom/op"), "/opt/custom/op");
});

test("reports a missing CLI as CommandNotFoundError, naming where it looked", async () => {
  await assert.rejects(
    runCommand("gsc-definitely-not-installed", []),
    (error: Error) => {
      assert.ok(error instanceof CommandNotFoundError);
      assert.match(error.message, /was not found/);
      // The advice only helps if it names the directories actually searched.
      assert.match(error.message, /\/opt\/homebrew\/bin/);
      assert.match(error.message, /minimal PATH/);
      return true;
    },
  );
});

test("returns stdout when the command succeeds", async () => {
  const { directory } = await stubExecutable("gsc-ok", 'printf "output\\n"');
  const previous = process.env.PATH;
  process.env.PATH = directory;
  try {
    assert.equal(await runCommand("gsc-ok", []), "output\n");
  } finally {
    process.env.PATH = previous;
  }
});

test("reports the exit status without echoing stderr", async () => {
  const { directory } = await stubExecutable(
    "gsc-fail",
    'echo "secret-value-from-cli" >&2\nexit 3',
  );
  const previous = process.env.PATH;
  process.env.PATH = directory;
  try {
    await assert.rejects(runCommand("gsc-fail", []), (error: Error) => {
      assert.match(error.message, /exited with status 3/);
      // stderr can carry field values, so it must never reach the message.
      assert.doesNotMatch(error.message, /secret-value-from-cli/);
      return true;
    });
  } finally {
    process.env.PATH = previous;
  }
});
