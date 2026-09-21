import { Type } from 'typebox'
import type { WebContents } from 'electron'

import { safeWebContentsSend } from '../safe-ipc-send'
import {
  closeTemporarySubterminal,
  openTemporarySubterminal,
  readTerminalSessionHealth,
  resolveParentTerminalTabId
} from '../terminal/ipc'
import {
  isMainTerminalHealthyForFanout,
  MAIN_TERMINAL_RESTORING_ERROR,
  shouldBlockToolsWhileMainRestoring
} from '../terminal/session-health'
import { listConnections } from '../connections/ipc'
import { loadPiAi, type PiSdkFacade } from './pi-sdk'
import {
  getFailedSshSubterminalConnectionIds,
  getPtyBashExecContext,
  recordFailedSshSubterminalConnection,
  updatePtyBashExecutionTabId
} from './pi-terminal-bash'

export const OPEN_SUBTERMINAL_DISCIPLINE = [
  '# 本机与子终端硬规范',
  '- 写本机 /etc/hosts、本机文件、应用运行环境配置：若当前可见终端是远程 SSH / 集群会话，禁止在远程改；必须先 open_subterminal(mode=local)，再在该子终端用 bash 执行（如 sudo tee -a /etc/hosts）。',
  '- 当前会话 SSH 断开或离开目标时，禁止对同一 connectionId 调用 open_subterminal(mode=ssh)。主机负责恢复主终端；在当前 pane 用 bash。',
  '- mode=ssh 只用于登录另一台已保存连接（不同 connectionId）；不要用子终端逃避当前连接的重连。',
  '- 识别到「写 hosts / 本机配置 / 本地执行」后立即调用工具并执行，禁止长篇无效分析替代落地。',
  '- workspace 的 write/edit 不能代替本机 /etc/hosts。',
  '- 同一终端禁止并行 bash / 并行键入：一个 pane 同时只能有一条 agent 命令。多路排查必须 open_subterminal 开新子终端后再 bash，禁止对同一 executionTabId 并发写入。',
  '- open_subterminal 只给当前智能体加窗格，不能用来拉起子智能体；多 agent 必须调用 subagent。'
].join('\n')

/** Local panes: soft-succeed on UI ack timeout so bash can still target the pane. */
export const LOCAL_SUBTERMINAL_READY_TIMEOUT_MS = 20_000
/** SSH panes: wait for login ack; timeout must fail (renderer login budget ~90s). */
export const SSH_SUBTERMINAL_READY_TIMEOUT_MS = 90_000

export type OpenSubterminalMode = 'local' | 'ssh'

export interface OpenSubterminalParams {
  mode: OpenSubterminalMode
  name?: string
  connectionId?: string
}

export interface AgentSubterminalOpenedPayload {
  parentTabId: string
  tabId: string
  name: string
  mode: OpenSubterminalMode
  terminalMode: 'pty' | 'pipe'
  connectionId?: string
  chatTabId?: string
  agentName?: string
  agentStatus?: 'running' | 'done' | 'error'
}

interface SubterminalReadyWaiter {
  resolve: (result: { ok: boolean; error?: string }) => void
  timeout: NodeJS.Timeout
  abortHandler?: () => void
  signal?: AbortSignal
}

const readyWaiters = new Map<string, SubterminalReadyWaiter>()

export function resolveAgentSubterminalReady(payload: {
  tabId?: string
  ok?: boolean
  error?: string
}): { ok: boolean } {
  const tabId = payload?.tabId?.trim()
  if (!tabId) return { ok: false }
  const waiter = readyWaiters.get(tabId)
  if (!waiter) return { ok: false }
  clearTimeout(waiter.timeout)
  if (waiter.signal && waiter.abortHandler) {
    waiter.signal.removeEventListener('abort', waiter.abortHandler)
  }
  readyWaiters.delete(tabId)
  waiter.resolve({ ok: Boolean(payload.ok), error: payload.error })
  return { ok: true }
}

/** Reject every in-flight open_subterminal ready waiter (e.g. on Stop). */
export function rejectAllSubterminalReadyWaiters(reason: string): number {
  return rejectSubterminalReadyWaiters(reason)
}

/** Reject ready waiters; optionally only for the given tab ids. */
export function rejectSubterminalReadyWaiters(
  reason: string,
  tabIds?: ReadonlySet<string> | readonly string[]
): number {
  const filter =
    tabIds === undefined
      ? undefined
      : tabIds instanceof Set
        ? tabIds
        : new Set([...tabIds].map((id) => id.trim()).filter(Boolean))

  let count = 0
  for (const [tabId, waiter] of readyWaiters.entries()) {
    if (filter && !filter.has(tabId)) continue
    clearTimeout(waiter.timeout)
    if (waiter.signal && waiter.abortHandler) {
      waiter.signal.removeEventListener('abort', waiter.abortHandler)
    }
    readyWaiters.delete(tabId)
    waiter.resolve({ ok: false, error: reason })
    count += 1
  }
  return count
}

export function waitForRendererReady(
  tabId: string,
  signal?: AbortSignal,
  timeoutMs = LOCAL_SUBTERMINAL_READY_TIMEOUT_MS,
  options?: { failOnTimeout?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const failOnTimeout = options?.failOnTimeout === true
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, error: 'Agent run was canceled.' })
      return
    }

    const existing = readyWaiters.get(tabId)
    if (existing) {
      clearTimeout(existing.timeout)
      if (existing.signal && existing.abortHandler) {
        existing.signal.removeEventListener('abort', existing.abortHandler)
      }
      readyWaiters.delete(tabId)
      existing.resolve({ ok: false, error: 'Superseded by a newer open_subterminal call.' })
    }

    let settled = false
    const finish = (result: { ok: boolean; error?: string }): void => {
      if (settled) return
      settled = true
      const current = readyWaiters.get(tabId)
      if (current) {
        clearTimeout(current.timeout)
        if (current.signal && current.abortHandler) {
          current.signal.removeEventListener('abort', current.abortHandler)
        }
        readyWaiters.delete(tabId)
      }
      resolve(result)
    }

    const timeout = setTimeout(() => {
      if (failOnTimeout) {
        finish({
          ok: false,
          error: 'Timed out waiting for UI ack (SSH login / pane ready).'
        })
        return
      }
      finish({
        ok: true,
        error: 'Timed out waiting for UI ack; bash will still target this subterminal.'
      })
    }, timeoutMs)

    const abortHandler = (): void => {
      finish({ ok: false, error: 'Agent run was canceled.' })
    }

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true })
    }

    readyWaiters.set(tabId, {
      resolve: finish,
      timeout,
      abortHandler: signal ? abortHandler : undefined,
      signal
    })
  })
}

export async function formatAvailableConnectionsHint(): Promise<string> {
  try {
    const connections = await listConnections()
    const remote = connections.filter((item) => item.source !== 'local' && item.host)
    if (remote.length === 0) return 'No saved remote connections.'
    return remote
      .slice(0, 20)
      .map((item) => `- id=${item.id} name=${item.name} host=${item.host}`)
      .join('\n')
  } catch {
    return 'Connection list unavailable.'
  }
}

/** Pure helper for tests: resolve parent tab from execution tab id. */
export function resolveOpenSubterminalParentTabId(executionTabId: string): string {
  return resolveParentTerminalTabId(executionTabId)
}

export { MAIN_TERMINAL_RESTORING_ERROR }

export const SAME_CONNECTION_SUBTERMINAL_ERROR =
  'Do not open_subterminal for the current session SSH connection. The host restores the main terminal; retry bash on the current pane after reconnect. Use mode=ssh only with a different saved connectionId.'

export const FAILED_SSH_SUBTERMINAL_RETRY_ERROR =
  'SSH subterminal login to this connection already failed in this run. Do not open another pane. Wait for the host to restore the main terminal, then retry bash there.'

export function shouldRefuseSameConnectionSshSubterminal(input: {
  mode: OpenSubterminalMode
  connectionId?: string
  parentConnectionId?: string
  rerouteParentBash: boolean
  /** Live + aligned main pane. Required for subagent same-connection SSH fan-out. */
  mainHealthy?: boolean
}): boolean {
  if (input.mode !== 'ssh') return false
  const wanted = input.connectionId?.trim()
  const parent = input.parentConnectionId?.trim()
  if (!wanted || !parent || wanted !== parent) return false
  // Model open_subterminal never shares the parent connectionId.
  if (input.rerouteParentBash) return true
  // Subagent same-connection SSH: only true parallel work on a healthy main.
  return input.mainHealthy !== true
}

export function shouldRefuseFailedSshSubterminalRetry(input: {
  mode: OpenSubterminalMode
  connectionId?: string
  failedConnectionIds?: ReadonlySet<string>
  rerouteParentBash: boolean
}): boolean {
  if (!input.rerouteParentBash) return false
  if (input.mode !== 'ssh') return false
  const id = input.connectionId?.trim()
  return Boolean(id && input.failedConnectionIds?.has(id))
}

export async function openAgentSubterminal(input: {
  sessionKey: string
  params: OpenSubterminalParams
  webContents?: WebContents
  signal?: AbortSignal
  /** When false, keep parent bash on the current pane (child subagent panes). Default true. */
  rerouteParentBash?: boolean
  agentName?: string
}): Promise<{
  ok: boolean
  tabId?: string
  name?: string
  mode?: 'local' | 'ssh'
  parentTabId?: string
  hint?: string
  error?: string
}> {
  if (input.signal?.aborted) {
    return { ok: false, error: 'Agent run was canceled.' }
  }

  const context = getPtyBashExecContext(input.sessionKey)
  const webContents = input.webContents ?? context?.webContents
  if (!context || !webContents || webContents.isDestroyed()) {
    return {
      ok: false,
      error: 'No active agent terminal context. Start a run in a terminal session first.'
    }
  }

  const mode = input.params.mode
  const connectionId = input.params.connectionId?.trim()
  if (mode === 'ssh' && !connectionId) {
    const hint = await formatAvailableConnectionsHint()
    return {
      ok: false,
      error: `mode=ssh requires connectionId. Available connections:\n${hint}`
    }
  }

  if (mode === 'ssh' && connectionId) {
    const connections = await listConnections({ forceRefreshSecrets: true })
    const connection = connections.find((item) => item.id === connectionId)
    if (!connection) {
      const hint = await formatAvailableConnectionsHint()
      return {
        ok: false,
        error: `Unknown connectionId "${connectionId}". Available connections:\n${hint}`
      }
    }
    if (connection.source === 'local' || !connection.host) {
      return {
        ok: false,
        error: `Connection "${connectionId}" is local-only; use mode=local instead.`
      }
    }
  }

  if (input.signal?.aborted) {
    return { ok: false, error: 'Agent run was canceled.' }
  }

  const rerouteParentBash = input.rerouteParentBash !== false
  const parentTabId = resolveOpenSubterminalParentTabId(context.executionTabId)
  const health = readTerminalSessionHealth(webContents.id, parentTabId)
  if (shouldBlockToolsWhileMainRestoring(health)) {
    return { ok: false, error: MAIN_TERMINAL_RESTORING_ERROR }
  }
  const parentConnectionId =
    context.parentConnectionId?.trim() || (context.isSsh ? context.connectionId?.trim() : undefined)
  const mainHealthy = isMainTerminalHealthyForFanout(health)
  if (
    shouldRefuseSameConnectionSshSubterminal({
      mode,
      connectionId,
      parentConnectionId,
      rerouteParentBash,
      mainHealthy
    })
  ) {
    return {
      ok: false,
      error: rerouteParentBash ? SAME_CONNECTION_SUBTERMINAL_ERROR : MAIN_TERMINAL_RESTORING_ERROR
    }
  }
  if (
    shouldRefuseFailedSshSubterminalRetry({
      mode,
      connectionId,
      failedConnectionIds: getFailedSshSubterminalConnectionIds(context.runId),
      rerouteParentBash
    })
  ) {
    return { ok: false, error: FAILED_SSH_SUBTERMINAL_RETRY_ERROR }
  }

  const name =
    input.params.name?.trim() ||
    (mode === 'local' ? 'local-hosts' : `ssh-${(connectionId ?? 'remote').slice(0, 24)}`)

  const opened = openTemporarySubterminal(webContents, parentTabId, name)
  if (!opened.ok || !opened.tabId) {
    return {
      ok: false,
      error: opened.error || 'Failed to open subterminal.'
    }
  }

  if (input.signal?.aborted) {
    closeTemporarySubterminal(webContents, opened.tabId)
    return {
      ok: false,
      tabId: opened.tabId,
      name: opened.name || name,
      mode,
      parentTabId,
      error: 'Agent run was canceled.'
    }
  }

  const payload: AgentSubterminalOpenedPayload = {
    parentTabId,
    tabId: opened.tabId,
    name: opened.name || name,
    mode,
    terminalMode: opened.mode ?? 'pipe',
    connectionId: mode === 'ssh' ? connectionId : undefined,
    chatTabId: context.chatTabId,
    agentName: input.agentName?.trim() || undefined,
    agentStatus: input.agentName ? 'running' : undefined
  }
  safeWebContentsSend(webContents, 'agent:subterminal-opened', payload)

  const readyTimeoutMs =
    mode === 'ssh' ? SSH_SUBTERMINAL_READY_TIMEOUT_MS : LOCAL_SUBTERMINAL_READY_TIMEOUT_MS
  const ready = await waitForRendererReady(opened.tabId, input.signal, readyTimeoutMs, {
    failOnTimeout: mode === 'ssh'
  })
  if (!ready.ok) {
    closeTemporarySubterminal(webContents, opened.tabId)
    const canceled = ready.error === 'Agent run was canceled.'
    if (mode === 'ssh' && connectionId && rerouteParentBash && !canceled) {
      recordFailedSshSubterminalConnection(context.runId, connectionId)
    }
    return {
      ok: false,
      tabId: opened.tabId,
      name: payload.name,
      mode,
      parentTabId,
      error: ready.error || 'Agent run was canceled.'
    }
  }

  if (rerouteParentBash) {
    updatePtyBashExecutionTabId(input.sessionKey, opened.tabId, {
      isSsh: mode === 'ssh',
      connectionId: mode === 'ssh' ? connectionId : undefined
    })
  }

  const hintParts: string[] = []
  if (rerouteParentBash) {
    hintParts.push(
      `Subsequent bash commands now run in subterminal "${payload.name}" (${opened.tabId}).`
    )
  } else {
    hintParts.push(
      `Subterminal "${payload.name}" (${opened.tabId}) is ready; parent bash stays on the current pane.`
    )
  }
  hintParts.push(
    mode === 'local'
      ? 'Use bash here for local /etc/hosts and other client-machine work (e.g. sudo tee -a /etc/hosts).'
      : 'SSH login was requested in this pane; wait for the prompt if needed, then run remote commands.'
  )
  if (ready.error) hintParts.push(ready.error)

  return {
    ok: true,
    tabId: opened.tabId,
    name: payload.name,
    mode,
    parentTabId,
    hint: hintParts.join(' ')
  }
}

export async function createOpenSubterminalToolDefinition(
  pi: PiSdkFacade,
  sessionKey: string
): Promise<ReturnType<PiSdkFacade['defineTool']>> {
  const { StringEnum } = await loadPiAi()
  const parameters = Type.Object({
    // StringEnum (pi-ai) instead of Type.Union/Type.Literal: Google's API and
    // other providers don't support anyOf/const patterns for string enums.
    mode: StringEnum(['local', 'ssh'] as const),
    name: Type.Optional(Type.String()),
    connectionId: Type.Optional(Type.String())
  })
  return pi.defineTool({
    name: 'open_subterminal',
    label: 'Open subterminal',
    description: [
      'Open a docked subterminal and route subsequent bash there.',
      'Use mode=local for client-machine work (/etc/hosts, local files) when the current pane is remote SSH.',
      'Use mode=ssh with a different saved connectionId for a new host — never for the current session connection (the host restores the main terminal).',
      'Required for parallel multi-host work — never issue concurrent bash on the same pane.',
      'Do not only analyze — call this tool then execute.'
    ].join(' '),
    promptSnippet: 'open_subterminal — open local/SSH docked subterminal for cross-context work',
    promptGuidelines: [
      'For local hosts/file edits while on a remote pane, call open_subterminal(mode=local) before bash.',
      'Use mode=ssh only with a different saved connectionId. Never open_subterminal for the current session connection — the host restores the main terminal.',
      'Never run concurrent bash on the same terminal; open a subterminal for each parallel workstream.'
    ],
    parameters,
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal) {
      const result = await openAgentSubterminal({
        sessionKey,
        params: params as OpenSubterminalParams,
        signal
      })
      const text = JSON.stringify(result, null, 2)
      return {
        content: [{ type: 'text', text }],
        details: result
      }
    }
  })
}
