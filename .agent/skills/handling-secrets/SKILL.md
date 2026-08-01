---
name: handling-secrets
description: Handle Google OAuth credentials and tokens safely in this server. Use when touching src/secrets.ts, src/auth.ts, src/token-store.ts, error messages, logging, sample config, or when adding a new secret backend.
---

# Handling secrets

Keep OAuth client secrets and refresh tokens out of the repository, out of logs, and out of error messages.

## What counts as a secret here

| Value                                            | Sensitivity                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| OAuth client secret, access token, refresh token | Secret — never printed, logged, or serialised into an error.             |
| OAuth client id                                  | Low, but treated as secret; it travels with the secret.                  |
| `GSC_OAUTH_CLIENT_FILE`, `GSC_TOKEN_FILE` paths  | Not secret — safe to name in errors, and doing so makes them actionable. |

## Rules

- Resolve credentials only through `resolveClientCredentials()` in `src/secrets.ts`. No other module reads `GSC_CLIENT_SECRET` or parses the client file.
- Fail closed: an unknown provider, a backend error, or an empty/placeholder value aborts startup. Never fall back to a weaker provider automatically.
- Validate resolved values before use, and reject obvious template text (`your-`, `changeme`, `example`, …) so a copied sample fails at startup rather than at the first Google call.
- Error messages may name environment variables, file paths, and CLI names. They must never include a credential value, a token, a raw file body, or the stdout of a secret CLI — those can echo the secret back.
- Write token files atomically with mode `0600` inside a `0700` directory (`TokenStore`), and re-`chmod` after reads that may have loosened it.
- Request the narrowest scope: authorization is fixed to `webmasters.readonly`. Adding a write scope needs an explicit decision, not a convenience change.
- Sample files (`.env.example`, `README.md`, `.mcp.json`) carry placeholders only. Keep credential globs in `.gitignore` covering any new filename you introduce.
- Never write a secret to the repository working tree, including in tests. Tests use obvious fakes and OS temp directories.

## Adding a new secret backend

1. Add the name to `SECRET_PROVIDERS` in `src/secrets.ts` — the union type derives from it.
2. Implement `from<Backend>(environment, runCommand | readTextFile)`; take every side effect through an injected seam so it is testable.
3. Add a `case` to the switch and a `remedy()` branch telling the user exactly how to store the values.
4. Add table-driven tests for success, backend failure, and missing-value cases.
5. Document the backend in the provider table in `AGENTS.md` and `README.md`, and add its env vars to `.env.example`.

## Checklist

- No new code path reads a credential outside `src/secrets.ts`.
- No `console.log`/`process.stdout` call can receive a credential; stdout is the MCP transport and must stay protocol-only.
- Every new error message was checked against "could this string contain the secret?".
- New credential filename patterns are covered by `.gitignore`.
- Token files are still written `0600` via the atomic temp-file-and-rename path.
- `git diff` contains no real credential, token, vault name, or personal file path.
