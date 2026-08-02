import assert from "node:assert/strict";
import { test } from "node:test";
import type { OAuth2Client, Credentials } from "google-auth-library";
import { accessToken } from "./auth.js";
import type { TokenStore } from "./token-store.js";

/** A store that records saves so tests can assert on write frequency. */
function recordingStore(onSave?: () => never) {
  const saved: Credentials[] = [];
  const store: TokenStore = {
    description: "a test store",
    load: async () => ({}),
    save: async (credentials) => {
      onSave?.();
      saved.push(credentials);
    },
  };
  return { saved, store };
}

/** A client whose getAccessToken mutates credentials the way the library does. */
function fakeClient(
  initial: Credentials,
  mutate: (credentials: Credentials) => void,
): OAuth2Client {
  const credentials = { ...initial };
  return {
    credentials,
    getAccessToken: async () => {
      mutate(credentials);
      return { token: credentials.access_token ?? "token" };
    },
  } as unknown as OAuth2Client;
}

test("does not write when only the access token was refreshed", async () => {
  const { saved, store } = recordingStore();
  // This is the hourly case: a new access token, same grant.
  const client = fakeClient(
    { refresh_token: "grant-1", access_token: "old", expiry_date: 1 },
    (c) => {
      c.access_token = "new";
      c.expiry_date = 2;
    },
  );

  assert.equal(await accessToken(client, store), "new");
  assert.deepEqual(saved, [], "an access-token refresh must not write");
});

test("writes when the refresh token rotates", async () => {
  const { saved, store } = recordingStore();
  const client = fakeClient(
    { refresh_token: "grant-1", access_token: "old" },
    (c) => {
      c.refresh_token = "grant-2";
      c.access_token = "new";
    },
  );

  await accessToken(client, store);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.refresh_token, "grant-2");
});

test("still returns a token when persisting a rotated grant fails", async () => {
  const { store } = recordingStore(() => {
    throw new Error("vault locked");
  });
  const client = fakeClient({ refresh_token: "grant-1" }, (c) => {
    c.refresh_token = "grant-2";
    c.access_token = "new";
  });

  // The rotation already happened at Google, so failing here would help nobody.
  assert.equal(await accessToken(client, store), "new");
});

test("rejects when Google returns no access token", async () => {
  const { store } = recordingStore();
  const client = {
    credentials: { refresh_token: "grant-1" },
    getAccessToken: async () => ({ token: null }),
  } as unknown as OAuth2Client;

  await assert.rejects(
    accessToken(client, store),
    /Re-run OAuth authorization/,
  );
});
