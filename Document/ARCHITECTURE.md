# Crescent Architecture

Crescent is an Electron, React, and TypeScript desktop workbench that places an AI agent next to a real terminal.

## Runtime Boundaries

- `src/main` owns Electron main-process capabilities: windows, persistence, terminal sessions, SSH, Agent execution, OpenAPI, MCP, local files, and OS dialogs.
- `src/preload` exposes a typed IPC bridge to the renderer. New renderer capabilities should be added here instead of importing Electron APIs in UI code.
- `src/renderer/src` owns React UI, xterm rendering, command approval dialogs, connection management, settings, Skills, Wiki, and history views.
- `src/shared` contains cross-process types and catalog metadata.

## Core Flows

### Agent Run

1. Renderer submits an Agent request through `window.api.agent.run`.
2. Main process builds prompt context from terminal state, Skills, Wiki, memory, and configured tools.
3. `TerminalAgentCore` runs the selected model and dispatches tool calls through `AgentToolRuntime`.
4. Terminal, file, Wiki, OpenAPI, and MCP observations are streamed back as Agent events.
5. Renderer persists logs and presents approval prompts for risky commands.

### Terminal

1. Renderer starts a terminal tab through the preload API.
2. Main process creates a PTY session when available, or a pipe fallback.
3. Output is streamed to xterm and cached for Agent context.
4. Automation commands use watchdog timeouts and prompt detection.

## Current Refactoring Priorities

`src/renderer/src/App.tsx` is intentionally the first major refactoring target. Keep future extraction incremental:

1. Extract presentational panels without changing state ownership.
2. Move cohesive state machines into hooks after component boundaries are stable.
3. Add renderer tests around approval, connection forms, settings validation, and terminal tab transitions.
4. Split large IPC modules only after tests cover existing behavior.

Completed renderer boundaries:

- `components/AppModals` owns reusable confirmation, password, and command approval modals.
- `components/ConnectionManagerModal` owns SSH connection management UI.
- `components/StatusIndicators` owns visual status dots and operation messages.
- `components/AgentLogContent`, `components/AgentRunMarkdownContent`, `components/MarkdownContent`, and `components/ConnectionList` own repeated renderer presentation.
- `components/TerminalPane` owns the terminal tab bar, empty connection list, xterm host, and subterminal panel chrome.
- `components/AgentPanel` owns the conversation log list and agent input dock.
- `components/SettingsSheet` owns provider/OpenAPI/instruction settings chrome.
- `components/SkillManager` owns Skills directory, search/install, and install-log chrome.
- `components/WikiSheet` owns Wiki browse/edit/preview chrome.
- `components/HistoryPanel` owns session history list chrome.
- `components/OnboardingModal` owns the one-time first-run tour.
- `lib/app-shell`, `lib/agent-input`, `lib/connection-commands`, `lib/connection-automation-policy`, `lib/slash-commands`, `lib/terminal-text`, `lib/onboarding`, `lib/design-system`, and `lib/pipe-terminal` own pure renderer utilities.
- `hooks/useTerminalTabs`, `hooks/useXtermLifecycle`, and `hooks/useConnections` own extracted App state machines for tabs, xterm/pipe lifecycle, and connection form helpers.

Recommended renderer targets:

- `hooks/useTerminalTabs` — done (derived session tabs, saveTabs debounce, `selectSessionTab` / `openLocalTerminal`, close-tab promotion helpers)
- `hooks/useXtermLifecycle` + `lib/pipe-terminal` — done (pipe input helpers, FitAddon resize observer, xterm mount/lifecycle effect)
- `hooks/useConnections` — done (preview API plus `createEmptyConnectionForm` / `connectionToForm` / `normalizeConnectionInputForSave`)
- `hooks/useAgentRun` (extend `useAgentRuns`)

## Review Rules

- Treat command execution, file writes, SSH, OpenAPI, MCP, and credentials as security-sensitive.
- Keep IPC payloads typed and narrow.
- Prefer adding tests before splitting main-process modules.
- Do not move logic across process boundaries unless the capability boundary remains explicit.

## Runtime adapter and renderer controllers (2026-10)

- `src/main/agent/runtime/types.ts` defines the host session, model, normalized event, and tool contracts. The Pi adapter owns SDK calls; approval, PTY/SSH, MCP, subagents, secrets and persistence remain in Crescent main. `pi-sdk.ts` is the compatibility facade, and private ESM paths are centralized in `runtime/pi/loader.ts`.
- Production sessions keep `noExtensions: true`. Explicit codemode/tool_search factories are exercised only by isolated local evaluations. Experimental SDKs live under `experiments/agent-runtime` and are excluded from product dependencies and packaging.
- Renderer domain controllers hold agent execution, providers, wiki, history, skills, capture, feedback, password prompts, layout and configuration persistence. Typed preload clients are collected under `src/renderer/src/clients`; no Node or filesystem access is added to renderer.
- Preload implementation is grouped by domain under `src/preload/modules`, exposed through the existing API shape and contextBridge. Terminal lifecycle maps and output batching have dedicated owners; stale session events cannot settle a new session's waiters. SQLite row schemas validate projected database fields before returning domain records.
- Optional settings/history/wiki/MCP/skills/Whale surfaces are React lazy imports. Whale video URLs are imported per motion after the surface is mounted, and closing the pet unmounts its video elements.
- Reasoning effort defaults to high, is configurable per application, and is clamped to each model's capabilities. Optional per-model sampling mappings are validated in main; no extra sampling is injected by default.
