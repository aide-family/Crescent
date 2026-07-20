import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AgentCommandInput,
  AgentCommandResult,
  AgentConfig,
  AgentConnectionIntentInput,
  AgentConnectionIntentResult,
  AgentEvent,
  AgentModelOption,
  AgentPathReference,
  AgentRunInput,
  AgentSkillInstallEvent,
  AgentSkillInstallResult,
  AgentSkillOption,
  AgentSkillSearchResult,
  AgentValidationResult,
  CommandApprovalDecision,
  CommandApprovalRequest,
  ConnectionConfig,
  ConnectionInput,
  LocalInstructionDocument,
  StoredAgentLogEntry,
  StoredAgentRun,
  StoredSessionHistoryDetail,
  StoredSessionHistoryItem,
  StoredSessionSummaryUpdate,
  StoredSessionTab,
  WikiDocument,
  WikiDocumentSummary,
  WikiSaveInput
} from '../shared/agent-types'

interface TerminalAgentApi {
  terminal: {
    start: (options?: {
      cols?: number
      rows?: number
      tabId?: string
      initialCommand?: string
    }) => Promise<{
      sessionId: number
      tabId: string
      mode: 'pty' | 'pipe'
      pid: number
      shell: string
      cwd: string
    }>
    write: (data: string, tabId?: string) => void
    pasteCommand: (command: string, execute?: boolean, tabId?: string) => void
    getContext: (tabId?: string) => Promise<{
      mode: 'pty' | 'pipe' | 'none'
      pid?: number
      cwd: string
      shell: string
      output: string
    }>
    resize: (dimensions: { cols: number; rows: number; tabId?: string }) => void
    stop: (tabId?: string) => void
    clear: (tabId?: string) => void
    onData: (callback: (event: { tabId: string; data: string }) => void) => () => void
    onPrompt: (
      callback: (event: { tabId: string; cwd: string; prompt?: string }) => void
    ) => () => void
    onExit: (
      callback: (event: {
        tabId: string
        sessionId: number
        exitCode: number
        signal?: number | string
      }) => void
    ) => () => void
  }
  agent: {
    getConfig: () => Promise<AgentConfig>
    getModels: () => Promise<AgentModelOption[]>
    listSkills: () => Promise<AgentSkillOption[]>
    searchSkills: (query: string) => Promise<AgentSkillSearchResult[]>
    installSkill: (input: {
      installSource: string
      installSkill?: string
    }) => Promise<AgentSkillInstallResult>
    startSkillInstall: (input: {
      installSource: string
      installSkill?: string
    }) => Promise<{ ok: boolean; installId: string }>
    cancelSkillInstall: (installId: string) => Promise<{ ok: boolean }>
    deleteSkill: (path: string) => Promise<AgentSkillOption[]>
    listInstructionFiles: () => Promise<LocalInstructionDocument[]>
    listWikiDocuments: () => Promise<WikiDocumentSummary[]>
    getWikiDocument: (id: string) => Promise<WikiDocument | undefined>
    saveWikiDocument: (input: WikiSaveInput) => Promise<WikiDocument>
    searchWikiDocuments: (query: string) => Promise<WikiDocument[]>
    pickPathReference: (kind: AgentPathReference['kind']) => Promise<AgentPathReference | undefined>
    saveInstructionFile: (input: {
      name: string
      content: string
    }) => Promise<LocalInstructionDocument>
    saveConfig: (config: Partial<AgentConfig>) => Promise<AgentConfig>
    validateConfig: (config: Partial<AgentConfig>) => Promise<AgentValidationResult>
    generateCommand: (input: AgentCommandInput) => Promise<AgentCommandResult>
    resolveConnectionIntent: (
      input: AgentConnectionIntentInput
    ) => Promise<AgentConnectionIntentResult>
    run: (input: AgentRunInput) => Promise<{ ok: boolean; text?: string; error?: string }>
    cancel: (runId: string) => Promise<{ ok: boolean }>
    supplement: (input: { runId: string; input: string }) => Promise<{ ok: boolean }>
    resolveCommandApproval: (input: CommandApprovalDecision) => Promise<{ ok: boolean }>
    onEvent: (callback: (event: AgentEvent) => void) => () => void
    onCommandApprovalRequest: (callback: (request: CommandApprovalRequest) => void) => () => void
    onSkillInstallEvent: (callback: (event: AgentSkillInstallEvent) => void) => () => void
  }
  connections: {
    list: () => Promise<ConnectionConfig[]>
    save: (input: ConnectionInput) => Promise<ConnectionConfig[]>
    delete: (id: string) => Promise<ConnectionConfig[]>
  }
  storage: {
    saveTabs: (tabs: StoredSessionTab[]) => Promise<{ ok: boolean }>
    saveAgentLog: (entry: StoredAgentLogEntry) => Promise<{ ok: boolean }>
    updateAgentLog: (
      input: Pick<StoredAgentLogEntry, 'tabId' | 'logId' | 'text'>
    ) => Promise<{ ok: boolean }>
    saveAgentRun: (run: StoredAgentRun) => Promise<{ ok: boolean }>
    listSessionHistory: (limit?: number) => Promise<StoredSessionHistoryItem[]>
    getSessionHistory: (tabId: string) => Promise<StoredSessionHistoryDetail | undefined>
    renameSessionHistory: (input: { tabId: string; title: string }) => Promise<{ ok: boolean }>
    deleteSessionHistory: (tabId: string) => Promise<{ ok: boolean }>
    onSessionSummaryUpdated: (callback: (event: StoredSessionSummaryUpdate) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: TerminalAgentApi
  }
}
