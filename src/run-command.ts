import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Directories searched after `PATH` when locating a CLI.
 *
 * A GUI-launched host (Codex.app, Claude Desktop, Finder) hands its children a
 * minimal `PATH` — typically `/usr/bin:/bin:/usr/sbin:/sbin` — because macOS
 * apps never source a shell profile. Homebrew's bin directory is therefore
 * absent, and `op` or `doppler` would appear "not installed" only when launched
 * from the app, which is a miserable thing to debug.
 */
const FALLBACK_BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/opt/local/bin",
  join(homedir(), ".local/bin"),
];

/** Raised when a CLI could not be located, so callers can tailor the advice. */
export class CommandNotFoundError extends Error {
  public constructor(public readonly command: string) {
    super(
      `The "${command}" CLI was not found. Searched PATH and ${FALLBACK_BIN_DIRS.join(", ")}. GUI-launched apps start with a minimal PATH, so a Homebrew install can be invisible to them.`,
    );
    this.name = "CommandNotFoundError";
  }
}

/**
 * Runs an external CLI and returns its stdout.
 *
 * Secrets are never passed in `args`: command arguments are visible to any
 * process that can read the process list. Callers that must hand a secret to a
 * CLI stage it in a private file and pass the path.
 */
export type CommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<string>;

/** Absolute path to `command`, searching PATH then the fallback directories. */
export function resolveExecutable(command: string): string | undefined {
  if (command.includes("/")) return command;

  const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const directory of [...pathDirs, ...FALLBACK_BIN_DIRS]) {
    const candidate = join(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here, or not executable; keep looking.
    }
  }
  return undefined;
}

export const runCommand: CommandRunner = (command, args) =>
  new Promise<string>((resolve, reject) => {
    const executable = resolveExecutable(command);
    if (!executable) {
      reject(new CommandNotFoundError(command));
      return;
    }

    // stderr is ignored rather than captured: a failing secret CLI can echo
    // field values, and surfacing them would defeat the point of the vault.
    const child = spawn(executable, [...args], {
      stdio: ["pipe", "pipe", "ignore"],
    });

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "ENOENT"
          ? new CommandNotFoundError(command)
          : new Error(`The "${command}" CLI could not be started.`),
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `The "${command}" CLI exited with status ${code ?? "unknown"}.`,
        ),
      );
    });

    child.stdin.end();
  });
