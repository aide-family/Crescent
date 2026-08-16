---
name: crescent-delivery-gate
description: >-
  Crescent delivery protocol: survey first, evidence, constraints, CI, acceptance
  checklist, stop for confirmation. Use for non-trivial Crescent changes, when
  the user says 勘察, 验收清单, 完成后停下, v2 基线, or forbids commit/push/tag until they
  confirm.
---

# Crescent delivery gate

Use this for non-trivial work. Trivial one-file fixes the user already scoped may skip the survey write-up, but never skip CI-before-commit or the git author rules.

## 1. Survey (read-only)

Before editing:

- Name the files, functions, and current behavior you will touch.
- List evidence (paths + line ranges, traces, failing tests).
- State what you will **not** touch (security invariants, unrelated features, tags/releases).

Do not invent APIs. Read installed pi docs / types and existing Crescent modules first. Reuse before adding.

## 2. One baseline

If the user says a document or prompt is the v2 / sole baseline, treat it as SSOT. Do not stack older patch prompts on top.

## 3. Implement

- Follow `crescent-host` and, if routing/login is involved, `crescent-login-intent`.
- User-visible copy: `zh-CN` and `en`.
- Tests next to the module. Prefer a failing assertion that proves the bug, then green.
- No `as any`. No new dependencies unless the user asked.

## 4. Verify

Local equivalent of CI:

```bash
npm run ci
```

(`lint`, `test`, `typecheck`, `build`). Fix and re-run the full set if anything fails.

## 5. Acceptance

Before claiming done, output a short checklist the user can execute (UI steps or tests). Do not mark the work complete on “should work”.

## 6. Git

- Do **not** commit, push, tag, or publish unless the user asked in this turn.
- If they asked to stop after implementation: stop, give the checklist, wait.
- When they do ask to commit: `npm run ci` must already be green in this session; commit author is only the repo git user; no Cursor trailers; no `--no-verify`.

## Default stop condition

If the user wrote 完成后停下 / 先输出验证清单等我确认 / 禁止 git commit: implement + verify, then **halt**.
