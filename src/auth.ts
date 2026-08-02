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
 * Return a usable access token, persisting only when the refresh token itself
 * changed.
 *
 * Google issues a fresh access token roughly hourly but rarely rotates the
 * refresh token. Persisting on every access-token refresh therefore meant an
 * hourly write to the store — fine for a file, but a 1Password write needs an
 * approval that a background or scheduled run cannot answer, so the server
 * failed about an hour into its life. The access token is a cache that costs
 * one round trip to rebuild; the refresh token is the actual grant.
 */
export async function accessToken(
  client: OAuth2Client,
  tokenStore?: TokenStore,
): Promise<string> {
  const previousRefreshToken = client.credentials.refresh_token;
  const response = await client.getAccessToken();
  if (!response.token) {
    throw new Error(
      "Google did not return an access token. Re-run OAuth authorization.",
    );
  }

  const refreshToken = client.credentials.refresh_token;
  const rotated =
    Boolean(refreshToken) && refreshToken !== previousRefreshToken;
  if (tokenStore && rotated) {
    try {
      await tokenStore.save(client.credentials);
    } catch (error) {
      // The rotation already happened at Google, so failing the request would
      // not undo it. Warn loudly instead: the stored grant is now stale, and
      // only re-authorising fixes that.
      process.stderr.write(
        `Warning: Google rotated the refresh token but it could not be saved to ${tokenStore.description}. ` +
          `Run npm run auth to store the new grant, or access will fail once the old one is revoked. ` +
          `(${error instanceof Error ? error.message : "unknown error"})\n`,
      );
    }
  }
  return response.token;
}
