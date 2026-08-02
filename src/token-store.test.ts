import assert from "node:assert/strict";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createTokenStore, FileTokenStore } from "./token-store.js";

const CREDENTIALS = { refresh_token: "test-refresh-token" };

async function temporaryPath(name = "token.json"): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "gsc-token-test-")), name);
}

test("writes and loads token files with private permissions", async () => {
  const path = await temporaryPath(join("nested", "token.json"));
  const store = new FileTokenStore(path);
  await store.save(CREDENTIALS);

  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await store.load(), CREDENTIALS);
});

test("overwrites an existing token file", async () => {
  const path = await temporaryPath();
  const store = new FileTokenStore(path);

  await store.save({ refresh_token: "first-refresh-token" });
  await store.save({ refresh_token: "second-refresh-token" });

  assert.deepEqual(await store.load(), {
    refresh_token: "second-refresh-token",
  });
  assert.deepEqual(await readdir(dirname(path)), ["token.json"]);
});

test("reports the authorization action for a missing token file", async () => {
  await assert.rejects(
    new FileTokenStore(await temporaryPath("missing.json")).load(),
    /Run npm run auth first/,
  );
});

test("createTokenStore resolves the configured token file", () => {
  const store = createTokenStore({ GSC_TOKEN_FILE: "/tmp/gsc/token.json" });
  assert.ok(store instanceof FileTokenStore);
  assert.match(store.description, /\/tmp\/gsc\/token\.json/);
});
