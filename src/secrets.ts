import { readFile } from "node:fs/promises";
import { expandPath } from "./config.js";

export const SECRET_PROVIDERS = ["file", "env", "dotenv"] as const;

export type SecretProvider = (typeof SECRET_PROVIDERS)[number];

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface SecretResolutionOptions {
  environment?: NodeJS.ProcessEnv;
  readTextFile?: (path: string) => Promise<string>;
}

/**
 * Resolve the Google OAuth Desktop client id and secret from the backend named
 * by GSC_SECRET_PROVIDER. Resolution fails closed: an unknown provider, a
 * backend error, or an empty or placeholder value all abort startup rather than
 * falling back to a less secure source.
 */
export async function resolveClientCredentials(
  options: SecretResolutionOptions = {},
): Promise<OAuthClientCredentials> {
  const environment = options.environment ?? process.env;
  const readTextFile = options.readTextFile ?? defaultTextFileReader;
  const provider = readProvider(environment);

  let credentials: OAuthClientCredentials;
  switch (provider) {
    case "file":
      credentials = await fromClientFile(environment, readTextFile);
      break;
    case "env":
      credentials = fromEnvironment(environment);
      break;
    case "dotenv":
      credentials = await fromDotenv(environment, readTextFile);
      break;
  }

  return validate(provider, credentials);
}

function readProvider(environment: NodeJS.ProcessEnv): SecretProvider {
  const raw = environment.GSC_SECRET_PROVIDER?.trim().toLowerCase();
  if (!raw) return "file";
  if (!isSecretProvider(raw)) {
    throw new Error(
      `Unknown GSC_SECRET_PROVIDER "${raw}". Valid values: ${SECRET_PROVIDERS.join(", ")}.`,
    );
  }
  return raw;
}

function isSecretProvider(value: string): value is SecretProvider {
  return (SECRET_PROVIDERS as readonly string[]).includes(value);
}

interface DesktopClientDocument {
  installed?: { client_id?: unknown; client_secret?: unknown };
  web?: unknown;
}

async function fromClientFile(
  environment: NodeJS.ProcessEnv,
  readTextFile: (path: string) => Promise<string>,
): Promise<OAuthClientCredentials> {
  const configured = environment.GSC_OAUTH_CLIENT_FILE;
  if (!configured) {
    throw new Error(
      "GSC_OAUTH_CLIENT_FILE is required for the file provider. Point it to an OAuth Desktop client JSON file stored outside this repository, or set GSC_SECRET_PROVIDER to another backend.",
    );
  }

  const path = expandPath(configured, "GSC_OAUTH_CLIENT_FILE");
  let document: DesktopClientDocument;
  try {
    document = JSON.parse(await readTextFile(path)) as DesktopClientDocument;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`No OAuth client file exists at ${path}.`);
    }
    // Never surface the parser's echo of file contents; it can include the secret.
    throw new Error(`The OAuth client file at ${path} is not valid JSON.`);
  }

  const installed = document.installed;
  if (!installed) {
    throw new Error(
      document.web
        ? `The OAuth client file at ${path} is a Web client. Create a Desktop app client instead.`
        : `The OAuth client file at ${path} must contain an "installed" Desktop app client.`,
    );
  }

  return {
    clientId: asString(installed.client_id),
    clientSecret: asString(installed.client_secret),
  };
}

function fromEnvironment(
  environment: NodeJS.ProcessEnv,
): OAuthClientCredentials {
  return {
    clientId: environment.GSC_CLIENT_ID ?? "",
    clientSecret: environment.GSC_CLIENT_SECRET ?? "",
  };
}

/**
 * Reads a dotenv file, which is how credentials arrive from a 1Password
 * Environment: the app mounts a `.env` backed by a named pipe, so the values are
 * served on read and never written to disk.
 */
async function fromDotenv(
  environment: NodeJS.ProcessEnv,
  readTextFile: (path: string) => Promise<string>,
): Promise<OAuthClientCredentials> {
  const path = expandPath(
    environment.GSC_SECRET_DOTENV_PATH ?? ".env",
    "GSC_SECRET_DOTENV_PATH",
    { requireAbsolute: false },
  );

  let contents: string;
  try {
    contents = await readTextFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(
        `No dotenv file exists at ${path}. If this is a 1Password Environment mount, it is missing — remount it, and check that 1Password is unlocked.`,
      );
    }
    throw new Error(`Cannot read the dotenv file at ${path}.`);
  }

  const values = parseEnvText(contents);
  return {
    clientId: values.get("GSC_CLIENT_ID") ?? "",
    clientSecret: values.get("GSC_CLIENT_SECRET") ?? "",
  };
}

/** Parse KEY=VALUE lines from a dotenv file. */
export function parseEnvText(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed
      .slice(0, separator)
      .replace(/^export\s+/, "")
      .trim();
    values.set(key, unquote(trimmed.slice(separator + 1).trim()));
  }
  return values;
}

function unquote(value: string): string {
  const quoted =
    value.length >= 2 &&
    (value.startsWith('"') || value.startsWith("'")) &&
    value.at(-1) === value[0];
  return quoted ? value.slice(1, -1) : value;
}

/**
 * Reject empty and obviously templated values so a misconfigured provider fails
 * at startup instead of during the first Google API call.
 */
function validate(
  provider: SecretProvider,
  credentials: OAuthClientCredentials,
): OAuthClientCredentials {
  const problems: string[] = [];
  if (isPlaceholder(credentials.clientId)) {
    problems.push("the OAuth client id is empty or a placeholder");
  }
  if (isPlaceholder(credentials.clientSecret)) {
    problems.push("the OAuth client secret is empty or a placeholder");
  }
  if (problems.length > 0) {
    throw new Error(
      `Secret provider "${provider}" returned invalid credentials: ${problems.join("; ")}. ${remedy(provider)}`,
    );
  }
  return credentials;
}

const PLACEHOLDER_MARKERS = [
  "your-",
  "your_",
  "<your",
  "changeme",
  "placeholder",
  "example",
  "todo",
];

function isPlaceholder(value: string): boolean {
  if (!value.trim()) return true;
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

function remedy(provider: SecretProvider): string {
  switch (provider) {
    case "file":
      return "Check that GSC_OAUTH_CLIENT_FILE points at a real Desktop client download from Google Cloud console.";
    case "env":
      return "Set GSC_CLIENT_ID and GSC_CLIENT_SECRET.";
    case "dotenv":
      return "Set GSC_CLIENT_ID and GSC_CLIENT_SECRET in the dotenv file. For a 1Password Environment, check both variables have values.";
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function defaultTextFileReader(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
