---
name: crescent-host
description: >-
  Defines Crescent as the operations host and Pi as a guest runtime. Use when
  changing Crescent agent, Electron process boundaries, MCP, extensions,
  subterminals, skills, packaging, or desktop UI; when installing pi-package
  plugins; or when electron-egg / ee-core is mentioned.
---

# Crescent host

Crescent is an Electron + electron-vite operations workbench. Pi (`@earendil-works/pi-coding-agent`) is the **guest runtime** for inference and tool calls. Crescent owns the session, terminals, credentials, and product surfaces.

Do not adopt Electron EGG (`ee-core`). Ignore `electron-egg` for this repo.

## Ownership

| Surface | Owner (host) | Guest may |
|---|---|---|
| SSH / login / PTY | Crescent connection routing + visible terminal | Not open a parallel login path |
| MCP | Crescent settings + `src/main/agent/pi-mcp-tools.ts` | Not `pi-mcp-adapter` as the product MCP plane |
| Subtasks | `open_subterminal` / session terminal pool | Not `pi-subagents` as the product sub-agent plane |
| Skills / SOP / Wiki | Crescent Skills manager | Pi skills only as extra playbooks, not a second manager |
| Command review | `command-classify` + approval UI | Custom tools still go through host policy |
| Secrets / FS / DB | Main process | Renderer never touches disk |

Default: **do not enable** `pi-mcp-adapter` or `pi-subagents`. They duplicate host surfaces with a different config dir (`~/.crescent/pi-agent`). Extensions may add tools the host does not already provide (e.g. `fetch_content`).

Do not load untrusted project `.pi/extensions`. User extensions live under `~/.crescent/pi-agent/extensions` plus enabled npm packages.

## Process boundaries

- Renderer: no Node, no filesystem. Main owns OS / DB / secrets. Preload is the only bridge.
- `contextIsolation: true`, `nodeIntegration: false`. Whitelist IPC in preload; validate arguments in main.
- Import pi only through `src/main/agent/pi-sdk.ts` (`import()`). Never static-import pi into CJS main.
- Keep `@earendil-works/pi-*` on one version. Read installed package docs/types in `node_modules` before changing agent code.
- Custom tools: allowlist, truncate large output, `withFileMutationQueue` for file writes.
- Native modules stay outside the bundler (`asarUnpack` / `external`).
- Pi-facing tests sit next to the module: `src/main/agent/*.test.ts`.
- Hosted session reuse must include an extension fingerprint when loaded extensions change.

## UI

- Follow `desktop-app-design` and `docs/UI_DESIGN_SYSTEM.md`.
- Dense, keyboard-first, quiet chrome. Accent `#13c2c2`.
- New user-visible strings: both `src/renderer/src/i18n/zh-CN.ts` and `en.ts`.

## Before coding

Read `pi-dev` (and `references/crescent-integration.md` if present), `electron-dev` / `electron`, and this skill. Then read the files you will change.

Also apply `crescent-login-intent` when the change can trigger SSH, and `crescent-delivery-gate` for non-trivial work.
