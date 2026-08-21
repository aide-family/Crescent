---
name: pi-dev
description: Develop, extend, or integrate applications with the Pi agent toolkit (earendil-works/pi) — unified LLM API (pi-ai), agent runtime (pi-agent-core), interactive coding agent (pi-coding-agent), extensions, skills, prompt templates, themes, remote protocol, SQLite session backends, and model-backed evals. Use whenever the user asks to build an agent, write a Pi extension or skill, integrate an LLM provider, create a coding-agent workflow, add Pi packages, or evaluate Pi workflows. Also relevant when working in a cloned pi repo (monorepo under packages/).
---

# Pi Development (pi-dev)

Build, extend, and integrate applications on top of the **Pi agent toolkit**
(https://github.com/earendil-works/pi, package versions ~0.84.x, requires Node >= 22.19).

Favor: minimal working code first, official docs as source of truth, and verification after each change.
Reference local study docs at `~/Downloads/pi/docs/` (README + 13 chapters) and the cloned source at `~/Downloads/pi/src/`.

## Core Architecture (mental model)

```text
Application (CLI / SDK)         pi-coding-agent: interactive / print / JSON / RPC / SDK
  └─ Agent runtime              pi-agent-core: Agent class, agentLoop, tools, event stream
       └─ Unified LLM API       pi-ai: Models collection, Provider factories, streaming events
            └─ Infrastructure   pi-tui (terminal UI) · protocol/client/server (remote) · telemetry · session-backends
```

Key repos: `cloudwego`-style monorepo in `packages/{ai,agent,coding-agent,tui,telemetry,protocol,client,server,evals,session-backends/sqlite-node}`.
Design philosophy: **aggressively extensible, minimal core** — no MCP, sub-agents, permission popups, plan mode, TODO, or background bash by default; implement via extensions/skills instead.

## 1. pi-ai: Unified LLM API

Create a Models collection, get a model, stream or complete:

```typescript
import { Type, type Context, type Tool } from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'

const models = builtinModels() // register all built-in providers
const model = models.getModel('anthropic', 'claude-sonnet-4-5') // or 'openai','gpt-4o-mini'
const tools: Tool[] = [
  {
    name: 'get_time',
    description: 'Get current time',
    parameters: Type.Object({ timezone: Type.Optional(Type.String()) })
  }
]

const context: Context = {
  systemPrompt: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'What time is it?', timestamp: Date.now() }],
  tools
}

const s = models.stream(model, context) // async iterator of events
for await (const event of s) {
  if (event.type === 'text_delta') process.stdout.write(event.delta)
  if (event.type === 'toolcall_end') console.log('\nTool:', event.toolCall.name)
}
const finalMessage = await s.result() // assistant message
console.log(`Cost: $${finalMessage.usage.cost.total.toFixed(4)}`)
```

Streaming events: `start`, `text_start/delta/end`, `thinking_*`, `toolcall_*`, `done`, `error`.
Correlate content blocks by `contentIndex` (delays are NOT contiguous across blocks).
Non-streaming: `models.complete(model, context)`. Simplified: `streamSimple` / `completeSimple`.
Stop reasons: `pending | stop | length | toolUse | error | aborted`.

Custom provider (Ollama/self-hosted or any OpenAI-compatible API):

```typescript
import { createModels, createProvider, envApiKeyAuth, type Model } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'

const model: Model<'openai-completions'> = {
  id: 'llama-3.1-8b',
  name: 'Llama 8B',
  api: 'openai-completions',
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 32000
}
const ollama = createProvider({
  id: 'ollama',
  name: 'Ollama',
  baseUrl: 'http://localhost:11434/v1',
  auth: { apiKey: { name: 'Ollama', resolve: async () => ({ auth: {} }) } },
  models: [model],
  api: openAICompletionsApi()
})
const models = createModels()
models.setProvider(ollama)
```

Auth: stored credentials first, then first set env var (e.g. `OPENAI_API_KEY`). OAuth: Anthropic/OpenAI Codex/GitHub Copilot/OpenRouter.
Cross-provider handoff: keep one `Context`, push each assistant message, next provider auto-converts thinking blocks to `<thinking>` tags.

## 2. pi-agent-core: Agent Runtime

Stateful agent with tools and an event stream:

```typescript
import { Agent } from '@earendil-works/pi-agent-core'
import { createModels } from '@earendil-works/pi-ai'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'

const models = createModels()
models.setProvider(anthropicProvider())
const agent = new Agent({
  initialState: {
    systemPrompt: 'You are a helpful assistant.',
    model: models.getModel('anthropic', 'claude-sonnet-4-5')!
  },
  streamFn: models.streamSimple.bind(models)
})

agent.subscribe((event) => {
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta')
    process.stdout.write(event.assistantMessageEvent.delta)
})

await agent.prompt('Hello!') // also: prompt(msg, attachments), prompt([messages]), agent.abort(), agent.pause(), agent.settle()
```

- Two message layers: `AgentMessage` (flexible) vs LLM `Message`; pipeline `transformContext()` then `convertToLlm()`.
- Event sequence: `agent_start → turn_start → message_start/update/end → turn_end → tool_execution_* → agent_end`.
- Tool execution: `parallel` (default) or `sequential`; hooks `beforeToolCall` / `afterToolCall` (can `{block:true,reason}` or `terminate:true`) / `shouldStopAfterTurn`.
- Steering: `new AgentController(agent.state, { streamFn, beforeSteering, beforeAgentEnd })` → `controller.update({systemPrompt})` / `controller.run()` — interrupt mid-loop and redirect.
- Low-level: `agentLoop(...)` / `agentLoopContinue(agentState, toolResults, ...)` for custom runtimes.

## 3. pi-coding-agent: Interactive Coding Agent

Four run modes: `pi` (interactive TUI), `pi -p "..."` (print), `pi --mode json` (JSON events), `pi --mode rpc` (RPC frames), plus SDK embedding.
Context files: `AGENTS.md` (global `~/.pi/agent/AGENTS.md` + parent dirs + cwd; `AGENTS.override.md` wins; `--no-context-files` to disable).
Settings: `~/.pi/agent/settings.json` (global) and `.pi/settings.json` (project). Project trust gates project-level resources.

SDK embedding:

```typescript
import { createAgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
const modelRuntime = await ModelRuntime.create()
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime
})
await session.prompt('What files are in the current directory?')
session.subscribe((event) => {
  /* observe */
})
```

## 4. Extensions (the heart of Pi)

Extension = a TypeScript file. Locations: `~/.pi/agent/extensions/` (global), `.pi/extensions/` (project), or `-e <path>`.
Quick start template:

```typescript
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

export default function (pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => ctx.ui.notify('Loaded!', 'info'))
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName === 'bash' && event.input.command?.includes('rm -rf'))
      return { block: true, reason: 'Blocked by user' } // block dangerous tools
  })
  pi.registerTool({
    name: 'greet',
    label: 'Greet',
    description: 'Greet someone by name',
    parameters: Type.Object({ name: Type.String({ description: 'Name' }) }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return { content: [{ type: 'text', text: `Hello, ${params.name}!` }], details: {} }
    }
  })
  pi.registerCommand('hello', {
    description: 'Say hello',
    handler: async (args, ctx) => ctx.ui.notify(`Hello ${args || 'world'}!`, 'info')
  })
}
// test: pi -e ./my-extension.ts
```

- Events: lifecycle (`extension_load/startup/shutdown`), session/agent/model/tool/user_bash/input groups, resource events. Handlers may return `{block,reason}`; `{priority}` orders handlers.
- `ExtensionContext` (ctx): `ui` (notify/confirm/input), `mode`, `cwd`, `isProjectTrusted()`, `sessionManager`, `modelRegistry`, `signal`, `compact()`, `getSystemPrompt()`, `abort()`.
- `registerMiddleware` (tool wrapper `before/after`, or `buildSystemPrompt`), plus `registerModelProvider/registerModel/registerSkill/registerPromptTemplate/registerTheme/registerPackage`.

## 5. Skills, Prompt Templates, Themes, Pi Packages

**Skill** = a directory with a README-style `SKILL.md` + executable `bin/` (shell/python/etc.) — Pi calls it as a CLI, not MCP:

```text
my-skill/
├── SKILL.md    # frontmatter(name,description) + ## Setup + ## Usage + guidance
└── bin/        # entry script
```

```markdown
---
name: brave-search
description: Search the web using Brave Search. Use when the user asks to search the internet or verify current facts.
---

## Setup

Install `curl`; set `BRAVE_API_KEY`.

## Usage

`bin/search.sh "$@"`
```

Install from repo: `pi --skills <repo-url>`. Validate: `pi --validate-skill <path>`.
Skills live in `~/.pi/agent/skills/`, `.pi/skills/`, or `/users/<me>/.pi/skills/`.

**Prompt template** = reusable instruction with `{{variable}}` placeholders (`~/.pi/agent/prompts/`, `.pi/prompts/`).
**Theme** = CSS-variable-based terminal theme object (`registerTheme`, `/themes`).
**Pi Package** = npm-distributable bundle of extensions/skills/templates/themes (`pi pkg create|install|update|remove|publish`).

## 6. Sessions, Compaction, Remote Protocol

- Sessions: JSONL tree files under `~/.pi/agent/sessions/`; branching via `/tree`, `/fork`, `/clone`; summaries on branch switch.
- Compaction: auto at ~70% context, manual `/compact`, or `ctx.compact()`; compresses old turns into a structured summary.
- Remote: `pi-protocol` (length-prefixed CBOR, 4-byte BE length + CBOR; hello handshake; snapshots are authoritative, progress is transient), `pi-client` (PiClient + SessionLease exclusive/shared), `pi-server` (experimental; implement `PiServerService`).
- SQLite backend: `@earendil-works/pi-session-backend-sqlite-node` — `new SqliteSessionRepository(options)` + `createSqliteSessionSearch(options)`; branch materialization + writer leases for concurrency.

## 7. Model-backed Evals

Run: `npm run eval -- --provider openai --model gpt-5.6-sol` (or `PI_PROVIDER`/`PI_MODEL`); forward vitest args after `--`.
Write: `createPiCodingAgentHarness` + `describeEval` from `vitest-evals`; runs a real isolated session in temp dirs with zero extensions, thinking off, strict result checks (stopReason `stop`, non-empty output), transcript events, token/cost usage, and session JSONL artifact.

```typescript
import { describeEval } from 'vitest-evals'
import { createPiCodingAgentHarness } from './pi-harness.ts'
const harness = createPiCodingAgentHarness({ noTools: 'all' })
describeEval('Pi smoke', { harness }, (it) => {
  it('answers a factual question', async ({ run }) => {
    const r = await run("What's the capital of France? Respond with only the city name.")
    expect(r.output.trim()).toBe('Paris')
  })
})
```

## Engineering Conventions (when working in the pi monorepo)

- Node >= 22.19; TypeScript **erasable-only** syntax (no `enum`/`namespace`/`import =`) — Node strip-only mode.
- Direct deps pinned to exact versions; `npm install --ignore-scripts` / `npm ci --ignore-scripts`.
- Verify with `npm run check` (full output) after code changes; never `npm run build`/`npm test` unless asked; use `./test.sh` or targeted tests (faux provider for coding-agent suites; never real paid tokens).
- Never modify `packages/ai/src/models.generated.ts` directly — edit `packages/ai/scripts/generate-models.ts` and regenerate.
- Do not commit unless asked; stage explicit paths only.

## Checklist Before Finishing

1. `npm run check` passes (no errors/warnings/infos) for touched packages.
2. Auth/API keys are not hardcoded; use env vars or credential store.
3. Streaming events correlate content blocks via `contentIndex` (do not assume contiguous sequences).
4. Errors surface as events (not throws) for streaming; `abort` is handled via AbortSignal.
5. Extension handlers that can block return `{block:true, reason}`; UI calls guarded when `!ctx.hasUI`.
6. Reference this skill's sections above; full docs: `~/Downloads/pi/docs/` and https://github.com/earendil-works/pi.
