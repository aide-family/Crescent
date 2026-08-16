---
name: crescent-login-intent
description: >-
  Identifies when Crescent should open SSH versus stay on the current terminal.
  Use when changing connection routing, login automation, post-login tasks,
  local-vs-remote classification, lastUsed fallbacks, session drift reconnect,
  or when a request wrongly starts or skips SSH.
---

# Crescent login intent

Connect only when login intent is **identified**. Do not guess. Do not add scenario allowlists (URLs, tool names, “打开网页”) as the policy.

Code: `src/renderer/src/lib/connection-route.ts`, `src/renderer/src/lib/agent-input.ts`, `src/shared/agent-local-intent.ts`, `src/main/agent/connection-intent.ts`, `src/renderer/src/App.tsx` (submit / post-login).

## When to open SSH

1. User named a configured connection, or `@` mentioned a tab/connection.
2. User explicitly asked to log in / connect / ssh / 登录 / 连接 / 切换到, and a target is resolved.
3. Current session already has that SSH tab → **reuse or switch**, do not create a new login.
4. Active SSH session **drifted** → reconnect **the same** connection, not a different host.

## When not to open SSH

- No named host and no explicit login request → stay on the current terminal.
- Local work: `本地` / `本机` plus `~/` / `$HOME` / git inspect, or hosts-file edits. Path fragments such as `aide-family` are not the connection `aide`.
- Generic verbs such as `打开` / `open` are not login intent.
- Agent-native tools (extensions, Wiki, MCP host tools) do not imply SSH.

## When the target is unclear

- Explicit login but the name matches no configured connection → **clarify**, never lastUsed, never “the only host”.
- Model says `shouldConnect=false` → trust it, unless the user explicitly asked to log in; then clarify.
- Remote-looking work (`kubectl`, 集群, 巡检) with no login intent and no existing session SSH → LLM may decide; do **not** override with lastUsed or unique-host auto-connect.

## Do not

- Treat keyword soup (`打开`, 集群, kubectl) as “must log in”.
- Silent-connect `lastUsedConnectionId` or the only configured host for non-login requests.
- Bypass lists for `https://`, `fetch_content`, `web_search` as a substitute for the rules above.
- Invent a login method in the main agent when the user asked to log in but no target was chosen — show the connection picker.

## Tests

Cover both sides in `connection-route.test.ts` / `connection-intent.test.ts` / `agent-local-intent.test.ts`:

- Named login still connects (e.g. `登录demo集群` → zhangke).
- Unmatched explicit login clarifies.
- No login intent + lastUsed present → no connect (`fetch_content 打开 https://…`, local git path with `aide` in it).
- Existing session SSH for cluster work → switch/reuse, not a new login.
