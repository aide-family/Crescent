import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AgentCommandInput,
  AgentCommandResult,
  AgentConfig,
  AgentConnectionIntentInput,
  AgentConnectionIntentResult,
  AgentEvent,
  AgentGenerateSopInput,
  AgentGenerateSopResult,
  AgentModelOption,
  AgentPathReference,
  PastedAttachmentInput,
  AgentRunInput,
  AgentSkillInstallEvent,
  AgentSkillInstallResult,
  AgentSkillOption,
  AgentSkillSearchResult,
  AgentExtensionOption,
  AgentPiPackageSearchResult,
  AgentValidationResult,
  CommandApprovalDecision,
  CommandApprovalDismiss,
  CommandApprovalPurposeUpdate,
  CommandApprovalRequest,
  ExtensionUiDecision,
  ExtensionUiDismiss,
  ExtensionUiRequest,
  ConnectionConfig,
  ConnectionInput,
  LocalInstructionDocument,
  StoredAgentLogEntry,
  StoredAgentRun,
  SessionTokenUsage,
  OpsHistoryRecord,
  SubmitOpsFeedbackInput,
  SubmitOpsFeedbackResult,
  UpdateOpsFeedbackInput,
  UpdateOpsFeedbackResult,
  TranscribeAudioInput,
  TranscribeAudioResult,
  TranscriptionSupportResult,
  StoredSessionHistoryDetail,
  StoredSessionHistoryItem,
  StoredSessionSummaryUpdate,
  StoredSessionTab,
  WikiDocument,
  WikiDocumentSummary,
  WikiSaveInput
} from '../shared/agent-types'
import type {
  AppUpdateActionResult,
  AppUpdateStatusEvent,
  AppUpdateVersionResult
} from '../shared/update-types'

interface TerminalAgentApi {
  app: {
    notifyAttention: (input: { title: string; body: string }) => Promise<{ ok: boolean }>
    getRendererRecoveryMode: () => Promise<{ mode: 'none' | 'pending' | 'crash-loop' }>
    clearRendererRecovery: () => Promise<{ ok: boolean }>
    exportRendererDiagnostics: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
    reportDiagnosticError: (message: string) => void
    setLocale: (locale: 'zh-CN' | 'en') => Promise<{ ok: boolean; locale: 'zh-CN' | 'en' }>
    openExternal: (url: string) => Promise<{ ok: boolean }>
    onOpenSettings: (callback: () => void) => () => void
  }
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
      expectedHost?: string
      sessionAligned?: 'aligned' | 'drifted' | 'unknown'
      alignment?: 'aligned' | 'drifted' | 'unknown'
      promptHost?: string
      aliases?: string[]
      ready?: boolean
    }>
    resize: (dimensions: { cols: number; rows: number; tabId?: string }) => void
    stop: (tabId?: string) => void
    clear: (tabId?: string) => void
    setExpectedHost: (options: {
      tabId: string
      host?: string | null
    }) => Promise<{ ok: boolean; host?: string; error?: string }>
    confirmLogin: (options: {
      tabId: string
      sourceTabId?: string
      localHost?: string
      expectedTargetHost?: string
    }) => Promise<{
      ok: boolean
      tabId?: string
      promptHost?: string
      learned?: boolean
      alignment?: 'aligned' | 'drifted' | 'unknown'
      ready?: boolean
      aliases?: string[]
      error?: string
    }>
    openSubterminal: (options: {
      parentTabId: string
      terminalName: string
      cols?: number
      rows?: number
      initialCommand?: string
    }) => Promise<{
      ok: boolean
      name?: string
      tabId?: string
      sessionId?: number
      mode?: 'pty' | 'pipe'
      pid?: number
      shell?: string
      cwd?: string
      error?: string
    }>
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
    onEnvironmentDrift: (
      callback: (event: {
        tabId: string
        observedHost: string
        expectedHost: string
        driftKey?: string
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
    getSkillContent: (path: string) => Promise<string>
    getCatalogSkillContent: (input: {
      installSource: string
      installSkill?: string
      name: string
    }) => Promise<string>
    listExtensions: () => Promise<AgentExtensionOption[]>
    listExtensionCommands: (
      sessionKey?: string
    ) => Promise<Array<{ name: string; description: string }>>
    importExtension: () => Promise<{
      ok: boolean
      canceled?: boolean
      error?: string
      extensions?: AgentExtensionOption[]
    }>
    deleteExtension: (path: string) => Promise<AgentExtensionOption[]>
    setExtensionEnabled: (input: {
      id: string
      enabled: boolean
    }) => Promise<AgentExtensionOption[]>
    getExtensionContent: (path: string) => Promise<string>
    searchExtensionPackages: (query: string) => Promise<AgentPiPackageSearchResult[]>
    installExtensionPackage: (source: string) => Promise<AgentExtensionOption[]>
    runExtensionCommand: (input: {
      name: string
      args?: string
      tabId?: string
    }) => Promise<{ ok: boolean; busy?: boolean; error?: string }>
    resolveExtensionUi: (input: ExtensionUiDecision) => Promise<{ ok: boolean }>
    listInstructionFiles: () => Promise<LocalInstructionDocument[]>
    listWikiDocuments: () => Promise<WikiDocumentSummary[]>
    getWikiDocument: (id: string) => Promise<WikiDocument | undefined>
    saveWikiDocument: (input: WikiSaveInput) => Promise<WikiDocument>
    deleteWikiDocument: (id: string) => Promise<{ ok: boolean }>
    searchWikiDocuments: (query: string) => Promise<WikiDocument[]>
    pickPathReference: (kind: AgentPathReference['kind']) => Promise<AgentPathReference | undefined>
    importOpenApiDocument: () => Promise<{ ok: boolean; path?: string; canceled?: boolean }>
    savePastedAttachment: (input: PastedAttachmentInput) => Promise<AgentPathReference>
    requestMicrophonePermission: () => Promise<{ ok: boolean; granted: boolean }>
    transcribeAudio: (input: TranscribeAudioInput) => Promise<TranscribeAudioResult>
    checkTranscriptionSupport: (input?: {
      forceRefresh?: boolean
      providerId?: string
      model?: string
    }) => Promise<TranscriptionSupportResult>
    saveRenderedImage: (input: {
      dataUrl: string
      defaultPath: string
    }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
    saveSvgAsPng: (input: {
      svg: string
      defaultPath: string
      width: number
      height: number
    }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
    pickSavePath: (input: {
      defaultPath: string
      filters?: Array<{ name: string; extensions: string[] }>
    }) => Promise<{ ok: boolean; path?: string; canceled?: boolean }>
    writeDataUrlFile: (input: {
      path: string
      dataUrl: string
    }) => Promise<{ ok: boolean; path?: string; error?: string }>
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
    generateSop: (input: AgentGenerateSopInput) => Promise<AgentGenerateSopResult>
    run: (input: AgentRunInput) => Promise<{ ok: boolean; text?: string; error?: string }>
    cancel: (runId: string) => Promise<{ ok: boolean }>
    rejectApprovalsForTab: (tabId: string) => Promise<{ ok: boolean }>
    supplement: (input: { runId: string; input: string }) => Promise<{ ok: boolean }>
    resolveCommandApproval: (input: CommandApprovalDecision) => Promise<{ ok: boolean }>
    ackSubterminalOpened: (payload: {
      tabId: string
      ok: boolean
      error?: string
    }) => Promise<{ ok: boolean }>
    onEvent: (callback: (event: AgentEvent) => void) => () => void
    onCommandApprovalRequest: (callback: (request: CommandApprovalRequest) => void) => () => void
    onCommandApprovalDismiss: (callback: (payload: CommandApprovalDismiss) => void) => () => void
    onCommandApprovalPurpose: (
      callback: (payload: CommandApprovalPurposeUpdate) => void
    ) => () => void
    onSubterminalOpened: (
      callback: (payload: {
        parentTabId: string
        tabId: string
        name: string
        mode: 'local' | 'ssh'
        terminalMode: 'pty' | 'pipe'
        connectionId?: string
        chatTabId?: string
      }) => void
    ) => () => void
    onSkillInstallEvent: (callback: (event: AgentSkillInstallEvent) => void) => () => void
    onExtensionUiRequest: (callback: (request: ExtensionUiRequest) => void) => () => void
    onExtensionUiDismiss: (callback: (payload: ExtensionUiDismiss) => void) => () => void
  }
  connections: {
    list: () => Promise<ConnectionConfig[]>
    resolve: (id: string) => Promise<ConnectionConfig | undefined>
    save: (input: ConnectionInput) => Promise<ConnectionConfig[]>
    delete: (id: string) => Promise<ConnectionConfig[]>
    getLastUsed: () => Promise<string | null>
    setLastUsed: (id: string) => Promise<string | null>
  }
  storage: {
    saveTabs: (tabs: StoredSessionTab[]) => Promise<{ ok: boolean }>
    saveAgentLog: (entry: StoredAgentLogEntry) => Promise<{ ok: boolean }>
    updateAgentLog: (
      input: Pick<StoredAgentLogEntry, 'tabId' | 'logId' | 'text'>
    ) => Promise<{ ok: boolean }>
    getAgentLog: (input: {
      tabId: string
      logId: number
    }) => Promise<StoredAgentLogEntry | undefined>
    deleteAgentLogs: (input: {
      tabId: string
      logIds: number[]
    }) => Promise<{ ok: boolean; removed: number }>
    saveAgentRun: (run: StoredAgentRun) => Promise<{ ok: boolean }>
    getAgentRun: (runId: string) => Promise<StoredAgentRun | undefined>
    listAgentRuns: (input: { tabId: string; limit?: number }) => Promise<StoredAgentRun[]>
    listAllAgentRuns: (tabId: string) => Promise<StoredAgentRun[]>
    getSessionTokenUsage: (tabId: string) => Promise<SessionTokenUsage>
    listAgentLogs: (input: {
      tabId: string
      beforeLogId?: number
      limit?: number
    }) => Promise<StoredAgentLogEntry[]>
    countAgentLogs: (tabId: string) => Promise<number>
    listSessionHistory: (limit?: number) => Promise<StoredSessionHistoryItem[]>
    getSessionHistory: (tabId: string) => Promise<StoredSessionHistoryDetail | undefined>
    renameSessionHistory: (input: { tabId: string; title: string }) => Promise<{ ok: boolean }>
    deleteSessionHistory: (tabId: string) => Promise<{ ok: boolean }>
    submitOpsFeedback: (input: SubmitOpsFeedbackInput) => Promise<SubmitOpsFeedbackResult>
    getOpsFeedback: (runId: string) => Promise<OpsHistoryRecord | undefined>
    listOpsFeedback: (input: {
      connectionId?: string
      limit?: number
    }) => Promise<OpsHistoryRecord[]>
    updateOpsFeedback: (input: UpdateOpsFeedbackInput) => Promise<UpdateOpsFeedbackResult>
    deleteOpsFeedback: (id: string) => Promise<{ ok: boolean }>
    onSessionSummaryUpdated: (callback: (event: StoredSessionSummaryUpdate) => void) => () => void
  }
  update: {
    getVersion: () => Promise<AppUpdateVersionResult>
    check: () => Promise<AppUpdateActionResult>
    download: () => Promise<AppUpdateActionResult>
    downloadInstaller: () => Promise<AppUpdateActionResult>
    install: () => Promise<AppUpdateActionResult>
    onStatus: (callback: (event: AppUpdateStatusEvent) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: TerminalAgentApi
  }
}
