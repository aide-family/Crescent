# Execution plans

The composer has two independent selectors: working style and execution mode. New and legacy sessions default to **Immediate**. **Planned** is an explicit session choice, never an approval. Saved sessions retain the mode only; approvals are memory-only and cannot survive run termination or restart.

## Immediate policy baseline

| Command family                                                                | Result    |
| ----------------------------------------------------------------------------- | --------- |
| Known local inspection, such as hostname or kubectl get                       | Automatic |
| Parsed SSH command containing only known inspection                           | Automatic |
| Narrow sudo inspection, such as sudo systemctl --no-pager status UNIT         | Automatic |
| Interactive SSH, forwards, alternate configuration, ProxyCommand/LocalCommand | Approval  |
| sudo shell, arbitrary file readers, sensitive/indirect sudo queries           | Approval  |
| Writes, mixed read/write scripts, unknown programs                            | Approval  |
| curl, arbitrary awk/sed/yq scripts, environment injection                     | Approval  |

The static parser checks all commands. Model audit advice and legacy wildcard rules cannot approve unknown commands. Some formerly overbroad inspection patterns now intentionally require review.

## Host ownership

`execution-plan.ts` contains shared data only. Main validates the entire bounded plan, makes a deep copy, hashes it, binds its approval to the owning window, run/session, PTY generation and connection identity, and executes the exact steps sequentially. The preload exposes explicit request/decision/progress channels. Renderer displays the full plan and submits only the decision and matching digest.

In planned runs, Pi may call `bash` for read-only investigation and `submit_change_plan`. Other guest tools are disabled. Neither Bash arguments nor Renderer can obtain a reusable approval bypass. The executor retains normal terminal auditing, cancellation and timeouts, suppresses automatic pane fallback/retry, and rechecks the binding immediately before command injection.

Approval expires ten minutes after submission. Identity/connection readiness changes invalidate it immediately. Reconnection cannot resurrect it. Closing a terminal/session, stopping the run or shutting down also invalidates it. A new plan needs a new approval; unchanged commands that failed in the same run cannot be retried.

## Supported automatic changes and protection

| Change                                                                                    | Protection and verification                                                                                                   | Limits                                                                                                         |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Existing regular-file contents via `cp -- SOURCE DEST` or `install -m 600 -- SOURCE DEST` | Private backup, no overwrite/symlink, independent byte comparison, approved SHA-256 checked again before changes and recovery | Absolute paths without shell expansion; content backup does not restore ownership, ACLs or extended attributes |
| Exact `.service` start/stop/restart/reload                                                | Reviewed alternative protection, per-step read-only conditions and final verification                                         | Service lifecycle actions may have application-specific effects; operator must assess redundancy and recovery  |
| Exact deployment/statefulset replica count                                                | Explicit context, namespace, resource, desired count and `--current-replicas` condition                                       | No generic manifest, apply/patch, selector-wide change, or data backup claim                                   |

Commands outside this set are rejected for automatic plan execution. Use immediate mode and individual review for scripts, destructive operations, snapshots requiring unsupported tools, database migration or metadata restoration. Every plan must end in read-only verification. Checks compare exit code zero and exact trimmed output; uncertainty stops the plan.

File backups use `install -m 600 -- SOURCE DEST`. Creation checks a regular, non-symlink source and absent destination. Verification uses `test -f DEST && test -r DEST && cmp -s -- SOURCE DEST`. The plan also includes `sha256sum -- DEST` or `shasum -a 256 -- DEST` with the exact expected digest and artifact path; derive the digest from the source before approval. No file contents are returned in verification. Permission, retention, sensitivity and cleanup instructions are reviewed explicitly; cleanup does not run implicitly.

Recovery steps are shown in full and require a separate, initially unchecked consent box. They run only on the named normal failure and must themselves verify success. Timeout, target drift, interrupted execution, invalid preconditions and expired authorization never trigger recovery. Original remaining steps stay stopped even after successful recovery.

## Audit and validation

Submitted plans, their digest, decisions (including redacted notes) and step transitions are recorded. The conversation timeline and visible terminal show execution. Plan command results withhold raw output from tool results and command events; backup checks are metadata/checksum-only.

Local test files are intentionally untracked by project policy (`docs/TESTING.md`). Tests cover static classification, owner/digest binding, immutable approval data, expiration, drift, rejection, backup failure, stop/retry behavior and explicit recovery consent. Electron verification uses an isolated test data directory, a local mock model provider and temporary files, without production connections.

Project note: this checkout provides `pi-dev` and `electron-development` skill files. Separate `electron` and `desktop-app-design` skill files were not found; Electron boundaries follow the provided Electron skill and desktop presentation follows `docs/UI_DESIGN_SYSTEM.md`.

## Verified implementation (2026-09-28)

- `npm run ci` passed (two pre-existing formatting warnings); `npm run test:local` passed 112 tests across nine files. Local tests cover plan and static-command behavior plus long PTY transport framing.
- Electron with a local fixture provider completed six real workflows: approved file backup/change/verification, rejected plan with no write, failed change stopping before final verification, explicitly approved recovery, unapproved recovery staying stopped, and renderer reload invalidating the pending approval. Backup content and 0600 permissions were checked on disk; keyboard selection and decision notes were exercised. The tool inventory was exactly `bash` and `submit_change_plan`; all four communication styles were present.
- The test uncovered the existing single-line Base64 PTY runner exceeding canonical input limits. The runner now uses bounded physical lines in a compound shell block, with one encoded payload. Shell tests and the Electron workflow verify the fix.
- Tests use local fixtures, not a production SSH host or Kubernetes cluster; remote live execution remains unverified.
