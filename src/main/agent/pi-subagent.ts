import { Type } from 'typebox'
import type { WebContents } from 'electron'

import { safeWebContentsSend } from '../safe-ipc-send'
import {
  closeTemporarySubterminal,
  listTemporarySubterminalNames,
  MAX_TEMPORARY_SUBTERMINALS
} from '../terminal/ipc'
import { buildInvariantAgentPrompt } from '../../shared/agent-prompt-discipline'
import { extractAssistantTextFromMessages, mapPiSessionEventToAgentEvents } from './pi-event-bridge'
import { resolveAgentWorkspaceCwd } from './pi-cwd'
import { createCrescentSettingsManager } from './pi-packages'
import {
  resolvePiModel,
  resolveThinkingLevelForModel,
  syncCrescentProvidersToModelRuntime
} from './pi-model-runtime'
import { loadPiAi, loadPiSdk, type PiSdkFacade } from './pi-sdk'
import { buildLocalInstructionContext } from './instruction-files'
import {
  bindPtyBashExecContextClone,
  clearPtyBashExecContext,
  createPtyBashToolDefinition,
  getPtyBashExecContext
} from './pi-terminal-bash'
import { openAgentSubterminal, resolveOpenSubterminalParentTabId } from './pi-open-subterminal'
import {
  childProfileOmitsHostTools,
  profileHasWriters,
  resolveSubagentProfile,
  SUBAGENT_PROFILE_NAMES,
  type SubagentProfile,
  type SubagentProfileName
} from './subagent-profiles'

export const SUBAGENT_DISCIPLINE = [
  '# Multi-agent',
  'Before acting on a user request, decide solo vs multi-agent. Do not wait for the user to enable a mode or ask for subagents.',
  '',
  'Enter multi-agent when it raises quality or cuts wall-clock time:',
  '- Two or more independent workstreams (multi-host / cluster fan-out, compare A vs B, separate trees)',
  '- Specialist roles (scout/researcher then reviewer; parallel read-only gathers)',
  '- Broad investigation that would serialize slowly on the parent',
  '',
  'Stay solo when:',
  '- Single-path sequential work, one environment, one command sequence',
  '- Short Q&A, small edit, or a single bash/read',
  '- No remaining docked panes (max 3)',
  '',
  'If multi-agent: you MUST call the subagent tool. The host binds each child to its own docked subterminal; parent bash stays on the current pane.',
  'Never fake multi-agent with concurrent bash on one pane.',
  'Never spawn child agents via open_subterminal alone — that tool is extra panes for THIS agent (local hosts / extra SSH).',
  '',
  'Parallel tasks[] only for independent read-only work (scout, reviewer, oracle, researcher).',
  'Run worker / delegate sequentially — do not parallelize writers.',
  'Children must not spawn further subagents.'
].join('\n')

const MAX_CHILD_RESULT_CHARS = 8_000

export interface SubagentTask {
  agent: SubagentProfileName
  task: string
}

export interface SubagentChildResult {
  agent: SubagentProfileName
  pane: string
  tabId?: string
  ok: boolean
  text?: string
  error?: string
}

interface ChildSessionHandle {
  abort: () => Promise<void>
  dispose: () => void
}

const childrenByRunId = new Map<string, Set<ChildSessionHandle>>()

export function childSubagentSessionKey(parentSessionKey: string, childId: string): string {
  return `${parentSessionKey}::subagent:${childId}`
}

export function isChildSubagentSessionKey(sessionKey: string): boolean {
  return sessionKey.includes('::subagent:')
}

export function normalizeSubterminalPaneName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, '-').slice(0, 40)
  return normalized || 'temporary'
}

export function parseSubagentToolParams(
  params: unknown
): { ok: true; tasks: SubagentTask[] } | { ok: false; error: string } {
  if (!params || typeof params !== 'object') {
    return { ok: false, error: 'Invalid subagent parameters.' }
  }
  const record = params as {
    agent?: unknown
    task?: unknown
    tasks?: unknown
  }
  const hasTasks = Array.isArray(record.tasks) && record.tasks.length > 0
  const hasSingle = Boolean(record.agent && record.task)
  if (hasTasks === hasSingle) {
    return {
      ok: false,
      error: 'Provide exactly one of { agent, task } or { tasks: [{ agent, task }, ...] }.'
    }
  }

  const raw = hasSingle ? [{ agent: record.agent, task: record.task }] : (record.tasks as unknown[])

  const tasks: SubagentTask[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'Each task must be { agent, task }.' }
    }
    const entry = item as { agent?: unknown; task?: unknown }
    const agent = String(entry.agent ?? '')
      .trim()
      .toLowerCase()
    const task = String(entry.task ?? '').trim()
    const profile = resolveSubagentProfile(agent)
    if (!profile) {
      return {
        ok: false,
        error: `Unknown agent "${agent}". Available: ${SUBAGENT_PROFILE_NAMES.join(', ')}.`
      }
    }
    if (!task) return { ok: false, error: 'Each task must include a non-empty task string.' }
    tasks.push({ agent: profile.name, task })
  }
  return { ok: true, tasks }
}

export function allocateSubagentPaneNames(input: {
  agents: string[]
  existingNames: string[]
  max?: number
}): { ok: true; names: string[] } | { ok: false; error: string } {
  const max = input.max ?? MAX_TEMPORARY_SUBTERMINALS
  const existing = new Set(input.existingNames.map(normalizeSubterminalPaneName))
  const batch = new Set<string>()
  const names: string[] = []

  for (const agent of input.agents) {
    const base = normalizeSubterminalPaneName(agent)
    let candidate = base
    let suffix = 2
    // Never reuse an existing pane name — wrong mode / busy / user panes are unsafe.
    while (existing.has(candidate) || batch.has(candidate)) {
      candidate = normalizeSubterminalPaneName(`${base}-${suffix}`)
      suffix += 1
    }
    batch.add(candidate)
    names.push(candidate)
  }

  if (existing.size + names.length > max) {
    return {
      ok: false,
      error: `At most ${max} sub-terminals per terminal. Reuse or close a pane, then retry.`
    }
  }
  return { ok: true, names }
}

/** Truncate string fields before stringify so parent models never see mid-JSON cuts. */
export function formatSubagentToolResultText(result: {
  ok: boolean
  results: SubagentChildResult[]
  error?: string
}): string {
  const budget = Math.max(
    512,
    Math.floor(MAX_CHILD_RESULT_CHARS / Math.max(1, result.results.length))
  )
  const compact = {
    ok: result.ok,
    error: result.error ? truncateText(result.error, 400) : undefined,
    results: result.results.map((child) => ({
      agent: child.agent,
      pane: child.pane,
      tabId: child.tabId,
      ok: child.ok,
      text: child.text ? truncateText(child.text, budget) : undefined,
      error: child.error ? truncateText(child.error, 400) : undefined
    }))
  }
  const text = JSON.stringify(compact, null, 2)
  if (text.length <= MAX_CHILD_RESULT_CHARS) return text
  return JSON.stringify(
    {
      ok: result.ok,
      truncated: true,
      error: result.error ? truncateText(result.error, 200) : 'Result truncated for size.',
      results: compact.results.map((child) => ({
        agent: child.agent,
        pane: child.pane,
        ok: child.ok,
        text: child.text ? truncateText(child.text, 200) : undefined,
        error: child.error ? truncateText(child.error, 120) : undefined
      }))
    },
    null,
    2
  ).slice(0, MAX_CHILD_RESULT_CHARS)
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

export function tasksIncludeWriters(tasks: SubagentTask[]): boolean {
  return tasks.some((task) => {
    const profile = resolveSubagentProfile(task.agent)
    return profile ? profileHasWriters(profile) : false
  })
}

export async function abortChildSessionsForRun(runId: string): Promise<void> {
  const handles = childrenByRunId.get(runId.trim())
  if (!handles) return
  await Promise.all(
    [...handles].map(async (handle) => {
      try {
        await handle.abort()
      } catch {
        // ignore child abort errors
      }
    })
  )
}

export function emitSubagentPaneStatus(input: {
  webContents: WebContents
  parentTabId: string
  tabId: string
  name: string
  agentName: string
  agentStatus: 'running' | 'done' | 'error'
}): void {
  if (!input.webContents || input.webContents.isDestroyed()) return
  safeWebContentsSend(input.webContents, 'agent:subagent-status', {
    parentTabId: input.parentTabId,
    tabId: input.tabId,
    name: input.name,
    agentName: input.agentName,
    agentStatus: input.agentStatus
  })
}

export async function createSubagentToolDefinition(
  pi: PiSdkFacade,
  parentSessionKey: string
): Promise<ReturnType<PiSdkFacade['defineTool']>> {
  const { StringEnum } = await loadPiAi()
  const agentEnum = StringEnum(SUBAGENT_PROFILE_NAMES)
  const taskItem = Type.Object({
    agent: agentEnum,
    task: Type.String({ description: 'Task to delegate to this child agent.' })
  })
  const parameters = Type.Object({
    agent: Type.Optional(agentEnum),
    task: Type.Optional(Type.String({ description: 'Task to delegate (single mode).' })),
    tasks: Type.Optional(
      Type.Array(taskItem, {
        description: 'Parallel independent tasks. Each child gets its own subterminal.'
      })
    )
  })

  return pi.defineTool({
    name: 'subagent',
    label: 'Subagent',
    description: [
      'Decide solo vs multi-agent first. Multi-agent MUST use this tool: each child gets its own docked subterminal. Parent bash stays on the current pane.',
      'Single: { agent, task }. Parallel: { tasks: [{ agent, task }, ...] } (max 3 panes).',
      `Agents: ${SUBAGENT_PROFILE_NAMES.join(', ')}.`,
      'Use parallel only for independent read-only work. Run worker sequentially. Do not spawn agents via open_subterminal.'
    ].join(' '),
    promptSnippet: 'subagent — run a focused child agent in a dedicated docked subterminal',
    promptGuidelines: [
      'Before acting, decide solo vs multi-agent. If multi-agent, call subagent — never open_subterminal merely to fan out agents.',
      'Each child already has its own docked subterminal; parent bash stays on the current pane.',
      'Call subagent with tasks[] only for independent read-only workstreams; keep worker sequential.',
      'Never run concurrent bash on the same terminal pane.'
    ],
    parameters,
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal) {
      const result = await runSubagentTool({
        parentSessionKey,
        params,
        signal
      })
      return {
        content: [{ type: 'text', text: formatSubagentToolResultText(result) }],
        details: result
      }
    }
  })
}

async function runSubagentTool(input: {
  parentSessionKey: string
  params: unknown
  signal?: AbortSignal
}): Promise<{
  ok: boolean
  results: SubagentChildResult[]
  error?: string
}> {
  const parsed = parseSubagentToolParams(input.params)
  if (!parsed.ok) return { ok: false, results: [], error: parsed.error }

  if (parsed.tasks.length > 1 && tasksIncludeWriters(parsed.tasks)) {
    return {
      ok: false,
      results: [],
      error:
        'Parallel tasks[] cannot include writer agents (worker / delegate). Run them sequentially, or use read-only agents only.'
    }
  }

  const parent = getPtyBashExecContext(input.parentSessionKey)
  if (!parent?.webContents || parent.webContents.isDestroyed()) {
    return {
      ok: false,
      results: [],
      error: 'No active agent terminal context. Start a run in a terminal session first.'
    }
  }

  const parentTabId = resolveOpenSubterminalParentTabId(parent.executionTabId)
  const existingNames = listTemporarySubterminalNames(parent.webContents, parentTabId)
  const allocated = allocateSubagentPaneNames({
    agents: parsed.tasks.map((task) => task.agent),
    existingNames
  })
  if (!allocated.ok) return { ok: false, results: [], error: allocated.error }

  const runOne = (task: SubagentTask, index: number): Promise<SubagentChildResult> =>
    runChildSubagent({
      parentSessionKey: input.parentSessionKey,
      childId: `${task.agent}-${index + 1}`,
      paneName: allocated.names[index] ?? task.agent,
      task,
      signal: input.signal
    })

  // Read-only profiles may fan out; writers are already rejected above when parallel.
  const results =
    parsed.tasks.length === 1
      ? [await runOne(parsed.tasks[0], 0)]
      : await Promise.all(parsed.tasks.map((task, index) => runOne(task, index)))

  const ok = results.every((result) => result.ok)
  return { ok, results, error: ok ? undefined : 'One or more subagents failed.' }
}

async function runChildSubagent(input: {
  parentSessionKey: string
  childId: string
  paneName: string
  task: SubagentTask
  signal?: AbortSignal
}): Promise<SubagentChildResult> {
  const profile = resolveSubagentProfile(input.task.agent)
  if (!profile) {
    return { agent: input.task.agent, pane: input.paneName, ok: false, error: 'Unknown agent.' }
  }
  if (!childProfileOmitsHostTools(profile)) {
    return {
      agent: profile.name,
      pane: input.paneName,
      ok: false,
      error: 'Child profile must not include host-only tools.'
    }
  }

  const parent = getPtyBashExecContext(input.parentSessionKey)
  if (!parent) {
    return {
      agent: profile.name,
      pane: input.paneName,
      ok: false,
      error: 'Parent terminal context is gone.'
    }
  }

  const mode = parent.isSsh && parent.connectionId ? 'ssh' : 'local'
  const opened = await openAgentSubterminal({
    sessionKey: input.parentSessionKey,
    params: {
      mode,
      name: input.paneName,
      connectionId: mode === 'ssh' ? parent.connectionId : undefined
    },
    signal: input.signal,
    rerouteParentBash: false,
    agentName: profile.name
  })
  if (!opened.ok || !opened.tabId) {
    return {
      agent: profile.name,
      pane: input.paneName,
      ok: false,
      error: opened.error || 'Failed to open subterminal.'
    }
  }

  const childKey = childSubagentSessionKey(input.parentSessionKey, input.childId)
  const bound = bindPtyBashExecContextClone({
    fromSessionKey: input.parentSessionKey,
    toSessionKey: childKey,
    executionTabId: opened.tabId,
    fromSubagent: true
  })
  if (!bound) {
    closeTemporarySubterminal(parent.webContents, opened.tabId)
    return {
      agent: profile.name,
      pane: opened.name || input.paneName,
      tabId: opened.tabId,
      ok: false,
      error: 'Failed to bind child terminal context.'
    }
  }

  const parentTabId = opened.parentTabId || resolveOpenSubterminalParentTabId(parent.executionTabId)
  emitSubagentPaneStatus({
    webContents: parent.webContents,
    parentTabId,
    tabId: opened.tabId,
    name: opened.name || input.paneName,
    agentName: profile.name,
    agentStatus: 'running'
  })

  let childStatus: 'done' | 'error' = 'error'
  try {
    const result = await runChildPiSession({
      parentSessionKey: input.parentSessionKey,
      childSessionKey: childKey,
      profile,
      task: input.task.task,
      signal: input.signal
    })
    childStatus = result.ok ? 'done' : 'error'
    return {
      agent: profile.name,
      pane: opened.name || input.paneName,
      tabId: opened.tabId,
      ok: result.ok,
      text: result.text,
      error: result.error
    }
  } finally {
    emitSubagentPaneStatus({
      webContents: parent.webContents,
      parentTabId,
      tabId: opened.tabId,
      name: opened.name || input.paneName,
      agentName: profile.name,
      agentStatus: childStatus
    })
    clearPtyBashExecContext(childKey)
  }
}

async function runChildPiSession(input: {
  parentSessionKey: string
  childSessionKey: string
  profile: SubagentProfile
  task: string
  signal?: AbortSignal
}): Promise<{ ok: boolean; text?: string; error?: string }> {
  const parent = getPtyBashExecContext(input.parentSessionKey)
  if (!parent) return { ok: false, error: 'Parent terminal context is gone.' }
  if (input.signal?.aborted) return { ok: false, error: 'Agent run was canceled.' }

  const pi = await loadPiSdk()
  const cwd = resolveAgentWorkspaceCwd(parent.config)
  const { settingsManager, agentDir } = await createCrescentSettingsManager(cwd)
  const modelRuntime = await syncCrescentProvidersToModelRuntime(parent.config)
  const model = await resolvePiModel(parent.config, modelRuntime)
  if (!model) {
    return { ok: false, error: 'No model available for the child agent.' }
  }

  const ptyBashTool = createPtyBashToolDefinition(pi, cwd, input.childSessionKey)
  const instructionContext = buildLocalInstructionContext()
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    systemPromptOverride: (base) =>
      buildInvariantAgentPrompt({
        base: [base ?? '', input.profile.systemPrompt].filter(Boolean).join('\n\n'),
        instructionContext
      })
  })
  await resourceLoader.reload()

  const { session } = await pi.createAgentSession({
    cwd,
    agentDir,
    model,
    thinkingLevel: resolveThinkingLevelForModel(model),
    modelRuntime,
    resourceLoader,
    tools: [...input.profile.tools],
    customTools: [ptyBashTool as never],
    sessionManager: pi.SessionManager.inMemory(cwd),
    settingsManager
  })

  const handle: ChildSessionHandle = {
    abort: () => session.abort(),
    dispose: () => session.dispose()
  }
  rememberChildHandle(parent.runId, handle)

  const unsubscribe = session.subscribe((event) => {
    for (const agentEvent of mapPiSessionEventToAgentEvents(event, {
      runId: parent.runId,
      tabId: parent.chatTabId,
      locale: parent.locale,
      fromSubagent: true
    })) {
      if (agentEvent.type === 'token' || agentEvent.type === 'thought') continue
      parent.emit(agentEvent)
    }
  })

  const abortChild = (): void => {
    void session.abort()
  }
  if (input.signal?.aborted) {
    abortChild()
  } else {
    input.signal?.addEventListener('abort', abortChild, { once: true })
  }

  try {
    session.setThinkingLevel(resolveThinkingLevelForModel(model))
  } catch {
    // ignore unsupported thinking levels
  }

  try {
    await session.prompt(input.task)
    if (input.signal?.aborted) return { ok: false, error: 'Agent run was canceled.' }
    const text = extractAssistantTextFromMessages(session.messages as unknown[]).trim()
    if (!text) return { ok: false, error: 'Child agent returned no text.' }
    return { ok: true, text: text.slice(0, MAX_CHILD_RESULT_CHARS) }
  } catch (error) {
    if (input.signal?.aborted) return { ok: false, error: 'Agent run was canceled.' }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    input.signal?.removeEventListener('abort', abortChild)
    forgetChildHandle(parent.runId, handle)
    try {
      unsubscribe()
    } catch {
      // ignore
    }
    try {
      session.dispose()
    } catch {
      // ignore
    }
  }
}

function rememberChildHandle(runId: string, handle: ChildSessionHandle): void {
  const key = runId.trim()
  let set = childrenByRunId.get(key)
  if (!set) {
    set = new Set()
    childrenByRunId.set(key, set)
  }
  set.add(handle)
}

function forgetChildHandle(runId: string, handle: ChildSessionHandle): void {
  const key = runId.trim()
  const set = childrenByRunId.get(key)
  if (!set) return
  set.delete(handle)
  if (set.size === 0) childrenByRunId.delete(key)
}
