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

const PRIVATE_MODE = 0o600;

export class TokenStore {
  public constructor(private readonly path: string) {}

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
    const value: unknown = JSON.parse(raw);
    if (!isCredentials(value)) {
      throw new Error(
        `The OAuth token at ${this.path} is not a valid token file.`,
      );
    }
    return value;
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
