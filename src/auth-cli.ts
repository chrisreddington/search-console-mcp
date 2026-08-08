import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { platform } from "node:os";
import { spawn } from "node:child_process";
import { OAuth2Client } from "google-auth-library";
import { READONLY_SCOPE } from "./auth.js";
import { resolveTokenFile } from "./config.js";
import { connectToOnePassword, storeVariable } from "./one-password.js";
import { resolveClientCredentials } from "./secrets.js";
import { FileTokenStore } from "./token-store.js";

const CALLBACK_PATH = "/oauth2/callback";
const REFRESH_TOKEN_VARIABLE = "GSC_REFRESH_TOKEN";
const AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1_000;

async function authorize(): Promise<void> {
  // With an Environment configured the grant goes straight there and never
  // touches disk. Without one it falls back to a private file.
  const environmentName = process.env.GSC_TOKEN_OP_ENVIRONMENT?.trim();
  const tokenFile = resolveTokenFile();
  const tokenStore = new FileTokenStore(tokenFile);
  const credentials = await resolveClientCredentials();
  const state = randomBytes(24).toString("hex");
  const callback = await createCallback(state);
  const client = new OAuth2Client(
    credentials.clientId,
    credentials.clientSecret,
    callback.redirectUri,
  );
  const authorizationUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [READONLY_SCOPE],
    state,
  });

  openBrowser(authorizationUrl);
  // Printed so authorization still works over SSH or when no browser opens.
  process.stderr.write(
    `Complete read-only Google authorization in your browser. If it did not open, visit:\n${authorizationUrl}\n`,
  );

  const code = await callback.code;
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke the app grant and run authorization again.",
    );
  }

  if (environmentName) {
    // Straight into the Environment over stdio, so the grant never lands on
    // disk. The value goes from this process to 1Password; no agent sees it.
    const writer = await connectToOnePassword();
    try {
      await storeVariable(
        writer,
        environmentName,
        REFRESH_TOKEN_VARIABLE,
        tokens.refresh_token,
      );
    } finally {
      await writer.close();
    }
    process.stderr.write(
      `Authorization succeeded. ${REFRESH_TOKEN_VARIABLE} written to the "${environmentName}" Environment; it will appear in the mounted .env.\n`,
    );
    return;
  }

  await tokenStore.save(tokens);
  process.stderr.write(
    `Authorization succeeded. Token written to ${tokenFile}.\n`,
  );
}

interface Callback {
  redirectUri: string;
  code: Promise<string>;
}

async function createCallback(state: string): Promise<Callback> {
  let resolveCode: (code: string) => void = () => {};
  let rejectCode: (error: Error) => void = () => {};
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    // Browsers request extras such as /favicon.ico against the same origin.
    // Answering only the callback path keeps those from aborting authorization.
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }

    try {
      const returnedState = url.searchParams.get("state");
      const authorizationCode = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error");
      if (returnedState !== state)
        throw new Error("OAuth state validation failed.");
      if (oauthError)
        throw new Error(`Google authorization failed: ${oauthError}`);
      if (!authorizationCode)
        throw new Error("Google did not return an authorization code.");

      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(
        "Authorization complete. You can close this browser window.",
      );
      resolveCode(authorizationCode);
    } catch (error) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Authorization failed. Return to the terminal for details.");
      rejectCode(
        error instanceof Error ? error : new Error("Authorization failed."),
      );
    } finally {
      server.close();
    }
  });

  const port = await listenOnLoopback(server);
  const timeout = setTimeout(() => {
    server.close();
    rejectCode(new Error("Authorization timed out after five minutes."));
  }, AUTHORIZATION_TIMEOUT_MS);
  timeout.unref();

  // The rejection is reported by whoever awaits `code`; this derived chain only
  // clears the timer, so its own rejection must be swallowed to avoid an
  // unhandled rejection crashing the CLI.
  void code.finally(() => clearTimeout(timeout)).catch(() => {});

  return { redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`, code };
}

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not create the local OAuth callback listener.");
  }
  return address.port;
}

// Windows is not a supported host (see AGENTS.md); a cmd.exe /c start
// invocation would also misparse the URL's own "&"-separated query params
// as command separators, so there is no safe win32 case to add here.
function browserCommand(url: string): { executable: string; args: string[] } {
  return platform() === "darwin"
    ? { executable: "open", args: [url] }
    : { executable: "xdg-open", args: [url] };
}

function openBrowser(url: string): void {
  const { executable, args } = browserCommand(url);
  const child = spawn(executable, args, { detached: true, stdio: "ignore" });
  // A missing opener is not fatal: the URL is printed for manual use.
  child.on("error", () => {});
  child.unref();
}

authorize().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Authorization failed."}\n`,
  );
  process.exitCode = 1;
});
