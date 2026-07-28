import type {
  AgentConfig,
  AgentModelOption,
  AgentPathReference,
  AgentSkillOption,
  AgentWikiReference,
  StoredSessionTab
} from '../../../shared/agent-types'

export type AgentLogEntry =
  | { id: number; kind: 'user' | 'assistant' | 'error'; text: string; createdAt: string }
  | {
      id: number
      kind: 'status' | 'thought' | 'tool' | 'plan' | 'command'
      text: string
      createdAt: string
    }

export interface AgentRunViewState {
  logId: number
  actions: AgentRunAction[]
  startedAt?: number
  result?: string
  error?: string
  elapsedMs?: number
}

export interface AgentRunAction {
  title: string
  detail: string
}

export interface AgentToolReference {
  id: string
  name: string
  description: string
  source: 'built-in' | 'openapi' | 'mcp'
}

export interface AgentTerminalTab {
  id: string
  title: string
  providerId?: string
  model?: string
  connectionId?: string
  connectionName?: string
  isSsh: boolean
  sessionId?: number
  terminalReady: boolean
  terminalCwd: string
  terminalMode: 'pty' | 'pipe'
  terminalOutput: string
  agentInput: string
  skillRefs: AgentSkillOption[]
  pathRefs: AgentPathReference[]
  toolRefs: AgentToolReference[]
  wikiRefs: AgentWikiReference[]
  agentBusy: boolean
  agentThinking: boolean
  copiedLogId: number | null
  agentLog: AgentLogEntry[]
  subTerminals: TemporarySubterminal[]
}

export interface TemporarySubterminal {
  id: string
  name: string
  output: string
  rawOutput: string
  cwd: string
  status: 'active' | 'exited'
  widthPercent?: number
}

const BLOCKED_TERMINAL_TITLE_PATTERN = /topology/i

export function createTerminalTab(input?: Partial<AgentTerminalTab>): AgentTerminalTab {
  return {
    id: input?.id ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: input?.title ?? 'Local',
    providerId: input?.providerId,
    model: input?.model,
    connectionId: input?.connectionId,
    connectionName: input?.connectionName,
    isSsh: input?.isSsh ?? false,
    sessionId: input?.sessionId,
    terminalReady: input?.terminalReady ?? false,
    terminalCwd: input?.terminalCwd ?? '',
    terminalMode: input?.terminalMode ?? 'pty',
    terminalOutput: input?.terminalOutput ?? '',
    agentInput: input?.agentInput ?? '',
    skillRefs: input?.skillRefs ?? [],
    pathRefs: input?.pathRefs ?? [],
    toolRefs: input?.toolRefs ?? [],
    wikiRefs: input?.wikiRefs ?? [],
    agentBusy: input?.agentBusy ?? false,
    agentThinking: input?.agentThinking ?? false,
    copiedLogId: input?.copiedLogId ?? null,
    agentLog: input?.agentLog ?? [],
    subTerminals: input?.subTerminals ?? []
  }
}

export function toStoredSessionTabs(tabs: AgentTerminalTab[]): StoredSessionTab[] {
  return tabs.map((tab) => ({
    tabId: tab.id,
    title: tab.title,
    connectionId: tab.connectionId,
    connectionName: tab.connectionName,
    isSsh: tab.isSsh,
    terminalCwd: tab.terminalCwd,
    terminalMode: tab.terminalMode
  }))
}

export function getNextTerminalTitle(baseTitle: string, tabs: AgentTerminalTab[]): string {
  const normalizedBase = baseTitle.trim() || 'Terminal'
  const titles = new Set(tabs.map((tab) => tab.title))

  if (!titles.has(normalizedBase)) return normalizedBase

  for (let index = 1; ; index += 1) {
    const candidate = `${normalizedBase} ${index}`
    if (!titles.has(candidate)) return candidate
  }
}

export function sanitizeTerminalDisplayTitle(value: string | undefined, fallback: string): string {
  const title = value?.trim() ?? ''
  if (!title || BLOCKED_TERMINAL_TITLE_PATTERN.test(title)) return fallback
  return title
}

export function getTerminalDisplayTitle(tab: AgentTerminalTab): string {
  if (tab.isSsh || tab.connectionId) {
    return sanitizeTerminalDisplayTitle(tab.connectionName || tab.title, 'SSH')
  }

  return 'Local'
}

export function resolveTabModelSelection(
  tab: AgentTerminalTab | undefined,
  config: AgentConfig,
  models: AgentModelOption[]
): { providerId?: string; model: string } {
  const providerId = tab?.providerId ?? config.providerId
  const providerModels = models.filter((model) => model.providerId === providerId)
  const model =
    tab?.model && providerModels.some((candidate) => candidate.id === tab.model)
      ? tab.model
      : (providerModels[0]?.id ?? config.model)

  return { providerId, model }
}
