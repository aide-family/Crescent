# Changelog

## Unreleased

### Skills

- Removed bundled `system-skills`. Agent skills come from the configured skill directory and optional `~/.agents/skills`.
- Skill manager can import a local `SKILL.md` file or skill directory into the configured skill root.

### Terminal / SSH

- Connection manager keeps the editor collapsed until a card is selected; clicking the same card hides it again.
- Connection card actions sit in the footer; delete stays at the top-right corner.

### Desktop

- Sheets other than Settings open from the left.

## v1.0.8 (2026-08-20)

### Capture / Knowledge

- Capture a turn or session as an SOP or Skill draft (`/create-sop`, `/create-skill`, or phrases like 存成 SOP / 转成 skill). The host intercepts the request, generates in the background, and writes only after confirm. `/sop` still matches the create-sop command.
- Open a ready draft from the chat row or a pin while the agent is busy; edit the markdown, add notes for AI refine, and overwrite a same-named skill if needed.
- History can turn a stored session into a Skill draft as well as a wiki SOP.
- SOP generation waits up to 180s, revises from operator notes, and requires a specific title. Failed generation no longer saves raw seed text into the wiki.

### Skills

- Default skill root is `~/.crescent/skills`. Configurations still pointing at `~/.agents/skills` migrate automatically; optionally load that global directory read-only.
- New skills from capture save into the configured skill root.
- Skill manager preview strips YAML frontmatter and renders the SKILL.md body.

### Slash / Runtime

- `/reload` rebuilds idle agent runtimes so skills, wiki, MCP, and extensions pick up without restarting the app. Busy sessions are left as-is.
- Agent prompt rules treat SOP/Skill capture as a host draft flow; the model must not write SOP or SKILL.md via bash or file tools.

### Terminal / SSH

- Multi-step SSH login actions wait until a password or host-key prompt is consumed before typing the next line.
- Prompt-host and terminal-ready checks use the newest prompt signal so a password prompt is not treated as a ready shell.
- Saving a custom connection with a duplicate name offers rename or overwrite instead of inserting a second card.

### Desktop

- IME-safe fields keep in-progress pinyin composition in capture drafts and password prompts.
- Connection form fields stay selectable while read-only.
- Footer no longer shows the working-style label; style remains in Settings.

### Tests / Reliability

- Added and extended tests for capture intent, draft UI, skill generation, IME commit, login-action wait, connection-name conflict, and skill-root migration.

## v1.0.7 (2026-08-18)

### Terminal / SSH

- Stabilize SSH EnvGuard across hop transitions so prompt-host checks stay aligned with the live session.
- Parse SSH destinations correctly so `-p 22` is not treated as the host; port-like runtime anchors no longer poison EnvGuard alignment.
- Attention notifications can jump to the needing tab, and those tabs pulse for quicker focus.

### Agent / Command Review

- Classify inspection scripts by each simple command’s argv0 and real file redirects, so awk comparisons like `$5>0` and `echo` separators stay low-risk while writes still require approval.

### Settings / Desktop

- Settings prefs (agent style, thinking toggle, workspace cwd) autosave; the global footer Save button is removed. Provider, OpenAPI, and instruction editors still save explicitly.
- Dense list/sheet chrome for extensions, connections, history, and markdown code blocks; extension toggle buttons show the next action (enable/disable).

### Chores

- Ignore TypeScript incremental `*.tsbuildinfo` files in git.

## v1.0.6 (2026-08-17)

### Terminal / SSH

- SSH connections open only when the user named a host, explicitly asked to log in, or the session already has that SSH. Generic verbs like 打开 no longer guess `lastUsed`.
- Local inspect requests and git path fragments (for example `aide-family`) are not treated as SSH connection names.

### Agent / MCP / Extensions

- Paste Cursor `mcpServers` JSON to add HTTP or stdio MCP servers as cards; their tools join the Pi agent loop after save.
- Local and catalog Pi extensions load into the next agent run.

### Skills

- Skill manager uses scannable cards instead of nested sheets, and search results open a SKILL.md preview before install.

### Session / Observability

- Chat dock shows cumulative input/output token usage for the session.
- Export a redacted JSON trace of every run in the current session.

### Composer / Desktop

- Composer reference chips wrap in the same flow as typed text, keep a newline after a chip, and the empty input keeps three lines of height.
- Footer version opens the matching GitHub Release page.

### Tests / Reliability

- Added and extended tests for login intent, local-path SSH false positives, MCP wiring, extensions, skill preview, token usage, and session trace export.

## v1.0.5 (2026-08-14)

### Agent / Working Style

- Four working styles (`swift` / `concise` / `guided` / `teach`) control reply density only; execution speed, safety, and read-only batching stay full.
- Default style is `concise`. Style is stored on the chat tab so a mid-run settings change cannot mix contracts.
- Slash `/style:` can switch the active session style from the composer.

### Composer / References

- Skill, SOP, tool, and path references insert as inline chips at the caret, so quoted context stays aligned with the prompt text.
- Composer tokens persist with the message and render as badges in the run log.

### Desktop / Updates

- Native application menu adds About, Check for Updates, and Settings.
- Check-then-update lives in the menu and footer; installers download to the user’s Downloads folder instead of a prominent in-app update card.
- Footer shows the current working style and a quieter update affordance.

### UI

- Denser, keyboard-first desktop chrome across lists, forms, terminal tabs, and sheets.
- Language control is a toggle instead of a select; mermaid diagrams share the markdown dark tokens.

### Terminal / SSH

- First login to an IP (or other unverified target) accepts a non-local hostname prompt so confirm-login can learn the alias instead of waiting out a hostname mismatch.

### Tests / Reliability

- Added and extended tests for working styles, composer ref tokens, native menu, updater/installer download, agent message refs, prompt-host wait, and related prompt policy.

## v1.0.4 (2026-08-11)

### Terminal / SSH

- Multi-hop SSH login detection: login completion now waits for the final target host prompt instead of treating an intermediate jump host as the destination.
- Runtime host anchoring: the actual target host observed after login is recorded as the runtime anchor, so a static jump-host configuration no longer misleads environment checks.
- Subterminal SSH login success is written back to the parent terminal, correcting failed login cards and stale disconnected state.

### Security / Injection Guard

- The injection guard now evaluates the live prompt host from the terminal output buffer instead of relying on stale cached state, reducing false environment-drift verdicts during login transitions.
- Guard blocks now emit diagnostic logging with session context so drift causes are inspectable.

### Agent / Terminal Automation

- Login automation settles only after a stable remote prompt, improving state synchronization and run-card finalization after login.
- User input typed during login automation is merged into the post-login task instead of being lost.

### Tests / Reliability

- Added and extended tests for prompt host waiting, connection state, agent run timeline, agent log list, busy supplement, connection route, and related automation paths.

### Infrastructure

- CI and release workflows upgraded to Node 24-based GitHub Actions runtimes (no user-facing behavior change).

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
