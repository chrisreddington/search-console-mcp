import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Credentials } from "google-auth-library";
import { resolveTokenFile } from "./config.js";
import { runCommand, type CommandRunner } from "./run-command.js";

const PRIVATE_MODE = 0o600;
const DEFAULT_OP_TOKEN_ITEM = "Search Console Token";
const TOKEN_FILE_NAME = "token.json";

export const TOKEN_PROVIDERS = ["file", "1password"] as const;
export type TokenProvider = (typeof TOKEN_PROVIDERS)[number];

/** Persistence for the OAuth token. Implementations must never log the token. */
export interface TokenStore {
  /** Where the token lives, safe to print. Never includes the token itself. */
  readonly description: string;
  load(): Promise<Credentials>;
  save(credentials: Credentials): Promise<void>;
}

/**
 * Stores the token as a private file. Protected by filesystem permissions
 * only, so the contents are readable by anything running as this user.
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
 * Stores the token as a 1Password document, so it is encrypted at rest and
 * gated by the vault rather than by file permissions.
 *
 * The token moves over stdin in both directions. `op item edit` would accept a
 * value as a command argument, but arguments are visible to other local
 * processes, so documents are used instead — they read stdin and write stdout.
 */
export class OnePasswordTokenStore implements TokenStore {
  public constructor(
    private readonly vault: string,
    private readonly item: string,
    private readonly run: CommandRunner = runCommand,
  ) {}

  public get description(): string {
    return `1Password document "${this.item}" in vault "${this.vault}"`;
  }

  public async load(): Promise<Credentials> {
    let raw: string;
    try {
      raw = await this.run("op", [
        "document",
        "get",
        this.item,
        "--vault",
        this.vault,
      ]);
    } catch (error) {
      throw new Error(
        `${describe(error)} No OAuth token document "${this.item}" is readable in vault "${this.vault}". Run npm run auth first, and check that 1Password is unlocked.`,
      );
    }
    return parseCredentials(raw, `1Password document "${this.item}"`);
  }

  /**
   * Writes via a short-lived private staging file.
   *
   * op accepts a document body on stdin, but it probes stdin at startup and
   * reports "expected data on stdin but none found" when it is spawned rather
   * than shell-piped, because the pipe is still empty at that moment. Passing
   * the token as a command argument is not an option either — arguments are
   * visible to any local process. So the body goes through a 0600 file in a
   * 0700 directory that is overwritten and removed immediately afterwards.
   *
   * The token therefore touches the disk briefly. That is weaker than never
   * writing it, and on a copy-on-write filesystem the overwrite is best-effort
   * rather than a guarantee, so full-disk encryption remains the real control.
   */
  public async save(credentials: Credentials): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), "gsc-token-"));
    const stagingPath = join(directory, TOKEN_FILE_NAME);

    try {
      await writeFile(stagingPath, `${JSON.stringify(credentials)}\n`, {
        encoding: "utf8",
        mode: PRIVATE_MODE,
      });

      const args = (await this.exists())
        ? ["document", "edit", this.item, stagingPath]
        : ["document", "create", stagingPath, "--title", this.item];
      args.push("--vault", this.vault, "--file-name", TOKEN_FILE_NAME);

      await this.run("op", args);
    } catch (error) {
      throw new Error(
        `${describe(error)} Could not write the OAuth token to document "${this.item}" in vault "${this.vault}". Check that 1Password is unlocked and the vault is writable.`,
      );
    } finally {
      await shred(stagingPath);
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async exists(): Promise<boolean> {
    try {
      await this.run("op", [
        "item",
        "get",
        this.item,
        "--vault",
        this.vault,
        "--format",
        "json",
      ]);
      return true;
    } catch {
      return false;
    }
  }
}

/** Build the token store named by GSC_TOKEN_PROVIDER. Defaults to `file`. */
export function createTokenStore(
  environment: NodeJS.ProcessEnv = process.env,
  run: CommandRunner = runCommand,
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

  // Falls back to the credential vault so the common case needs one variable.
  const vault =
    environment.GSC_TOKEN_OP_VAULT ?? environment.GSC_SECRET_OP_VAULT;
  if (!vault) {
    throw new Error(
      "GSC_TOKEN_OP_VAULT (or GSC_SECRET_OP_VAULT) must be set when GSC_TOKEN_PROVIDER is 1password.",
    );
  }
  return new OnePasswordTokenStore(
    vault,
    environment.GSC_TOKEN_OP_ITEM ?? DEFAULT_OP_TOKEN_ITEM,
    run,
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

/**
 * Overwrite then unlink, so the token is not left sitting in freed blocks.
 * Best-effort: a copy-on-write filesystem may keep the original extent.
 */
async function shred(path: string): Promise<void> {
  try {
    const { size } = await stat(path);
    await writeFile(path, randomBytes(size));
  } catch {
    // Already gone, or never created; nothing to overwrite.
  }
  await rm(path, { force: true });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "The op CLI failed.";
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
