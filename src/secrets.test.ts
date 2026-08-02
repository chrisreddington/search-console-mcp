import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseEnvText,
  resolveClientCredentials,
  type SecretResolutionOptions,
} from "./secrets.js";

const CLIENT_ID = "1234567890-abcdef.apps.googleusercontent.com";
const CLIENT_SECRET = "GOCSPX-aaaabbbbccccdddd";

function clientFileJson(id = CLIENT_ID, secret = CLIENT_SECRET): string {
  return JSON.stringify({
    installed: { client_id: id, client_secret: secret },
  });
}

function missingFile(): never {
  const error: NodeJS.ErrnoException = new Error("not found");
  error.code = "ENOENT";
  throw error;
}

interface ProviderCase {
  name: string;
  options: SecretResolutionOptions;
}

const successCases: ProviderCase[] = [
  {
    name: "file provider reads an installed Desktop client",
    options: {
      environment: { GSC_OAUTH_CLIENT_FILE: "/secrets/oauth.json" },
      readTextFile: async () => clientFileJson(),
    },
  },
  {
    name: "env provider reads GSC_CLIENT_ID and GSC_CLIENT_SECRET",
    options: {
      environment: {
        GSC_SECRET_PROVIDER: "env",
        GSC_CLIENT_ID: CLIENT_ID,
        GSC_CLIENT_SECRET: CLIENT_SECRET,
      },
    },
  },
  {
    name: "dotenv provider parses a dotenv file",
    options: {
      environment: {
        GSC_SECRET_PROVIDER: "dotenv",
        GSC_SECRET_DOTENV_PATH: "/secrets/.env",
      },
      readTextFile: async () =>
        `# Google\nGSC_CLIENT_ID="${CLIENT_ID}"\nGSC_CLIENT_SECRET='${CLIENT_SECRET}'\n`,
    },
  },
];

for (const testCase of successCases) {
  test(testCase.name, async () => {
    assert.deepEqual(await resolveClientCredentials(testCase.options), {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });
  });
}

interface FailureCase {
  name: string;
  options: SecretResolutionOptions;
  expected: RegExp;
}

const failureCases: FailureCase[] = [
  {
    name: "rejects an unknown provider name",
    options: { environment: { GSC_SECRET_PROVIDER: "vault" } },
    expected: /Unknown GSC_SECRET_PROVIDER "vault"/,
  },
  {
    name: "requires a client file path for the file provider",
    options: { environment: {} },
    expected: /GSC_OAUTH_CLIENT_FILE is required/,
  },
  {
    name: "reports a missing client file by path",
    options: {
      environment: { GSC_OAUTH_CLIENT_FILE: "/secrets/oauth.json" },
      readTextFile: async () => missingFile(),
    },
    expected: /No OAuth client file exists at \/secrets\/oauth.json/,
  },
  {
    name: "rejects a Web client file",
    options: {
      environment: { GSC_OAUTH_CLIENT_FILE: "/secrets/oauth.json" },
      readTextFile: async () => JSON.stringify({ web: { client_id: "x" } }),
    },
    expected: /is a Web client/,
  },
  {
    name: "rejects a placeholder client id",
    options: {
      environment: {
        GSC_SECRET_PROVIDER: "env",
        GSC_CLIENT_ID: "your-client-id",
        GSC_CLIENT_SECRET: CLIENT_SECRET,
      },
    },
    expected: /client id is empty or a placeholder/,
  },
  {
    name: "rejects a missing client secret",
    options: {
      environment: {
        GSC_SECRET_PROVIDER: "env",
        GSC_CLIENT_ID: CLIENT_ID,
      },
    },
    expected: /client secret is empty or a placeholder/,
  },
  {
    // The common real failure: 1Password is locked, so the mount is not there.
    name: "points at the mount when the dotenv file is absent",
    options: {
      environment: {
        GSC_SECRET_PROVIDER: "dotenv",
        GSC_SECRET_DOTENV_PATH: "/mnt/gsc/.env",
      },
      readTextFile: async () => missingFile(),
    },
    expected: /1Password Environment mount, it is missing/,
  },
];

for (const testCase of failureCases) {
  test(testCase.name, async () => {
    await assert.rejects(
      resolveClientCredentials(testCase.options),
      testCase.expected,
    );
  });
}

test("never echoes file contents when the client file is malformed", async () => {
  await assert.rejects(
    resolveClientCredentials({
      environment: { GSC_OAUTH_CLIENT_FILE: "/secrets/oauth.json" },
      readTextFile: async () => `{"installed": {"client_secret": "leaked`,
    }),
    (error: Error) => {
      assert.match(error.message, /is not valid JSON/);
      assert.doesNotMatch(error.message, /leaked/);
      return true;
    },
  );
});

test("parses env text with comments, export prefixes, and quotes", () => {
  const values = parseEnvText(
    ["# comment", "export GSC_CLIENT_ID='abc'", 'OTHER="d=e"', "BARE=f"].join(
      "\n",
    ),
  );
  assert.equal(values.get("GSC_CLIENT_ID"), "abc");
  assert.equal(values.get("OTHER"), "d=e");
  assert.equal(values.get("BARE"), "f");
});
