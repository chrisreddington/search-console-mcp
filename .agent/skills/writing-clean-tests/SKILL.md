---
name: writing-clean-tests
description: Write behavior-focused tests with the built-in node:test runner. Use whenever adding or changing tests, reviewing test code, or when tests are duplicated, flaky, or coupled to implementation.
---

# Writing clean tests

Test observable behavior with `node:test` and `node:assert/strict`, not implementation details.

## This repository's runner

- Tests are co-located: `src/<module>.test.ts` sits next to `src/<module>.ts`. There is no `test/` directory — do not create one.
- They compile to `dist/src/` and run via `npm test` (`node --test dist/src/*.test.js`).
- Import the module under test as `./<module>.js` — the compiled extension, not `.ts`.
- Use `node:test` (`test`, `describe`, `it`) and `node:assert/strict`. No third-party test framework, no mocking library.
- Assert thrown errors with `assert.throws` / `assert.rejects` and a regex on the message, so the actionable wording stays covered.

## Substituting I/O

Every module that touches the network, filesystem, or a CLI accepts an injectable
seam (`fetch`, `readTextFile`, `runCommand`, an `environment` object). Pass a fake
through that seam. Do not monkey-patch globals and do not reach for `mock.method`
on internal functions.

```ts
const credentials = await resolveClientCredentials({
  environment: { GSC_SECRET_PROVIDER: "doppler" },
  runCommand: async () => "GSC_CLIENT_ID=abc\nGSC_CLIENT_SECRET=def\n",
});
```

## Rules

- One behavior per test; the name states it (`rejects a placeholder client secret`).
- Extract a fixture/factory once setup is shared by two or more tests; do not copy-paste setup.
- Use table-driven cases (`for (const testCase of cases) test(...)`) when tests differ only by input and expected output — including error cases that differ only by which input is bad.
- Test unhappy paths explicitly: missing configuration, malformed payloads, non-2xx responses, and boundary conditions matter as much as the happy path.
- Keep each test isolated and order-independent; never mutate `process.env` — pass an `environment` object instead.
- Write real files under `fs.mkdtemp(os.tmpdir())` and clean up; never write inside the repository.
- Mock only I/O boundaries; never mock internal functions.
- Assert on returned values and observable effects (file contents, file mode, request URL and body), not on whether a fake was called.
- Never assert on, or hard-code, a real credential; use obvious fake values that do not trip placeholder validation.

## Checklist

- Each test name describes one behavior, no "and".
- Shared setup lives in a fixture/factory, not duplicated.
- Input-varying cases (including error cases) are rows in one table.
- Unhappy paths each have a test.
- No test mutates `process.env`, global `fetch`, or the working directory.
- Temporary files are created under the OS temp dir and removed afterwards.
- Assertions check values, state, or effects — not call counts.
