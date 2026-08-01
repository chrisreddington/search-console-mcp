import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  createTokenStore,
  FileTokenStore,
  OnePasswordTokenStore,
} from "./token-store.js";

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

/**
 * Records op invocations. Because the token is handed to op through a staging
 * file, the runner reads that file at call time so tests can assert on the body
 * op would have seen and on the file being cleaned up afterwards.
 */
function recordingRunner(responses: Record<string, string | Error>) {
  const calls: Array<{ args: readonly string[]; body?: string }> = [];
  const run = async (
    _command: string,
    args: readonly string[],
  ): Promise<string> => {
    const staged = args.find((argument) => argument.endsWith(".json"));
    let body: string | undefined;
    if (staged) {
      body = await readFile(staged, "utf8").catch(() => undefined);
    }
    calls.push(body === undefined ? { args } : { args, body });
    const response = responses[`${args[0]} ${args[1]}`];
    if (response instanceof Error) throw response;
    return response ?? "";
  };
  return { calls, run };
}

test("reads the token from a 1Password document", async () => {
  const { calls, run } = recordingRunner({
    "document get": JSON.stringify(CREDENTIALS),
  });
  const store = new OnePasswordTokenStore("Private", "SC Token", run);

  assert.deepEqual(await store.load(), CREDENTIALS);
  assert.deepEqual(calls[0]?.args, [
    "document",
    "get",
    "SC Token",
    "--vault",
    "Private",
  ]);
});

test("creates the document on first save", async () => {
  const { calls, run } = recordingRunner({
    "item get": new Error("not found"),
    "document create": "",
  });
  await new OnePasswordTokenStore("Private", "SC Token", run).save(CREDENTIALS);

  const create = calls.find((call) => call.args[1] === "create");
  assert.ok(create, "expected a document create call");
  assert.deepEqual(JSON.parse(create.body ?? ""), CREDENTIALS);
});

test("edits the document when it already exists", async () => {
  const { calls, run } = recordingRunner({
    "item get": "{}",
    "document edit": "",
  });
  await new OnePasswordTokenStore("Private", "SC Token", run).save(CREDENTIALS);

  const edit = calls.find((call) => call.args[1] === "edit");
  assert.ok(edit, "expected a document edit call");
  assert.deepEqual(JSON.parse(edit.body ?? ""), CREDENTIALS);
});

test("removes the staging file after a successful save", async () => {
  const { calls, run } = recordingRunner({
    "item get": new Error("not found"),
    "document create": "",
  });
  await new OnePasswordTokenStore("Private", "SC Token", run).save(CREDENTIALS);

  const staged = calls
    .find((call) => call.args[1] === "create")
    ?.args.find((argument) => argument.endsWith(".json"));
  assert.ok(staged, "expected a staging file path");
  assert.equal(existsSync(staged), false, "staging file must not survive");
});

test("removes the staging file even when op fails", async () => {
  const { calls, run } = recordingRunner({
    "item get": new Error("not found"),
    "document create": new Error("vault locked"),
  });
  await assert.rejects(
    new OnePasswordTokenStore("Private", "SC Token", run).save(CREDENTIALS),
  );

  const staged = calls
    .find((call) => call.args[1] === "create")
    ?.args.find((argument) => argument.endsWith(".json"));
  assert.ok(staged, "expected a staging file path");
  assert.equal(existsSync(staged), false, "staging file must not survive");
});

test("stages the token with owner-only permissions", async () => {
  let mode: number | undefined;
  const run = async (_c: string, args: readonly string[]): Promise<string> => {
    const staged = args.find((argument) => argument.endsWith(".json"));
    if (staged && args[1] !== "get") mode = (await stat(staged)).mode & 0o777;
    if (args[0] === "item") throw new Error("not found");
    return "";
  };
  await new OnePasswordTokenStore("Private", "SC Token", run).save(CREDENTIALS);
  assert.equal(mode, 0o600);
});

test("never puts the token in op command arguments", async () => {
  const { calls, run } = recordingRunner({
    "item get": new Error("not found"),
    "document create": "",
  });
  await new OnePasswordTokenStore("Private", "SC Token", run).save(CREDENTIALS);

  // Arguments are readable by any local process, so the token must only ever
  // reach op through the staging file's contents.
  for (const call of calls) {
    for (const argument of call.args) {
      assert.doesNotMatch(
        argument,
        /test-refresh-token/,
        `token leaked into argument: ${argument}`,
      );
    }
  }
});

test("names the document and vault when 1Password cannot be read", async () => {
  const { run } = recordingRunner({ "document get": new Error("locked") });
  await assert.rejects(
    new OnePasswordTokenStore("Private", "SC Token", run).load(),
    /document "SC Token" is readable in vault "Private"/,
  );
});

test("createTokenStore defaults to the file backend", () => {
  const store = createTokenStore({ GSC_TOKEN_FILE: "/tmp/gsc/token.json" });
  assert.ok(store instanceof FileTokenStore);
  assert.match(store.description, /\/tmp\/gsc\/token\.json/);
});

test("createTokenStore falls back to the credential vault", () => {
  const store = createTokenStore({
    GSC_TOKEN_PROVIDER: "1password",
    GSC_SECRET_OP_VAULT: "Private",
  });
  assert.ok(store instanceof OnePasswordTokenStore);
  assert.match(store.description, /"Search Console Token" in vault "Private"/);
});

test("createTokenStore rejects an unknown token provider", () => {
  assert.throws(
    () => createTokenStore({ GSC_TOKEN_PROVIDER: "vault" }),
    /Unknown GSC_TOKEN_PROVIDER "vault"/,
  );
});

test("createTokenStore requires a vault for the 1password backend", () => {
  assert.throws(
    () => createTokenStore({ GSC_TOKEN_PROVIDER: "1password" }),
    /GSC_TOKEN_OP_VAULT \(or GSC_SECRET_OP_VAULT\) must be set/,
  );
});
