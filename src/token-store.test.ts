import assert from "node:assert/strict";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TokenStore } from "./token-store.js";

test("writes and loads token files with private permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gsc-token-test-"));
  const path = join(directory, "nested", "token.json");
  const store = new TokenStore(path);
  await store.save({ refresh_token: "test-refresh-token" });

  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await store.load(), { refresh_token: "test-refresh-token" });
});

test("overwrites an existing token file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gsc-token-test-"));
  const path = join(directory, "token.json");
  const store = new TokenStore(path);

  await store.save({ refresh_token: "first-refresh-token" });
  await store.save({ refresh_token: "second-refresh-token" });

  assert.deepEqual(await store.load(), {
    refresh_token: "second-refresh-token",
  });
  assert.deepEqual(await readdir(directory), ["token.json"]);
});

test("reports the authorization action for a missing token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gsc-token-test-"));
  await assert.rejects(
    new TokenStore(join(directory, "missing.json")).load(),
    /Run npm run auth first/,
  );
});
