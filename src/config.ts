import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

const DEFAULT_TOKEN_FILE = "~/.config/search-console-mcp/token.json";

export interface ExpandOptions {
  /** Reject relative paths. Configuration paths are absolute; a dotenv path may be relative. */
  requireAbsolute?: boolean;
}

/** Expand a leading `~/` and, by default, require the result to be absolute. */
export function expandPath(
  value: string,
  variable: string,
  options: ExpandOptions = {},
): string {
  const expanded = value.startsWith("~/")
    ? resolve(homedir(), value.slice(2))
    : value;

  if (options.requireAbsolute === false) return expanded;

  if (!isAbsolute(expanded)) {
    throw new Error(`${variable} must be an absolute path.`);
  }
  return expanded;
}

/**
 * Resolve where the OAuth token is stored. This is a location, not a secret, so
 * it is safe to name in error messages.
 */
export function resolveTokenFile(environment = process.env): string {
  return expandPath(
    environment.GSC_TOKEN_FILE ?? DEFAULT_TOKEN_FILE,
    "GSC_TOKEN_FILE",
  );
}
