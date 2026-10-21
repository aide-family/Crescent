# Local-only testing

Crescent keeps **unit tests on developer machines only**. Test files are listed in [`.gitignore`](../.gitignore) and must **not** be committed.

## Why

- CI runs `npm run test` to verify security boundaries (IPC registration, preload exposure, sandbox, approval, logging and renderer imports). It does not claim unit-test coverage.
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

| Script               | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `npm run test`       | CI / hook step — runs security boundary policy checks; no unit-test claim |
| `npm run test:local` | Local gate — runs gitignored tests (`CRESCENT_LOCAL_TESTS=1`)             |
| `npm run ci`         | lint → test → typecheck → build (CI equivalent)                           |

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

Security regression suites created for this audit remain gitignored: `security-regression.test.ts`, `security-boundaries.test.ts`, `crescent-store.test.ts`, `pi-mcp-tools.test.ts`, and `mcp-approval.test.ts`. Run `npm run test:local` for actual behavioral coverage.

## Complete local verification and unsigned macOS delivery

`npm run verify:local` runs the existing CI gate and then the local-only unit suites. `npm run build:mac:local` verifies and creates **one Universal macOS application, DMG and ZIP**, each containing x64 and arm64, under `dist/local-macos/universal/`. All Mac packaging scripts use Universal; legacy `:x64` and `:arm64` commands are compatibility aliases and no longer produce separate packages. No commit, push or publish is performed. Signing identities and notarization are explicitly disabled for this local flow. See [the development and packaging rules](DEVELOPMENT.md) for the permanent Mac-only delivery standard, signed packaging and offline preparation.

UI and main-process acceptance can use `CRESCENT_DATA_DIR` and `CRESCENT_USER_DATA_DIR` to isolate application records and Electron profiles. Keep the default user directories for normal launches. `CRESCENT_STARTUP_TRACE=1` logs main/agent milestones; renderer Performance entries record boot, first UI and first terminal readiness.

Runtime alternatives are evaluated in `experiments/agent-runtime`; they have their own lockfile, typecheck, benchmark and audit. Their simulated host transport results must not be reported as real SSH/MCP or model acceptance. Local test files remain gitignored and are not part of GitHub CI. Release quality checks use lint, static security checks, types, build and audit before packaging.

The 2026-10-10 host execution regression uses per-line PTY acknowledgements, isolated bash/zsh/sh and ephemeral loopback SSH fixtures. See [the专项 acceptance record](Crescent_v1.0.11_专项改造验收记录_20261010.md) for the A–H evidence and limitations. `CRESCENT_OFFLINE_BUILD=1` enables local cache prechecks and prohibits native prebuild network fallback; prepare the locked Electron, DMG tooling and esbuild caches before disconnecting. `CRESCENT_LOCAL_BUILD_DIR` can select a separate directory under `dist/`. Never rebuild `out/` while packaging is reading it.
