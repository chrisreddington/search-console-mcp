import { OAuth2Client } from "google-auth-library";
import type { OAuthClientCredentials } from "./secrets.js";
import type { TokenStore } from "./token-store.js";

export const READONLY_SCOPE =
  "https://www.googleapis.com/auth/webmasters.readonly";

/** Build an OAuth client seeded with the stored refresh token. */
export async function createAuthorizedClient(
  credentials: OAuthClientCredentials,
  tokenStore: TokenStore,
): Promise<OAuth2Client> {
  const client = new OAuth2Client(
    credentials.clientId,
    credentials.clientSecret,
  );
  client.setCredentials(await tokenStore.load());
  return client;
}

/**
 * Return a usable access token, persisting the token file when the library
 * silently refreshed it so the refresh does not have to repeat next run.
 */
export async function accessToken(
  client: OAuth2Client,
  tokenStore?: TokenStore,
): Promise<string> {
  const before = JSON.stringify(client.credentials);
  const response = await client.getAccessToken();
  if (!response.token) {
    throw new Error(
      "Google did not return an access token. Re-run OAuth authorization.",
    );
  }
  if (tokenStore && JSON.stringify(client.credentials) !== before) {
    await tokenStore.save(client.credentials);
  }
  return response.token;
}
