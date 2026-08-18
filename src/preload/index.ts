import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AgentCommandInput,
  AgentCommandResult,
  AgentConfig,
  AgentConnectionIntentInput,
  AgentConnectionIntentResult,
  AgentEvent,
  AgentGenerateSopInput,
  AgentGenerateSopResult,
  AgentReloadRuntimeInput,
  AgentReloadRuntimeResult,
  AgentGenerateCaptureDraftInput,
  AgentGenerateCaptureDraftResult,
  AgentCommitCaptureDraftInput,
  AgentCommitCaptureDraftResult,
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

// Custom APIs for renderer
const api = {
  app: {
    notifyAttention: (input: {
      title: string
      body: string
      pendingId?: string
      tabId?: string
      chatTabId?: string
    }): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:notify-attention', input),
    getRendererRecoveryMode: (): Promise<{ mode: 'none' | 'pending' | 'crash-loop' }> =>
      ipcRenderer.invoke('app:get-renderer-recovery-mode'),
    clearRendererRecovery: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('app:clear-renderer-recovery'),
    exportRendererDiagnostics: (): Promise<{ ok: boolean; canceled?: boolean; path?: string }> =>
      ipcRenderer.invoke('app:export-renderer-diagnostics'),
    reportDiagnosticError: (message: string): void => {
      ipcRenderer.send('renderer:diagnostic-error', { message: message.slice(0, 2048) })
    },
    setLocale: (locale: 'zh-CN' | 'en'): Promise<{ ok: boolean; locale: 'zh-CN' | 'en' }> =>
      ipcRenderer.invoke('app:set-locale', locale),
    openExternal: (url: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('app:open-external', url),
    onOpenSettings: (callback: () => void): (() => void) => {
      const listener = (): void => {
        callback()
      }
      ipcRenderer.on('app:open-settings', listener)
      return () => ipcRenderer.removeListener('app:open-settings', listener)
    },
    onAttentionClicked: (
      callback: (payload: { pendingId?: string; tabId?: string; chatTabId?: string }) => void
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: { pendingId?: string; tabId?: string; chatTabId?: string }
      ): void => {
        callback(payload)
      }
      ipcRenderer.on('app:attention-clicked', listener)
      return () => ipcRenderer.removeListener('app:attention-clicked', listener)
    }
  },
  terminal: {
    start: (options?: {
      cols?: number
      rows?: number
      tabId?: string
      initialCommand?: string
    }): Promise<{
      sessionId: number
      tabId: string
      mode: 'pty' | 'pipe'
      pid: number
      shell: string
      cwd: string
    }> => ipcRenderer.invoke('terminal:start', options),
    write: (data: string, tabId?: string): void => {
      ipcRenderer.send('terminal:write', { data, tabId })
    },
    pasteCommand: (command: string, execute = false, tabId?: string): void => {
      ipcRenderer.send('terminal:paste-command', { command, execute, tabId })
    },
    getContext: (
      tabId?: string
    ): Promise<{
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
    }> => ipcRenderer.invoke('terminal:get-context', { tabId }),
    resize: (dimensions: { cols: number; rows: number; tabId?: string }): void => {
      ipcRenderer.send('terminal:resize', dimensions)
    },
    stop: (tabId?: string): void => {
      ipcRenderer.send('terminal:stop', { tabId })
    },
    clear: (tabId?: string): void => {
      ipcRenderer.send('terminal:clear', { tabId })
    },
    setExpectedHost: (options: {
      tabId: string
      host?: string | null
    }): Promise<{ ok: boolean; host?: string; error?: string }> =>
      ipcRenderer.invoke('terminal:set-expected-host', options),
    confirmLogin: (options: {
      tabId: string
      sourceTabId?: string
      localHost?: string
      expectedTargetHost?: string
      jumpPromptHost?: string
    }): Promise<{
      ok: boolean
      tabId?: string
      promptHost?: string
      learned?: boolean
      alignment?: 'aligned' | 'drifted' | 'unknown'
      ready?: boolean
      aliases?: string[]
      error?: string
    }> => ipcRenderer.invoke('terminal:confirm-login', options),
    openSubterminal: (options: {
      parentTabId: string
      terminalName: string
      cols?: number
      rows?: number
      initialCommand?: string
    }): Promise<{
      ok: boolean
      name?: string
      tabId?: string
      sessionId?: number
      mode?: 'pty' | 'pipe'
      pid?: number
      shell?: string
      cwd?: string
      error?: string
    }> => ipcRenderer.invoke('terminal:open-subterminal', options),
    readSubterminal: (options: {
      parentTabId: string
      terminalName: string
      maxChars?: number
    }): Promise<{
      ok: boolean
      name: string
      tabId: string
      mode: 'pty' | 'pipe' | 'none'
      cwd: string
      shell: string
      output: string
      busy: boolean
      detached: boolean
      error?: string
    }> => ipcRenderer.invoke('terminal:read-subterminal', options),
    interruptSubterminal: (options: {
      parentTabId: string
      terminalName: string
    }): Promise<{ ok: boolean; name: string; tabId?: string; error?: string }> =>
      ipcRenderer.invoke('terminal:interrupt-subterminal', options),
    onData: (callback: (event: { tabId: string; data: string }) => void): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        event: { tabId: string; data: string }
      ): void => callback(event)

      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onPrompt: (
      callback: (event: { tabId: string; cwd: string; prompt?: string }) => void
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        event: { tabId: string; cwd: string; prompt?: string }
      ): void => callback(event)

      ipcRenderer.on('terminal:prompt', listener)
      return () => ipcRenderer.removeListener('terminal:prompt', listener)
    },
    onExit: (
      callback: (event: {
        tabId: string
        sessionId: number
        exitCode: number
        signal?: number | string
      }) => void
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        event: { tabId: string; sessionId: number; exitCode: number; signal?: number | string }
      ): void => callback(event)

      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    },
    onEnvironmentDrift: (
      callback: (event: {
        tabId: string
        observedHost: string
        expectedHost: string
        driftKey?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        event: { tabId: string; observedHost: string; expectedHost: string; driftKey?: string }
      ): void => callback(event)

      ipcRenderer.on('terminal:environment-drift', listener)
      return () => ipcRenderer.removeListener('terminal:environment-drift', listener)
    }
  },
  agent: {
    getConfig: (): Promise<AgentConfig> => ipcRenderer.invoke('agent:get-config'),
    getModels: (): Promise<AgentModelOption[]> => ipcRenderer.invoke('agent:get-models'),
    listSkills: (): Promise<AgentSkillOption[]> => ipcRenderer.invoke('agent:list-skills'),
    searchSkills: (query: string): Promise<AgentSkillSearchResult[]> =>
      ipcRenderer.invoke('agent:search-skills', query),
    installSkill: (input: {
      installSource: string
      installSkill?: string
    }): Promise<AgentSkillInstallResult> => ipcRenderer.invoke('agent:install-skill', input),
    startSkillInstall: (input: {
      installSource: string
      installSkill?: string
    }): Promise<{ ok: boolean; installId: string }> =>
      ipcRenderer.invoke('agent:start-skill-install', input),
    cancelSkillInstall: (installId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('agent:cancel-skill-install', installId),
    deleteSkill: (path: string): Promise<AgentSkillOption[]> =>
      ipcRenderer.invoke('agent:delete-skill', path),
    getSkillContent: (path: string): Promise<string> =>
      ipcRenderer.invoke('agent:get-skill-content', path),
    getCatalogSkillContent: (input: {
      installSource: string
      installSkill?: string
      name: string
    }): Promise<string> => ipcRenderer.invoke('agent:get-catalog-skill-content', input),
    listExtensions: (): Promise<AgentExtensionOption[]> =>
      ipcRenderer.invoke('agent:list-extensions'),
    listExtensionCommands: (
      sessionKey?: string
    ): Promise<Array<{ name: string; description: string }>> =>
      ipcRenderer.invoke('agent:list-extension-commands', sessionKey),
    importExtension: (): Promise<{
      ok: boolean
      canceled?: boolean
      error?: string
      extensions?: AgentExtensionOption[]
    }> => ipcRenderer.invoke('agent:import-extension'),
    deleteExtension: (path: string): Promise<AgentExtensionOption[]> =>
      ipcRenderer.invoke('agent:delete-extension', path),
    setExtensionEnabled: (input: {
      id: string
      enabled: boolean
    }): Promise<AgentExtensionOption[]> => ipcRenderer.invoke('agent:set-extension-enabled', input),
    getExtensionContent: (path: string): Promise<string> =>
      ipcRenderer.invoke('agent:get-extension-content', path),
    searchExtensionPackages: (query: string): Promise<AgentPiPackageSearchResult[]> =>
      ipcRenderer.invoke('agent:search-extension-packages', query),
    installExtensionPackage: (source: string): Promise<AgentExtensionOption[]> =>
      ipcRenderer.invoke('agent:install-extension-package', source),
    runExtensionCommand: (input: {
      name: string
      args?: string
      tabId?: string
    }): Promise<{ ok: boolean; busy?: boolean; error?: string }> =>
      ipcRenderer.invoke('agent:run-extension-command', input),
    resolveExtensionUi: (input: ExtensionUiDecision): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('agent:resolve-extension-ui', input),
    listInstructionFiles: (): Promise<LocalInstructionDocument[]> =>
      ipcRenderer.invoke('agent:list-instruction-files'),
    listWikiDocuments: (): Promise<WikiDocumentSummary[]> =>
      ipcRenderer.invoke('agent:list-wiki-documents'),
    getWikiDocument: (id: string): Promise<WikiDocument | undefined> =>
      ipcRenderer.invoke('agent:get-wiki-document', id),
    saveWikiDocument: (input: WikiSaveInput): Promise<WikiDocument> =>
      ipcRenderer.invoke('agent:save-wiki-document', input),
    deleteWikiDocument: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('agent:delete-wiki-document', id),
    searchWikiDocuments: (query: string): Promise<WikiDocument[]> =>
      ipcRenderer.invoke('agent:search-wiki-documents', query),
    pickPathReference: (
      kind: AgentPathReference['kind']
    ): Promise<AgentPathReference | undefined> =>
      ipcRenderer.invoke('agent:pick-path-reference', { kind }),
    importOpenApiDocument: (): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('agent:import-openapi-document'),
    savePastedAttachment: (input: PastedAttachmentInput): Promise<AgentPathReference> =>
      ipcRenderer.invoke('agent:save-pasted-attachment', input),
    requestMicrophonePermission: (): Promise<{ ok: boolean; granted: boolean }> =>
      ipcRenderer.invoke('agent:request-microphone-permission'),
    transcribeAudio: (input: TranscribeAudioInput): Promise<TranscribeAudioResult> =>
      ipcRenderer.invoke('agent:transcribe-audio', input),
    checkTranscriptionSupport: (input?: {
      forceRefresh?: boolean
      providerId?: string
      model?: string
    }): Promise<TranscriptionSupportResult> =>
      ipcRenderer.invoke('agent:check-transcription-support', input),
    saveRenderedImage: (input: {
      dataUrl: string
      defaultPath: string
    }): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('agent:save-rendered-image', input),
    saveSvgAsPng: (input: {
      svg: string
      defaultPath: string
      width: number
      height: number
    }): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('agent:save-svg-as-png', input),
    pickSavePath: (input: {
      defaultPath: string
      filters?: Array<{ name: string; extensions: string[] }>
    }): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('agent:pick-save-path', input),
    writeDataUrlFile: (input: {
      path: string
      dataUrl: string
    }): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('agent:write-data-url-file', input),
    saveInstructionFile: (input: {
      name: string
      content: string
    }): Promise<LocalInstructionDocument> =>
      ipcRenderer.invoke('agent:save-instruction-file', input),
    saveConfig: (config: Partial<AgentConfig>): Promise<AgentConfig> =>
      ipcRenderer.invoke('agent:save-config', config),
    validateConfig: (config: Partial<AgentConfig>): Promise<AgentValidationResult> =>
      ipcRenderer.invoke('agent:validate-config', config),
    generateCommand: (input: AgentCommandInput): Promise<AgentCommandResult> =>
      ipcRenderer.invoke('agent:generate-command', input),
    resolveConnectionIntent: (
      input: AgentConnectionIntentInput
    ): Promise<AgentConnectionIntentResult> =>
      ipcRenderer.invoke('agent:resolve-connection-intent', input),
    generateSop: (input: AgentGenerateSopInput): Promise<AgentGenerateSopResult> =>
      ipcRenderer.invoke('agent:generate-sop', input),
    reloadRuntime: (input?: AgentReloadRuntimeInput): Promise<AgentReloadRuntimeResult> =>
      ipcRenderer.invoke('agent:reload-runtime', input ?? {}),
    generateCaptureDraft: (
      input: AgentGenerateCaptureDraftInput
    ): Promise<AgentGenerateCaptureDraftResult> =>
      ipcRenderer.invoke('agent:generate-capture-draft', input),
    commitCaptureDraft: (
      input: AgentCommitCaptureDraftInput
    ): Promise<AgentCommitCaptureDraftResult> =>
      ipcRenderer.invoke('agent:commit-capture-draft', input),
    run: (input: AgentRunInput): Promise<{ ok: boolean; text?: string; error?: string }> =>
      ipcRenderer.invoke('agent:run', input),
    cancel: (runId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('agent:cancel', runId),
    rejectApprovalsForTab: (tabId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('agent:reject-approvals-for-tab', tabId),
    supplement: (input: { runId: string; input: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('agent:supplement', input),
    resolveCommandApproval: (input: CommandApprovalDecision): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('agent:resolve-command-approval', input),
    ackSubterminalOpened: (payload: {
      tabId: string
      ok: boolean
      error?: string
    }): Promise<{ ok: boolean }> => ipcRenderer.invoke('agent:ack-subterminal-opened', payload),
    onEvent: (callback: (event: AgentEvent) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, event: AgentEvent): void => callback(event)

      ipcRenderer.on('agent:event', listener)
      return () => ipcRenderer.removeListener('agent:event', listener)
    },
    onCommandApprovalRequest: (
      callback: (request: CommandApprovalRequest) => void
    ): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, request: CommandApprovalRequest): void =>
        callback(request)

      ipcRenderer.on('agent:command-approval-request', listener)
      return () => ipcRenderer.removeListener('agent:command-approval-request', listener)
    },
    onCommandApprovalDismiss: (
      callback: (payload: CommandApprovalDismiss) => void
    ): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: CommandApprovalDismiss): void =>
        callback(payload)

      ipcRenderer.on('agent:command-approval-dismiss', listener)
      return () => ipcRenderer.removeListener('agent:command-approval-dismiss', listener)
    },
    onCommandApprovalPurpose: (
      callback: (payload: CommandApprovalPurposeUpdate) => void
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: CommandApprovalPurposeUpdate
      ): void => callback(payload)

      ipcRenderer.on('agent:command-approval-purpose', listener)
      return () => ipcRenderer.removeListener('agent:command-approval-purpose', listener)
    },
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
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: {
          parentTabId: string
          tabId: string
          name: string
          mode: 'local' | 'ssh'
          terminalMode: 'pty' | 'pipe'
          connectionId?: string
          chatTabId?: string
        }
      ): void => callback(payload)

      ipcRenderer.on('agent:subterminal-opened', listener)
      return () => ipcRenderer.removeListener('agent:subterminal-opened', listener)
    },
    onSkillInstallEvent: (callback: (event: AgentSkillInstallEvent) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, event: AgentSkillInstallEvent): void =>
        callback(event)

      ipcRenderer.on('agent:skill-install-event', listener)
      return () => ipcRenderer.removeListener('agent:skill-install-event', listener)
    },
    onExtensionUiRequest: (callback: (request: ExtensionUiRequest) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, request: ExtensionUiRequest): void =>
        callback(request)

      ipcRenderer.on('agent:extension-ui-request', listener)
      return () => ipcRenderer.removeListener('agent:extension-ui-request', listener)
    },
    onExtensionUiDismiss: (callback: (payload: ExtensionUiDismiss) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: ExtensionUiDismiss): void =>
        callback(payload)

      ipcRenderer.on('agent:extension-ui-dismiss', listener)
      return () => ipcRenderer.removeListener('agent:extension-ui-dismiss', listener)
    }
  },
  connections: {
    list: (): Promise<ConnectionConfig[]> => ipcRenderer.invoke('connections:list'),
    resolve: (id: string): Promise<ConnectionConfig | undefined> =>
      ipcRenderer.invoke('connections:resolve', id),
    save: (input: ConnectionInput): Promise<ConnectionConfig[]> =>
      ipcRenderer.invoke('connections:save', input),
    delete: (id: string): Promise<ConnectionConfig[]> =>
      ipcRenderer.invoke('connections:delete', id),
    getLastUsed: (): Promise<string | null> => ipcRenderer.invoke('connections:get-last-used'),
    setLastUsed: (id: string): Promise<string | null> =>
      ipcRenderer.invoke('connections:set-last-used', id)
  },
  storage: {
    saveTabs: (tabs: StoredSessionTab[]): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('storage:save-tabs', tabs),
    saveAgentLog: (entry: StoredAgentLogEntry): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('storage:save-agent-log', entry),
    updateAgentLog: (
      input: Pick<StoredAgentLogEntry, 'tabId' | 'logId' | 'text'>
    ): Promise<{ ok: boolean }> => ipcRenderer.invoke('storage:update-agent-log', input),
    getAgentLog: (input: {
      tabId: string
      logId: number
    }): Promise<StoredAgentLogEntry | undefined> =>
      ipcRenderer.invoke('storage:get-agent-log', input),
    deleteAgentLogs: (input: {
      tabId: string
      logIds: number[]
    }): Promise<{ ok: boolean; removed: number }> =>
      ipcRenderer.invoke('storage:delete-agent-logs', input),
    saveAgentRun: (run: StoredAgentRun): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('storage:save-agent-run', run),
    getAgentRun: (runId: string): Promise<StoredAgentRun | undefined> =>
      ipcRenderer.invoke('storage:get-agent-run', runId),
    listAgentRuns: (input: { tabId: string; limit?: number }): Promise<StoredAgentRun[]> =>
      ipcRenderer.invoke('storage:list-agent-runs', input),
    listAllAgentRuns: (tabId: string): Promise<StoredAgentRun[]> =>
      ipcRenderer.invoke('storage:list-all-agent-runs', tabId),
    getSessionTokenUsage: (tabId: string): Promise<SessionTokenUsage> =>
      ipcRenderer.invoke('storage:get-session-token-usage', tabId),
    listAgentLogs: (input: {
      tabId: string
      beforeLogId?: number
      limit?: number
    }): Promise<StoredAgentLogEntry[]> => ipcRenderer.invoke('storage:list-agent-logs', input),
    countAgentLogs: (tabId: string): Promise<number> =>
      ipcRenderer.invoke('storage:count-agent-logs', tabId),
    listSessionHistory: (limit?: number): Promise<StoredSessionHistoryItem[]> =>
      ipcRenderer.invoke('storage:list-session-history', limit),
    getSessionHistory: (tabId: string): Promise<StoredSessionHistoryDetail | undefined> =>
      ipcRenderer.invoke('storage:get-session-history', tabId),
    renameSessionHistory: (input: { tabId: string; title: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('storage:rename-session-history', input),
    deleteSessionHistory: (tabId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('storage:delete-session-history', tabId),
    submitOpsFeedback: (input: SubmitOpsFeedbackInput): Promise<SubmitOpsFeedbackResult> =>
      ipcRenderer.invoke('storage:submit-ops-feedback', input),
    getOpsFeedback: (runId: string): Promise<OpsHistoryRecord | undefined> =>
      ipcRenderer.invoke('storage:get-ops-feedback', runId),
    listOpsFeedback: (input: {
      connectionId?: string
      limit?: number
    }): Promise<OpsHistoryRecord[]> => ipcRenderer.invoke('storage:list-ops-feedback', input),
    updateOpsFeedback: (input: UpdateOpsFeedbackInput): Promise<UpdateOpsFeedbackResult> =>
      ipcRenderer.invoke('storage:update-ops-feedback', input),
    deleteOpsFeedback: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('storage:delete-ops-feedback', id),
    onSessionSummaryUpdated: (
      callback: (event: StoredSessionSummaryUpdate) => void
    ): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, event: StoredSessionSummaryUpdate): void =>
        callback(event)

      ipcRenderer.on('storage:session-summary-updated', listener)
      return () => ipcRenderer.removeListener('storage:session-summary-updated', listener)
    }
  },
  update: {
    getVersion: (): Promise<AppUpdateVersionResult> => ipcRenderer.invoke('update:get-version'),
    check: (): Promise<AppUpdateActionResult> => ipcRenderer.invoke('update:check'),
    download: (): Promise<AppUpdateActionResult> => ipcRenderer.invoke('update:download'),
    downloadInstaller: (): Promise<AppUpdateActionResult> =>
      ipcRenderer.invoke('update:download-installer'),
    install: (): Promise<AppUpdateActionResult> => ipcRenderer.invoke('update:install'),
    onStatus: (callback: (event: AppUpdateStatusEvent) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, event: AppUpdateStatusEvent): void =>
        callback(event)
      ipcRenderer.on('update:status', listener)
      return () => ipcRenderer.removeListener('update:status', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
