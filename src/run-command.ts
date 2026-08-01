import { spawn } from "node:child_process";

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

export const runCommand: CommandRunner = (command, args) =>
  new Promise<string>((resolve, reject) => {
    // stderr is ignored rather than captured: a failing secret CLI can echo
    // field values, and surfacing them would defeat the point of the vault.
    const child = spawn(command, [...args], {
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
          ? new Error(
              `The "${command}" CLI is not on PATH. Install it, or choose a provider that does not need it.`,
            )
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
