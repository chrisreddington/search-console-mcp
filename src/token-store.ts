import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import type { Credentials } from "google-auth-library";
import { expandPath, resolveTokenFile } from "./config.js";
import { parseEnvText } from "./secrets.js";

const PRIVATE_MODE = 0o600;
const REFRESH_TOKEN_KEY = "GSC_REFRESH_TOKEN";

export const TOKEN_PROVIDERS = ["file", "dotenv"] as const;
export type TokenProvider = (typeof TOKEN_PROVIDERS)[number];

/** Persistence for the OAuth token. Implementations must never log the token. */
export interface TokenStore {
  /** Where the token lives, safe to print. Never includes the token itself. */
  readonly description: string;
  load(): Promise<Credentials>;
  save(credentials: Credentials): Promise<void>;
}

/**
 * Stores the token as a private file.
 *
 * The token needs to be written as well as read — Google can rotate the refresh
 * token — so it cannot live anywhere that only serves reads. Protection is
 * filesystem permissions plus whatever full-disk encryption is in force.
 */
export class FileTokenStore implements TokenStore {
  public constructor(private readonly path: string) {}

  public get description(): string {
    return `the file ${this.path} (mode 0600)`;
  }

  public async load(): Promise<Credentials> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new Error(
          `No OAuth token is available at ${this.path}. Run npm run auth first.`,
        );
      }
      throw error;
    }

    await chmod(this.path, PRIVATE_MODE);
    return parseCredentials(raw, this.path);
  }

  public async save(credentials: Credentials): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });

    // A random suffix keeps the exclusive "wx" create from colliding with a
    // temp file that an interrupted earlier run left behind.
    const temporaryPath = `${this.path}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(credentials)}\n`, {
        encoding: "utf8",
        mode: PRIVATE_MODE,
        flag: "wx",
      });
      await rename(temporaryPath, this.path);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    await chmod(this.path, PRIVATE_MODE);
  }
}

/**
 * Reads the refresh token from a dotenv file, so it can sit alongside the client
 * id and secret in the same 1Password Environment rather than on disk.
 *
 * The mount serves reads only, so this store cannot persist a rotated grant.
 * That is an acceptable trade: Google's desktop-client refresh tokens are
 * long-lived and are not rotated on each refresh, so the write path is rare
 * enough to handle by hand when it does happen.
 */
export class DotenvTokenStore implements TokenStore {
  public constructor(private readonly path: string) {}

  public get description(): string {
    return `${REFRESH_TOKEN_KEY} in ${this.path}`;
  }

  public async load(): Promise<Credentials> {
    let contents: string;
    try {
      contents = await readFile(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new Error(
          `No dotenv file exists at ${this.path}. If this is a 1Password Environment mount, it is missing — remount it, and check that 1Password is unlocked.`,
        );
      }
      throw error;
    }

    const refreshToken = parseEnvText(contents).get(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      throw new Error(
        `No ${REFRESH_TOKEN_KEY} in ${this.path}. Run npm run auth, then add the refresh token to that Environment as ${REFRESH_TOKEN_KEY}.`,
      );
    }
    return { refresh_token: refreshToken };
  }

  public async save(_credentials: Credentials): Promise<void> {
    throw new Error("A 1Password Environment mount serves reads only.");
  }
}

/** Build the token store named by GSC_TOKEN_PROVIDER. Defaults to `file`. */
export function createTokenStore(
  environment: NodeJS.ProcessEnv = process.env,
): TokenStore {
  const raw = environment.GSC_TOKEN_PROVIDER?.trim().toLowerCase();
  const provider = raw ? raw : "file";
  if (!isTokenProvider(provider)) {
    throw new Error(
      `Unknown GSC_TOKEN_PROVIDER "${provider}". Valid values: ${TOKEN_PROVIDERS.join(", ")}.`,
    );
  }

  if (provider === "file") {
    return new FileTokenStore(resolveTokenFile(environment));
  }

  // Defaults to the credential mount, since co-locating the token with the
  // client id and secret in one Environment is the point of this backend.
  const configured =
    environment.GSC_TOKEN_DOTENV_PATH ?? environment.GSC_SECRET_DOTENV_PATH;
  if (!configured) {
    throw new Error(
      "GSC_TOKEN_DOTENV_PATH (or GSC_SECRET_DOTENV_PATH) must be set when GSC_TOKEN_PROVIDER is dotenv.",
    );
  }
  return new DotenvTokenStore(
    expandPath(configured, "GSC_TOKEN_DOTENV_PATH", { requireAbsolute: false }),
  );
}

function isTokenProvider(value: string): value is TokenProvider {
  return (TOKEN_PROVIDERS as readonly string[]).includes(value);
}

function parseCredentials(raw: string, source: string): Credentials {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Never echo the payload; it is the token.
    throw new Error(`The OAuth token at ${source} is not valid JSON.`);
  }
  if (!isCredentials(value)) {
    throw new Error(`The OAuth token at ${source} is not a valid token file.`);
  }
  return value;
}

function isCredentials(value: unknown): value is Credentials {
  if (!value || typeof value !== "object") return false;
  const token = value as Record<string, unknown>;
  return (
    typeof token.refresh_token === "string" ||
    typeof token.access_token === "string"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
