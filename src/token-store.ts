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
import { resolveTokenFile } from "./config.js";

const PRIVATE_MODE = 0o600;

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

/** Build the token store for the configured token location. */
export function createTokenStore(
  environment: NodeJS.ProcessEnv = process.env,
): TokenStore {
  return new FileTokenStore(resolveTokenFile(environment));
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
