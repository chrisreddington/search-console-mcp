import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import { expandPath } from "./config.js";
import {
  CommandNotFoundError,
  runCommand as defaultCommandRunner,
  type CommandRunner,
} from "./run-command.js";

export type { CommandRunner };

export const SECRET_PROVIDERS = [
  "file",
  "env",
  "dotenv",
  "1password",
  "keychain",
  "doppler",
] as const;

export type SecretProvider = (typeof SECRET_PROVIDERS)[number];

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface SecretResolutionOptions {
  environment?: NodeJS.ProcessEnv;
  runCommand?: CommandRunner;
  readTextFile?: (path: string) => Promise<string>;
}

/** Service name used for OS keychain entries. */
const KEYCHAIN_SERVICE = "search-console-mcp";

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
  const runCommand = options.runCommand ?? defaultCommandRunner;
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
    case "1password":
      credentials = await fromOnePassword(environment, runCommand);
      break;
    case "keychain":
      credentials = await fromKeychain(runCommand);
      break;
    case "doppler":
      credentials = await fromDoppler(runCommand);
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
      throw new Error(`No dotenv file exists at ${path}.`);
    }
    throw new Error(`Cannot read the dotenv file at ${path}.`);
  }

  const values = parseEnvText(contents);
  return {
    clientId: values.get("GSC_CLIENT_ID") ?? "",
    clientSecret: values.get("GSC_CLIENT_SECRET") ?? "",
  };
}

interface OnePasswordItem {
  fields?: Array<{ label?: unknown; value?: unknown }>;
}

async function fromOnePassword(
  environment: NodeJS.ProcessEnv,
  runCommand: CommandRunner,
): Promise<OAuthClientCredentials> {
  const vault = environment.GSC_SECRET_OP_VAULT;
  const item = environment.GSC_SECRET_OP_ITEM;
  if (!vault || !item) {
    throw new Error(
      "GSC_SECRET_OP_VAULT and GSC_SECRET_OP_ITEM must both be set when using the 1password provider.",
    );
  }

  // The runner deliberately discards op's output, which can contain field
  // values, so name the vault and item here instead — neither is secret, and
  // without them a typo is indistinguishable from a locked vault.
  let output: string;
  try {
    output = await runCommand("op", [
      "item",
      "get",
      "--vault",
      vault,
      "--format",
      "json",
      item,
    ]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    // A missing CLI is a different problem from a vault that will not answer;
    // appending item advice to a "not found" error sends people the wrong way.
    if (error instanceof CommandNotFoundError) throw new Error(reason);
    throw new Error(
      `${reason} Check that item "${item}" exists in vault "${vault}", that 1Password is unlocked, and that its CLI integration is enabled (Settings > Developer > Integrate with 1Password CLI). A background or scheduled run cannot answer an approval prompt, so authorise 1Password once interactively first.`,
    );
  }

  let parsed: OnePasswordItem;
  try {
    parsed = JSON.parse(output) as OnePasswordItem;
  } catch {
    throw new Error(`Could not parse the 1Password item "${item}".`);
  }

  const fields = new Map<string, string>();
  for (const field of parsed.fields ?? []) {
    if (typeof field.label === "string" && typeof field.value === "string") {
      fields.set(field.label.trim().toLowerCase(), field.value.trim());
    }
  }

  return {
    clientId: fields.get("client_id") ?? "",
    clientSecret: fields.get("client_secret") ?? "",
  };
}

async function fromKeychain(
  runCommand: CommandRunner,
): Promise<OAuthClientCredentials> {
  return {
    clientId: await keychainValue(runCommand, "GSC_CLIENT_ID"),
    clientSecret: await keychainValue(runCommand, "GSC_CLIENT_SECRET"),
  };
}

async function keychainValue(
  runCommand: CommandRunner,
  key: string,
): Promise<string> {
  const current = platform();
  if (current === "darwin") {
    return runCommand("security", [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      key,
      "-w",
    ]).then((value) => value.trim());
  }
  if (current === "linux") {
    return runCommand("secret-tool", [
      "lookup",
      "service",
      KEYCHAIN_SERVICE,
      "account",
      key,
    ]).then((value) => value.trim());
  }
  throw new Error(
    `The keychain provider supports macOS and Linux only (this host reports "${current}"). Use the 1password, doppler, or file provider instead.`,
  );
}

async function fromDoppler(
  runCommand: CommandRunner,
): Promise<OAuthClientCredentials> {
  const output = await runCommand("doppler", [
    "secrets",
    "download",
    "--no-file",
    "--format",
    "env",
  ]);
  const values = parseEnvText(output);
  return {
    clientId: values.get("GSC_CLIENT_ID") ?? "",
    clientSecret: values.get("GSC_CLIENT_SECRET") ?? "",
  };
}

/** Parse KEY=VALUE lines emitted by dotenv files and `doppler secrets download`. */
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
      return "Set GSC_CLIENT_ID and GSC_CLIENT_SECRET in the dotenv file.";
    case "1password":
      return `Add "client_id" and "client_secret" fields to the 1Password item.`;
    case "keychain":
      return `Store both values under service "${KEYCHAIN_SERVICE}" with accounts GSC_CLIENT_ID and GSC_CLIENT_SECRET.`;
    case "doppler":
      return "Add GSC_CLIENT_ID and GSC_CLIENT_SECRET to the Doppler config.";
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
