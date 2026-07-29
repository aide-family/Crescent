---
name: crescent-agent-context-regression
description: 'Crescent Agent context-safety regression workflow: review and test agent routing, local-vs-remote intent, SSH connection matching, local file operations such as /etc/hosts, /dev/null artifact misclassification, raw user input rendering, command approval/rejection notes, password prompt detection, terminal command visibility, noisy MCP/tool catalog display, and skill-loading action details. Use when changing Crescent Agent behavior, fixing context routing bugs, or investigating cases where local content was treated as a remote cluster/SSH target.'
aliases:
  [
    'Crescent Agent context regression',
    'Crescent Agent safety regression',
    'Crescent 上下文安全回归',
    '本地操作误路由',
    'SSH 连接误匹配',
    'hosts 文件误识别',
    '/dev/null artifact regression',
    '动作明细回归检查',
    'MCP 工具噪音过滤'
  ]
---

# Crescent Agent Context Regression

Use this skill when changing or reviewing Crescent Agent behavior around context routing, skill loading, terminal execution, action details, or local-vs-remote intent.

## Goals

1. Prevent pasted local file content from being treated as a remote SSH target.
2. Keep local/current-terminal work separate from configured connection matching.
3. Preserve visible evidence in action details without showing unused MCP/tool catalogs.
4. Avoid misclassifying shell redirection targets such as `/dev/null` as document save paths.
5. Ensure password prompts, command approval notes, and command execution progress are visible to the user.

## Regression Cases

Cover these cases before shipping a related change:

- **Local hosts edit**: user pastes `cat /etc/hosts` output and asks to replace `192.168.10.168` with `192.168.10.169`. Treat IPs inside pasted file content as data. Do not match the `aide@192.168.10.168` SSH connection unless the user explicitly asks to connect to `aide` or that host.
- **Explicit local target precedence**: phrases such as `本地`, `local`, `this machine`, `/etc/hosts`, `~`, `$HOME`, `/Users`, and local shell prompts such as `➜  ~` override memory, previous cluster work, loaded skills, terminal history, and configured connection IPs.
- **Remote intent**: requests like `登录到 aide 集群，做一次巡检` may match the configured connection, but must clearly show why the connection was selected and continue only after login context is correct.
- **Artifact destination**: shell snippets such as `2>/dev/null`, `>/dev/null`, or command output mentioning `/dev/null` are redirection/noise unless the user explicitly asks to save a document there. Never attempt to create directories under `/dev/null`.
- **Raw user input display**: user-provided original text in chat should be displayed as plain/preformatted text, not Markdown-rendered demos.
- **Command approval notes**: when the user approves or rejects a command and enters a reason, include that reason in action details.
- **Password prompt**: terminal password prompts must surface a password modal instead of silently waiting in the terminal.
- **Local terminal execution**: when the local terminal option is selected, commands run in the local terminal from the user's default directory and the command process appears in action details.
- **MCP/tool catalog noise**: do not show full loaded MCP/tool catalogs in action details. Show concrete tool usage only when a tool was actually used.
- **Skill loading**: action details should distinguish action summary from action detail; default-expanded summary should not duplicate inner detail titles.

## Review Workflow

1. Identify which boundary changed:
   - intent parsing
   - connection matching
   - prompt building
   - skill selection
   - terminal execution
   - action detail rendering
   - artifact/document saving
2. Read the existing tests near the changed boundary before editing. Prefer adding a focused regression test next to the failing behavior.
3. Add or update tests using the concrete cases above. Use the user's original wording where possible, especially Chinese prompts and pasted shell output.
4. Keep fixes scoped:
   - intent rules belong in shared/main agent parsing modules
   - renderer display rules belong in renderer formatting/components
   - terminal prompt detection belongs in terminal text/runtime modules
   - skill matching rules belong in skill selection tests
5. Verify with `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.

## Safety Rules

- Do not use previous terminal context or memory to override an explicit local target.
- Do not infer remote intent from an IP address that appears only inside pasted file content.
- Do not hide command execution evidence from local terminal runs.
- Do not display unused tool catalogs as if they were actions.
- Do not introduce broad prompt-only fixes when a deterministic parser or regression test can enforce the behavior.

## Output

Summarize the changed boundary, the regression case covered, tests added or updated, and verification results.
