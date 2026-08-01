---
name: writing-idiomatic-typescript
description: Write TypeScript that satisfies this repository's strict compiler settings and Node ESM layout. Use when adding or changing any .ts file, modelling types, handling unknown data, or resolving tsc errors about optional properties, index access, or import syntax.
---

# Writing idiomatic TypeScript

Write TypeScript that compiles clean under this repository's `tsconfig.json` without casts or suppressions.

## Compiler settings that change how you write code

`tsconfig.json` enables all of the following. Write for them from the start rather than reacting to errors.

| Setting                      | What it forces                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strict`                     | No implicit `any`; null and undefined are real cases you must handle.                                                                                     |
| `noUncheckedIndexedAccess`   | `array[0]` and `record[key]` are `T \| undefined`. Narrow before use; do not `!`.                                                                         |
| `exactOptionalPropertyTypes` | `foo?: string` will not accept an explicit `undefined`. Declare `foo?: string \| undefined` when a caller may pass `undefined`, or omit the key entirely. |
| `verbatimModuleSyntax`       | Type-only imports must use `import type { X } from "..."`.                                                                                                |
| `module: NodeNext`           | Relative imports carry a `.js` extension even though the source is `.ts` (`./config.js`).                                                                 |
| `noImplicitOverride`         | Class overrides need the `override` keyword.                                                                                                              |

## Rules

- Type external data as `unknown` and narrow it with a type guard; never cast an API or file payload straight to an interface you hope it matches.
- Prefer `type` guards returning `value is T` over inline casts; put the guard next to the type it validates.
- Do not use `any`, non-null `!`, or `@ts-expect-error`. If one seems necessary, the type model is wrong — fix the model.
- Model closed sets as `as const` arrays plus a derived union (`type Provider = (typeof PROVIDERS)[number]`) so the runtime list and the type cannot drift.
- Use `node:` prefixed imports for built-ins (`node:fs/promises`, not `fs/promises`).
- Throw `Error` with an actionable message that names the environment variable, file, or CLI the caller must fix.
- Prefer `readonly` parameter types for arrays you do not mutate.
- Keep exports minimal: export what tests and other modules need, keep everything else module-private.
- Never widen a Zod schema to bypass a type error; adjust the schema so inferred input types stay accurate.

## Checklist

- `npm run typecheck` passes with no casts, `!`, `any`, or suppression comments added.
- Every relative import ends in `.js`; every type-only import uses `import type`.
- Optional properties that accept an explicit `undefined` declare `| undefined`.
- Indexed access is narrowed, not asserted.
- External JSON is validated by a type guard before use.
- Error messages name the concrete thing the user must change.
