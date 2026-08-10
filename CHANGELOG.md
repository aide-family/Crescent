# Changelog

## v1.0.3 (2026-08-11)

### Features

- Agent tool `open_subterminal` (local / SSH) docks a subterminal and routes subsequent bash there so client-machine hosts edits and new SSH targets can execute instead of analysis-only loops; include it in Pi `tools` allowlist (not only `customTools`) so the model can call it.
- Fast “Save as SOP” path: `agent:generate-sop` drafts via AgentBrain (no tools, 30s) and **main** saves with `saveWikiDocument` to `~/.crescent/wiki`; falls back to seed text on failure.
- Slash wiki refs activate `activeWikiIds` SOP injection without embedding full markdown in user input; Composer wiki multi-select removed.
- Slash skill refs inline SKILL.md (≤2000 chars each) into the run prompt as “引用 Skill 内容”.

### Improvements

- System prompt「本机与子终端硬规范」: local `/etc/hosts` / client-machine work must `open_subterminal(mode=local)` first; unreachable hosts prefer SSH subterminals; no analysis-only substitute.
- Busy-path steer wraps supplements as explicit「上下文注入」context (not a new task); system prompt「叙述纪律」forbids mid-run tables/summaries and requires one final report covering all follow-ups.
- Dev macOS notifications use Crescent’s left-slot logo via postinstall/`predev` `electron.icns` patch plus Info.plist identity (`com.crescent.app`) so Notification Center does not keep the cached Electron atom; Notification `icon` is omitted on darwin (no right inset), kept on Win/Linux.
- HIGH approval cards asynchronously show a one-line human “purpose” (loading → fill; omit on timeout/failure).
- OS attention notifications use the Crescent app icon; macOS Dock icon is set in dev only (`!isPackaged`).
- Unfocused windows get a one-shot run-complete / run-failed OS notification (mutually exclusive with pending approval notifies for that run).
- Prefer conversation turns when trimming agent logs; keep the latest user message across memory and SQLite history prune.
- Stop awaits Pi session abort/idle before clearing busy; prompt waits ≤3s for idle to avoid “already processing” races.
- OS attention notifications for pending approval / password / connection clarify when the window is unfocused (deduped by pending id).
- Suggestion picker supports select-all tri-state checkboxes; card action buttons are right-aligned.
- Localize stop / already-processing / common agent system errors in en/zh.
- “Save as SOP” is fully deterministic on main: single tool-free completion then direct `saveWikiDocument` under `~/.crescent/wiki` (no bash/write/mkdir, no save-location prompts).
- System prompt: SOP/wiki must only land via wiki store; never workspace/remote via bash or write tools.
- System prompt: when executing an SOP, fold readonly steps into ≤3 terminal rounds (concurrent deep-dives); writes stay separate.
- generate-sop prompts: valid current CLI examples; deep-dive wording allows same-bash concurrent inspection.
- PTY command waiters settle on user Ctrl+C / Stop (`interrupted`) and hard-timeout (`timeout`, default 600s) so agent runs no longer deadlock after interrupt.
- Stop/cancel: settle interrupted tool-card events before session abort; renderer force-settles still-running tool steps when the run is manually stopped so cards never stick on “Running”.
- Ensure local Terminal starts even when the pane is hidden; surface spawn errors in chat/footer and leave the stuck “Shell starting” state with a retry action.
- Replace soft “batch collection” system-prompt rules with a short hard rule that multi-readonly acquisition must share one bash call.
- Protect `$(...)` and backtick regions in `splitShellSegments` so inner `;` no longer mis-splits readonly batch scripts.
- Remove `skill_templates` SQLite/IPC/SkillsSheet; SkillManager and WikiSheet remain the management surfaces.
- Merge SOP into Wiki single storage with run injection (`activeWikiIds`, 4000-char cap).
- Batch readonly bash scripts in a single tool call: quote-aware split, separator injection, structured output for the model and Timeline.
- Expand READONLY classification for common kubectl/docker/linux/systemctl inspection commands.
- System prompt: referenced Skills/SOP are reference-only; don’t force full playbooks on simple tasks.
- Wiki sheet description points to `~/.crescent/wiki`.
- Connection/terminal state now has a single source of truth per terminal (mode, expected host, learned prompt-host aliases, alignment, ready); gate, recovery, status bar, route and model context all read the same state. IP-expected / hostname-observed sessions (e.g. expected `192.0.2.10`, prompt `node-1`) are recognized as aligned after login.
- Recovery brakes: at most one re-login attempt per drift event and two per 60 s window; already-connected terminals are never stopped and re-logged; when attempts are exhausted a single recovery card is shown.
- Subterminal SSH logins write the result back to the parent terminal (learned alias + aligned/ready), clearing stale “disconnected” state.
- PIPE fallback allows one-shot non-interactive ssh (BatchMode or a remote command without `-t`) while interactive login keeps its accurate PTY-required copy; node-pty failure auto-reinitializes once before settling on PIPE.
- Exit-to-local detection uses the newest prompt signal, so a local `➜ ~` prompt is recognized as drifted even when older remote prompts remain in the buffer; pending password prompts yield no alignment verdict.
- Run settle copy distinguishes user stop from system recovery / gate interrupt / timeout; only a real user stop says “manually stopped”.
- System entries (reconnect, login actions, connection switching) merge into the run timeline in monotonic order; streaming/thinking indicators render at the newest content position with auto-follow scroll (paused only while the user actively scrolls).
- Toast policy: messages needing user intervention (errors) stay twice as long as plain result notifications.

### Fixes

- Busy-path supplements also append a visible user bubble.
- Busy-path follow-ups render as inline `user-supplement` blocks inside the active run card (no top-level user bubble).
- CRESCENT_RUN_V2 envelopes never render as raw markdown; corrupt envelopes show an error card and are stripped from model context.
- SSH terminal not-ready waits for ready (≤15s) or opens a clarification card with “manual login continue” / “open connections”; local shells skip the SSH wait.
- Login continuation no longer fails with “登录后任务未启动” after a successful password login: readiness checks only the newest line, so an answered password prompt no longer blocks the run.
- Re-login no longer aborts on the fresh terminal’s transient local prompt before ssh connects.

## v1.0.2

### Hotfix

- Dropped macOS universal packaging from release CI and local scripts; ship separate arm64 and x64 mac builds instead (native `.node` modules kept failing universal merge).
