import assert from "node:assert/strict";
import { test } from "node:test";
import { storeVariable, type EnvironmentWriter } from "./one-password.js";

/** A writer that records what it was asked to do, with no vault involved. */
function fakeWriter(
  environments: Array<{ environmentId: string; name: string }>,
  existingNames: string[] = [],
) {
  const written: Array<{ environmentId: string; name: string; value: string }> =
    [];
  const writer: EnvironmentWriter = {
    authenticate: async () => "account-1",
    listEnvironments: async () => environments,
    listVariableNames: async () => existingNames,
    appendVariable: async (_accountId, environmentId, name, value) => {
      written.push({ environmentId, name, value });
    },
    close: async () => {},
  };
  return { writer, written };
}

test("writes the variable to the matching environment", async () => {
  const { writer, written } = fakeWriter([
    { environmentId: "env-other", name: "something-else" },
    { environmentId: "env-1", name: "search-console-mcp" },
  ]);

  await storeVariable(
    writer,
    "search-console-mcp",
    "GSC_REFRESH_TOKEN",
    "grant",
  );

  assert.deepEqual(written, [
    { environmentId: "env-1", name: "GSC_REFRESH_TOKEN", value: "grant" },
  ]);
});

test("names the available environments when the target is missing", async () => {
  const { writer } = fakeWriter([
    { environmentId: "env-1", name: "other-project" },
  ]);

  await assert.rejects(
    storeVariable(writer, "search-console-mcp", "GSC_REFRESH_TOKEN", "grant"),
    /No 1Password Environment named "search-console-mcp"\. Available: other-project/,
  );
});

test("refuses to append over an existing variable", async () => {
  // The MCP server can add a variable but not replace one, so a silent
  // duplicate would be worse than a clear refusal.
  const { writer, written } = fakeWriter(
    [{ environmentId: "env-1", name: "search-console-mcp" }],
    ["GSC_CLIENT_ID", "GSC_REFRESH_TOKEN"],
  );

  await assert.rejects(
    storeVariable(writer, "search-console-mcp", "GSC_REFRESH_TOKEN", "grant"),
    /delete GSC_REFRESH_TOKEN in the 1Password app and run this again/,
  );
  assert.deepEqual(written, [], "nothing should be written on refusal");
});

test("never puts the value in the environment lookup path", async () => {
  const { writer, written } = fakeWriter([
    { environmentId: "env-1", name: "search-console-mcp" },
  ]);

  await storeVariable(
    writer,
    "search-console-mcp",
    "GSC_REFRESH_TOKEN",
    "s3cret",
  );

  // The secret reaches exactly one call, and only as a value.
  assert.equal(written.length, 1);
  assert.equal(written[0]?.value, "s3cret");
});
