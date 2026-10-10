import { type Dictionary } from '@renderer/i18n'
import { isImeKeyEvent } from '@renderer/lib/ime-safe-value'
import { waitForRemotePrompt } from '@renderer/lib/prompt-host-wait'
import {
  TERMINAL_READY_WAIT_MS,
  isTerminalSnapshotReadyForAgent
} from '@renderer/lib/terminal-ready-gate'
import {
  createTerminalTab,
  type AgentLogEntry,
  type AgentTerminalTab
} from '@renderer/lib/terminal-tabs'
import { parseSubterminalTabId } from '@renderer/lib/terminal-text'
import { KeyboardEvent } from 'react'
import {
  type AgentConfig,
  type AgentMcpServerConfig,
  type AgentPathReference,
  type AgentProviderConfig,
  type ConnectionConfig
} from '../../../shared/agent-types'
import { type RunStopReason } from '../../../shared/connection-state'

export const emptyConfig: AgentConfig = {
  providers: [],
  providerId: undefined,
  model: '',
  agentStyle: 'concise',
  agentMode: 'react',
  maxActiveTools: 5,
  commandWhitelist: [],
  openApiProfiles: [],
  openApiProfileId: undefined,
  openApiBaseUrl: '',
  openApiDocument: '',
  openApiTimeoutMs: 30_000,
  openApiMaxRetries: 2,
  openApiRetryBackoffMs: 300,
  skillRoot: '~/.crescent/skills',
  loadGlobalAgentSkills: false,
  mcpServers: []
}

export const emptyProvider: AgentProviderConfig = {
  id: '',
  name: '',
  baseUrl: '',
  apiKey: '',
  enabled: true,
  models: []
}

export const emptyMcpServer: AgentMcpServerConfig = {
  id: '',
  name: '',
  transport: 'stdio',
  command: '',
  args: [],
  env: {},
  enabled: true
}

export interface ReuseAgentRun {
  logId: number
  runId: string
}

export interface PostConnectionTask {
  input: string
  displayInput: string
  conversationContext?: string
  connection: ConnectionConfig
  appendUserLog: boolean
  startedAt: number
  reuseRun?: ReuseAgentRun
  activeWikiIds?: string[]
  activeSkillPaths?: string[]
}

export const initialTerminalTab = createTerminalTab({ title: 'Terminal' })

export const emptyLocalTab = createTerminalTab({ title: 'Terminal' })

export const CONNECTION_SPAWN_TIMEOUT_MS = 10_000

export const CONNECTION_LOGIN_TOTAL_TIMEOUT_MS = 90_000

export function settleStopText(
  reason: RunStopReason,
  t: Dictionary,
  options: { expectedHost?: string; observedHost?: string } = {}
): string {
  const observedLabel =
    options.observedHost === 'local-shell' ? t.terminal.localShellLabel : options.observedHost
  switch (reason) {
    case 'user':
      return t.input.agentCanceled
    case 'gate-interrupt':
      return t.input.gateInterruptStopped
        .replace('{expected}', options.expectedHost ?? '')
        .replace('{observed}', observedLabel ?? '')
    case 'timeout':
      return t.input.timeoutStopped
    case 'system-recovery':
      return t.input.systemRecoveryStopped
    default:
      return t.input.systemRecoveryStopped
  }
}

export function resolveSubterminalTabState(
  tabs: AgentTerminalTab[],
  tabId: string
): { parentTabId: string; name: string; terminalMode?: 'pty' | 'pipe' } | undefined {
  const marker = '::subterminal::'
  const markerIndex = tabId.indexOf(marker)
  if (markerIndex === -1) return undefined
  const parentTabId = tabId.slice(0, markerIndex)
  const name = decodeURIComponent(tabId.slice(markerIndex + marker.length))
  const parent = tabs.find((tab) => tab.id === parentTabId)
  return {
    parentTabId,
    name,
    terminalMode: parent?.subTerminals.find((sub) => sub.id === tabId)?.terminalMode
  }
}

export function isApprovalTargetAlive(
  tabId: string | undefined,
  tabs: AgentTerminalTab[]
): boolean {
  if (tabs.length === 0) return false
  if (!tabId) return false

  if (tabs.some((tab) => tab.id === tabId)) return true
  if (tabs.some((tab) => tab.subTerminals.some((subterminal) => subterminal.id === tabId))) {
    return true
  }

  const subterminal = parseSubterminalTabId(tabId)
  if (subterminal) {
    return tabs.some((tab) => tab.id === subterminal.parentTabId)
  }

  return false
}

export function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}

export function isComposingInput(event: KeyboardEvent<HTMLElement>): boolean {
  return isImeKeyEvent(event)
}

export async function resolvePastedFileReference(
  file: File
): Promise<AgentPathReference | undefined> {
  const path = (file as File & { path?: string }).path
  if (path) {
    return {
      id: `file:${path}`,
      kind: 'file',
      path,
      name: file.name || path.split(/[\\/]/).pop() || path
    }
  }

  const base64 = await fileToBase64(file)
  return window.api.agent.savePastedAttachment({
    name: file.name || defaultPastedFileName(file.type),
    mimeType: file.type,
    base64
  })
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return window.btoa(binary)
}

export function defaultPastedFileName(mimeType: string): string {
  if (mimeType === 'image/png') return 'pasted-image.png'
  if (mimeType === 'image/jpeg') return 'pasted-image.jpg'
  if (mimeType === 'image/gif') return 'pasted-image.gif'
  if (mimeType === 'image/webp') return 'pasted-image.webp'
  return 'pasted-file'
}

export async function waitForTerminalReadyForAgent(
  tabId: string,
  options?: {
    getTab?: () =>
      | Pick<
          import('@renderer/lib/terminal-tabs').AgentTerminalTab,
          'terminalReady' | 'connectionId' | 'isSsh'
        >
      | undefined
    timeoutMs?: number
  }
): Promise<boolean> {
  const deadline = Date.now() + (options?.timeoutMs ?? TERMINAL_READY_WAIT_MS)

  while (Date.now() < deadline) {
    const context = await window.api.terminal.getContext(tabId)
    const output = context.output.slice(-8000)
    const tab = options?.getTab?.()
    if (
      isTerminalSnapshotReadyForAgent({
        tab,
        terminalMode: context.mode,
        output
      })
    ) {
      return true
    }

    await sleep(500)
  }

  return false
}

export async function settleAgentCancel(runId: string): Promise<void> {
  try {
    await window.api.agent.cancel(runId)
  } catch {
    // Ignore cancel transport errors; UI still clears after settle.
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export async function waitForPromptHostOrTimeout(
  tabId: string,
  timeoutMs = 20_000,
  options?: {
    expectedHost?: string
    previousHost?: string
    acceptAnyRemoteHost?: boolean
    clusterHostRegex?: string
  }
): Promise<'host' | 'local' | 'none'> {
  return waitForRemotePrompt(
    {
      getContext: () => window.api.terminal.getContext(tabId),
      onData: (handler) => window.api.terminal.onData(handler),
      // DOM timer functions must be invoked with `this === window`; calling a
      // bare reference as an object method throws "Illegal invocation" in the
      // renderer. Wrap them so the call site keeps the correct receiver.
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
      now: () => Date.now()
    },
    {
      tabId,
      timeoutMs,
      expectedHost: options?.expectedHost,
      previousHost: options?.previousHost,
      acceptAnyRemoteHost: options?.acceptAnyRemoteHost,
      clusterHostRegex: options?.clusterHostRegex
    }
  )
}

export function sendTerminalInput(value: string, tabId: string): void {
  window.api.terminal.write(`${value}\r`, tabId)
}

export function getSelectedTextWithinLog(logId: number): string {
  const selection = window.getSelection()
  const selectedText = selection?.toString().trim()
  if (!selection || !selectedText) return ''

  const container = document.querySelector(`[data-agent-log-entry="${logId}"]`)
  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode
  if (!container || (!container.contains(anchorNode) && !container.contains(focusNode))) return ''

  return selectedText
}

export function buildLogMarkdownFilename(entry: AgentLogEntry, scope?: 'result'): string {
  const timestamp = entry.createdAt.replace(/[:.]/g, '-').replace(/T/, '_').replace(/Z$/, '')
  return `crescent-${entry.kind}${scope ? `-${scope}` : ''}-${timestamp}.md`
}

export function buildLogTraceFilename(entry: AgentLogEntry): string {
  const timestamp = entry.createdAt.replace(/[:.]/g, '-').replace(/T/, '_').replace(/Z$/, '')
  return `crescent-agent-trace-${timestamp}.json`
}

export function buildSessionTraceFilename(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/T/, '_')
    .replace(/Z$/, '')
  return `crescent-session-trace-${timestamp}.json`
}
