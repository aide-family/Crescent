import { Type, type Static } from 'typebox'
import type { WebContents } from 'electron'

import { safeWebContentsSend } from '../safe-ipc-send'
import { openTemporarySubterminal, resolveParentTerminalTabId } from '../terminal/ipc'
import { listConnections } from '../connections/ipc'
import type { PiCodingAgentModule } from './pi-sdk'
import {
  getPtyBashExecContext,
  updatePtyBashExecutionTabId
} from './pi-terminal-bash'

export const OPEN_SUBTERMINAL_DISCIPLINE = [
  '# 本机与子终端硬规范',
  '- 写本机 /etc/hosts、本机文件、应用运行环境配置：若当前可见终端是远程 SSH / 集群会话，禁止在远程改；必须先 open_subterminal(mode=local)，再在该子终端用 bash 执行（如 sudo tee -a /etc/hosts）。',
  '- 需要登录另一台主机 / 新 SSH，而当前终端无法到达或不该离开：优先 open_subterminal(mode=ssh, connectionId=...)，再在该子终端执行；不要只做分析。',
  '- 识别到「写 hosts / 本机配置 / 本地执行」后立即调用工具并执行，禁止长篇无效分析替代落地。',
  '- workspace 的 write/edit 不能代替本机 /etc/hosts。'
].join('\n')

const openSubterminalSchema = Type.Object({
  mode: Type.Union([Type.Literal('local'), Type.Literal('ssh')]),
  name: Type.Optional(Type.String()),
  connectionId: Type.Optional(Type.String())
})

export type OpenSubterminalParams = Static<typeof openSubterminalSchema>

export interface AgentSubterminalOpenedPayload {
  parentTabId: string
  tabId: string
  name: string
  mode: 'local' | 'ssh'
  connectionId?: string
  chatTabId?: string
}

interface SubterminalReadyWaiter {
  resolve: (result: { ok: boolean; error?: string }) => void
  timeout: NodeJS.Timeout
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
  readyWaiters.delete(tabId)
  waiter.resolve({ ok: Boolean(payload.ok), error: payload.error })
  return { ok: true }
}

function waitForRendererReady(tabId: string, timeoutMs = 20_000): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const existing = readyWaiters.get(tabId)
    if (existing) {
      clearTimeout(existing.timeout)
      readyWaiters.delete(tabId)
      existing.resolve({ ok: false, error: 'Superseded by a newer open_subterminal call.' })
    }
    const timeout = setTimeout(() => {
      readyWaiters.delete(tabId)
      resolve({
        ok: true,
        error: 'Timed out waiting for UI ack; bash will still target this subterminal.'
      })
    }, timeoutMs)
    readyWaiters.set(tabId, { resolve, timeout })
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

export async function openAgentSubterminal(input: {
  sessionKey: string
  params: OpenSubterminalParams
  webContents?: WebContents
}): Promise<{
  ok: boolean
  tabId?: string
  name?: string
  mode?: 'local' | 'ssh'
  parentTabId?: string
  hint?: string
  error?: string
}> {
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

  const parentTabId = resolveOpenSubterminalParentTabId(context.executionTabId)
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

  updatePtyBashExecutionTabId(input.sessionKey, opened.tabId)

  const payload: AgentSubterminalOpenedPayload = {
    parentTabId,
    tabId: opened.tabId,
    name: opened.name || name,
    mode,
    connectionId: mode === 'ssh' ? connectionId : undefined,
    chatTabId: context.chatTabId
  }
  safeWebContentsSend(webContents, 'agent:subterminal-opened', payload)

  const ready = await waitForRendererReady(opened.tabId)
  const hintParts = [
    `Subsequent bash commands now run in subterminal "${payload.name}" (${opened.tabId}).`,
    mode === 'local'
      ? 'Use bash here for local /etc/hosts and other client-machine work (e.g. sudo tee -a /etc/hosts).'
      : 'SSH login was requested in this pane; wait for the prompt if needed, then run remote commands.'
  ]
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

export function createOpenSubterminalToolDefinition(
  pi: PiCodingAgentModule,
  sessionKey: string
): ReturnType<PiCodingAgentModule['defineTool']> {
  return pi.defineTool({
    name: 'open_subterminal',
    label: 'Open subterminal',
    description: [
      'Open a docked subterminal and route subsequent bash there.',
      'Use mode=local for client-machine work (/etc/hosts, local files) when the current pane is remote SSH.',
      'Use mode=ssh with connectionId to open a new SSH session in a subterminal.',
      'Do not only analyze — call this tool then execute.'
    ].join(' '),
    promptSnippet: 'open_subterminal — open local/SSH docked subterminal for cross-context work',
    promptGuidelines: [
      'For local hosts/file edits while on a remote pane, call open_subterminal(mode=local) before bash.',
      'For a new SSH target the current pane cannot reach, call open_subterminal(mode=ssh, connectionId=...).'
    ],
    parameters: openSubterminalSchema,
    executionMode: 'sequential',
    async execute(_toolCallId, params) {
      const result = await openAgentSubterminal({
        sessionKey,
        params: params as OpenSubterminalParams
      })
      const text = JSON.stringify(result, null, 2)
      return {
        content: [{ type: 'text', text }],
        details: result
      }
    }
  })
}
