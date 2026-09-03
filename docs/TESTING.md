# Local-only testing

Crescent keeps **unit tests on developer machines only**. Test files are listed in [`.gitignore`](../.gitignore) and must **not** be committed.

## Why

- CI runs `npm run test` with `--passWithNoTests` so the shared pipeline stays green without checked-in tests.
- Developers still run real Vitest suites locally before committing risky changes.

## Setup

Restore core tests from git history (files stay untracked):

```bash
./scripts/restore-local-tests.sh
```

Or restore a single file:

```bash
git show 0ca23c0:src/shared/capture-intent.test.ts > src/shared/capture-intent.test.ts
```

## Commands

| Script               | Purpose                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `npm run test`       | CI / hook step — skips `*.test.ts` on disk; passes with no committed tests |
| `npm run test:local` | Local gate — runs gitignored tests (`CRESCENT_LOCAL_TESTS=1`)              |
| `npm run ci`         | lint → test → typecheck → build (CI equivalent)                            |

**Before commit**, run:

```bash
npm run lint && npm run test:local && npm run typecheck && npm run build
```

## Where to put tests

Colocate with the module under test:

- `src/main/agent/*.test.ts`
- `src/shared/*.test.ts`
- `src/renderer/src/lib/*.test.ts`

Vitest config: [`vitest.config.ts`](../vitest.config.ts).

## Priority suites (restore first)

| Module                                      | Risk                          |
| ------------------------------------------- | ----------------------------- |
| `src/shared/command-guard.ts`               | Wrong approval → unsafe shell |
| `src/shared/secret-redaction.ts`            | Leaked secrets in logs/UI     |
| `src/shared/capture-intent.ts`              | Capture identity drift        |
| `src/main/agent/command-classify.ts`        | Misclassified commands        |
| `src/renderer/src/lib/login-action-wait.ts` | False login success / hang    |

Historical snapshot commit: `0ca23c0` (broader set). `command-guard.test.ts` last at `43c4ef8`.
