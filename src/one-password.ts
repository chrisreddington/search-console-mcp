import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DEFAULT_MCP_COMMAND =
  "/Applications/1Password.app/Contents/MacOS/onepassword-mcp";

/**
 * The subset of the 1Password MCP server this project uses, behind a seam so the
 * decision logic can be tested without a vault.
 */
export interface EnvironmentWriter {
  authenticate(): Promise<string>;
  listEnvironments(accountId: string): Promise<Environment[]>;
  listVariableNames(
    accountId: string,
    environmentId: string,
  ): Promise<string[]>;
  appendVariable(
    accountId: string,
    environmentId: string,
    name: string,
    value: string,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface Environment {
  environmentId: string;
  name: string;
}

/**
 * Write a secret into a 1Password Environment.
 *
 * This runs from `npm run auth` only — an interactive, terminal-launched command
 * where 1Password can show its approval prompt. The long-running server never
 * does this: it has no dependencies beyond reading a path, because a
 * GUI-launched host cannot satisfy a per-process authorisation.
 *
 * The value travels from this process to 1Password over stdio. No agent is
 * involved, so it never enters a model's context.
 */
export async function storeVariable(
  writer: EnvironmentWriter,
  environmentName: string,
  name: string,
  value: string,
): Promise<void> {
  const accountId = await writer.authenticate();
  const environments = await writer.listEnvironments(accountId);
  const target = environments.find(
    (candidate) => candidate.name === environmentName,
  );
  if (!target) {
    const known = environments.map((e) => e.name).join(", ") || "none";
    throw new Error(
      `No 1Password Environment named "${environmentName}". Available: ${known}.`,
    );
  }

  // The MCP server can append a variable but not replace one, so a re-run has to
  // be told rather than silently duplicating or failing deep inside 1Password.
  const existing = await writer.listVariableNames(
    accountId,
    target.environmentId,
  );
  if (existing.includes(name)) {
    throw new Error(
      `${name} already exists in Environment "${environmentName}". 1Password's MCP server can add a variable but not replace one, so delete ${name} in the 1Password app and run this again.`,
    );
  }

  await writer.appendVariable(accountId, target.environmentId, name, value);
}

/** Connect to the local 1Password MCP server over stdio. */
export async function connectToOnePassword(
  command = process.env.GSC_OP_MCP_COMMAND ?? DEFAULT_MCP_COMMAND,
): Promise<EnvironmentWriter> {
  const client = new Client({
    name: "search-console-mcp",
    version: "0.10.0",
  });

  try {
    await client.connect(new StdioClientTransport({ command, args: [] }));
  } catch (error) {
    throw new Error(
      `Could not start the 1Password MCP server at ${command}. Check the path, and that 1Password is running with its MCP server enabled (Settings > Labs). (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }

  const call = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    const text = (result.content ?? []).map((part) => part.text ?? "").join("");
    if (result.isError) {
      throw new Error(`1Password ${name} failed: ${text.slice(0, 200)}`);
    }
    return text;
  };

  return {
    authenticate: async () => {
      const parsed = JSON.parse(await call("authenticate", {})) as {
        account_id?: string;
      };
      if (!parsed.account_id) {
        throw new Error(
          "1Password did not return an account id. Approve the authorisation prompt and try again.",
        );
      }
      return parsed.account_id;
    },
    listEnvironments: async (accountId) => {
      const parsed = JSON.parse(
        await call("list_environments", { accountId }),
      ) as { environments?: Environment[] };
      return parsed.environments ?? [];
    },
    listVariableNames: async (accountId, environmentId) => {
      const parsed = JSON.parse(
        await call("list_variables", { accountId, environmentId }),
      ) as { variableNames?: string[] };
      return parsed.variableNames ?? [];
    },
    appendVariable: async (accountId, environmentId, name, value) => {
      await call("append_variables", {
        accountId,
        environmentId,
        variables: [{ name, value, concealed: true }],
      });
    },
    close: () => client.close(),
  };
}
