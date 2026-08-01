import assert from "node:assert/strict";
import { test } from "node:test";
import { homedir } from "node:os";
import { expandPath, resolveTokenFile } from "./config.js";

test("expands a leading tilde in the token file path", () => {
  assert.equal(
    resolveTokenFile({ GSC_TOKEN_FILE: "~/.config/gsc/token.json" }),
    `${homedir()}/.config/gsc/token.json`,
  );
});

test("defaults the token file to the user config directory", () => {
  assert.equal(
    resolveTokenFile({}),
    `${homedir()}/.config/search-console-mcp/token.json`,
  );
});

test("rejects a relative token file path", () => {
  assert.throws(
    () => resolveTokenFile({ GSC_TOKEN_FILE: "token.json" }),
    /GSC_TOKEN_FILE must be an absolute path/,
  );
});

test("allows a relative path when absoluteness is not required", () => {
  assert.equal(
    expandPath(".env", "GSC_SECRET_DOTENV_PATH", { requireAbsolute: false }),
    ".env",
  );
});
