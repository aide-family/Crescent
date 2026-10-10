import { ipcRenderer } from 'electron'
import type {
  AgentCancelHandoffInput,
  AgentCaptureRequestedPayload,
  AgentCommandInput,
  AgentCommandResult,
  AgentCommitCaptureDraftInput,
  AgentCommitCaptureDraftResult,
  AgentCompactInput,
  AgentCompactResult,
  AgentConfig,
  AgentConnectionIntentInput,
  AgentConnectionIntentResult,
  AgentEvent,
  AgentGenerateCaptureDraftInput,
  AgentGenerateCaptureDraftResult,
  AgentGenerateHandoffInput,
  AgentGenerateHandoffResult,
  AgentGenerateSopInput,
  AgentGenerateSopResult,
  AgentHandoffSessionInput,
  AgentHandoffStatus,
  AgentModelOption,
  AgentPathReference,
  AgentReloadRuntimeInput,
  AgentReloadRuntimeResult,
  AgentRunInput,
  AgentSkillInstallEvent,
  AgentSkillInstallResult,
  AgentSkillOption,
  AgentSkillSearchResult,
  AgentValidationResult,
  CommandApprovalDecision,
  CommandApprovalDismiss,
  CommandApprovalPurposeUpdate,
  CommandApprovalRequest,
  LocalInstructionDocument,
  PastedAttachmentInput,
  TranscribeAudioInput,
  TranscribeAudioResult,
  TranscriptionSupportResult,
  WikiDirectoryInfo,
  WikiDirectorySelectionResult,
  WikiDocument,
  WikiDocumentSummary,
  WikiSaveInput
} from '../../shared/agent-types'
import type {
  PlanApprovalDecision,
  PlanApprovalRequest,
  PlanProgress
} from '../../shared/execution-plan'

export const agentApi = {
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
  importSkill: (input?: {
    sourcePath?: string
    overwrite?: boolean
  }): Promise<{
    ok: boolean
    canceled?: boolean
    conflict?: boolean
    existingNames?: string[]
    sourcePath?: string
    error?: string
    skills?: AgentSkillOption[]
    imported?: string[]
  }> => ipcRenderer.invoke('agent:import-skill', input),
  deleteSkill: (path: string): Promise<AgentSkillOption[]> =>
    ipcRenderer.invoke('agent:delete-skill', path),
  getSkillContent: (path: string): Promise<string> =>
    ipcRenderer.invoke('agent:get-skill-content', path),
  getCatalogSkillContent: (input: {
    installSource: string
    installSkill?: string
    name: string
  }): Promise<string> => ipcRenderer.invoke('agent:get-catalog-skill-content', input),
  listInstructionFiles: (): Promise<LocalInstructionDocument[]> =>
    ipcRenderer.invoke('agent:list-instruction-files'),
  listWikiDocuments: (): Promise<WikiDocumentSummary[]> =>
    ipcRenderer.invoke('agent:list-wiki-documents'),
  getWikiDirectory: (): Promise<WikiDirectoryInfo> =>
    ipcRenderer.invoke('agent:get-wiki-directory'),
  chooseWikiDirectory: (): Promise<WikiDirectorySelectionResult> =>
    ipcRenderer.invoke('agent:choose-wiki-directory'),
  resetWikiDirectory: (): Promise<WikiDirectoryInfo> =>
    ipcRenderer.invoke('agent:reset-wiki-directory'),
  getWikiDocument: (id: string): Promise<WikiDocument | undefined> =>
    ipcRenderer.invoke('agent:get-wiki-document', id),
  saveWikiDocument: (input: WikiSaveInput): Promise<WikiDocument> =>
    ipcRenderer.invoke('agent:save-wiki-document', input),
  deleteWikiDocument: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('agent:delete-wiki-document', id),
  searchWikiDocuments: (query: string): Promise<WikiDocument[]> =>
    ipcRenderer.invoke('agent:search-wiki-documents', query),
  pickPathReference: (kind: AgentPathReference['kind']): Promise<AgentPathReference | undefined> =>
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
  }): Promise<LocalInstructionDocument> => ipcRenderer.invoke('agent:save-instruction-file', input),
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
  handoffStatus: (input: AgentHandoffSessionInput): Promise<AgentHandoffStatus> =>
    ipcRenderer.invoke('agent:handoff-status', input),
  generateHandoff: (input: AgentGenerateHandoffInput): Promise<AgentGenerateHandoffResult> =>
    ipcRenderer.invoke('agent:generate-handoff', input),
  cancelHandoff: (input: AgentCancelHandoffInput): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('agent:cancel-handoff', input),
  compact: (input: AgentCompactInput): Promise<AgentCompactResult> =>
    ipcRenderer.invoke('agent:compact', input),
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
  resolvePlanApproval: (input: PlanApprovalDecision): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('agent:resolve-plan-approval', input),
  onPlanApprovalRequest: (callback: (request: PlanApprovalRequest) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, request: PlanApprovalRequest): void =>
      callback(request)
    ipcRenderer.on('agent:plan-approval-request', listener)
    return () => ipcRenderer.removeListener('agent:plan-approval-request', listener)
  },
  onPlanProgress: (callback: (progress: PlanProgress) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, progress: PlanProgress): void =>
      callback(progress)
    ipcRenderer.on('agent:plan-progress', listener)
    return () => ipcRenderer.removeListener('agent:plan-progress', listener)
  },
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
  onCommandApprovalRequest: (callback: (request: CommandApprovalRequest) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, request: CommandApprovalRequest): void =>
      callback(request)

    ipcRenderer.on('agent:command-approval-request', listener)
    return () => ipcRenderer.removeListener('agent:command-approval-request', listener)
  },
  onCommandApprovalDismiss: (callback: (payload: CommandApprovalDismiss) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: CommandApprovalDismiss): void =>
      callback(payload)

    ipcRenderer.on('agent:command-approval-dismiss', listener)
    return () => ipcRenderer.removeListener('agent:command-approval-dismiss', listener)
  },
  onCommandApprovalPurpose: (
    callback: (payload: CommandApprovalPurposeUpdate) => void
  ): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: CommandApprovalPurposeUpdate): void =>
      callback(payload)

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
      agentName?: string
      agentStatus?: 'running' | 'done' | 'error'
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
        agentName?: string
        agentStatus?: 'running' | 'done' | 'error'
      }
    ): void => callback(payload)

    ipcRenderer.on('agent:subterminal-opened', listener)
    return () => ipcRenderer.removeListener('agent:subterminal-opened', listener)
  },
  onSubagentStatus: (
    callback: (payload: {
      parentTabId: string
      tabId: string
      name: string
      agentName: string
      agentStatus: 'running' | 'done' | 'error'
      close?: boolean
    }) => void
  ): (() => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      payload: {
        parentTabId: string
        tabId: string
        name: string
        agentName: string
        agentStatus: 'running' | 'done' | 'error'
        close?: boolean
      }
    ): void => callback(payload)

    ipcRenderer.on('agent:subagent-status', listener)
    return () => ipcRenderer.removeListener('agent:subagent-status', listener)
  },
  onCaptureRequested: (callback: (payload: AgentCaptureRequestedPayload) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: AgentCaptureRequestedPayload): void =>
      callback(payload)

    ipcRenderer.on('agent:capture-requested', listener)
    return () => ipcRenderer.removeListener('agent:capture-requested', listener)
  },
  onSkillInstallEvent: (callback: (event: AgentSkillInstallEvent) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: AgentSkillInstallEvent): void =>
      callback(event)

    ipcRenderer.on('agent:skill-install-event', listener)
    return () => ipcRenderer.removeListener('agent:skill-install-event', listener)
  }
}
