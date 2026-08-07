import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent
} from 'react'
import { flushSync } from 'react-dom'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import {
  ArrowLeftRightIcon,
  BookOpenIcon,
  BotIcon,
  CheckIcon,
  HistoryIcon,
  LanguagesIcon,
  Loader2Icon,
  PlugIcon,
  PlusIcon,
  ServerIcon,
  TestTube2Icon,
  TriangleAlertIcon,
  XIcon
} from 'lucide-react'
import { toast, Toaster } from 'sonner'

import { AgentPanel } from '@renderer/components/AgentPanel'
import { AppFooter } from '@renderer/components/AppFooter'
import {
  CloseTabsConfirmModal,
  type CloseTabsConfirmRequest,
  type PasswordPromptRequest
} from '@renderer/components/AppModals'
import { ConnectionManagerModal } from '@renderer/components/ConnectionManagerModal'
import { extractResultMarkdown } from '@renderer/lib/agent-run-markdown'
import { SettingsSheet } from '@renderer/components/SettingsSheet'
import { ProductLogo } from '@renderer/components/ProductLogo'
import {
  McpStatusDot,
  type SkillInstallLogStatus,
  type SkillManageMessage
} from '@renderer/components/StatusIndicators'
import { TerminalPane } from '@renderer/components/TerminalPane'
import { HistoryPanel } from '@renderer/components/HistoryPanel'
import { OnboardingModal } from '@renderer/components/OnboardingModal'
import { SkillManager } from '@renderer/components/SkillManager'
import { WikiSheet } from '@renderer/components/WikiSheet'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  dictionaries,
  localeOptions,
  resolveInitialLocale,
  type Dictionary,
  type Locale
} from '@renderer/i18n'
import { useAgentRuns } from '@renderer/hooks/useAgentRuns'
import {
  connectionToForm,
  createEmptyConnectionForm,
  normalizeConnectionInputForSave,
  useConnections
} from '@renderer/hooks/useConnections'
import { useSettings } from '@renderer/hooks/useSettings'
import {
  planCloseTabPromotion,
  reassignSessionRootOnClose,
  useTerminalTabs
} from '@renderer/hooks/useTerminalTabs'
import { useTerminalSessions } from '@renderer/hooks/useTerminalSessions'
import { useXtermLifecycle } from '@renderer/hooks/useXtermLifecycle'
import {
  appendElapsedFooter,
  connectionFailureMarkers,
  formatAgentRunMarkdown,
  hydrateStoredAgentLog,
  isConnectionFailureLog
} from '@renderer/lib/agent-log'
import { resolveSuccessfulAgentResult } from '@renderer/lib/agent-run-finalize'
import { closeStreamingOpenSteps } from '@renderer/lib/agent-run-document'
import { suggestWhitelistRule } from '@renderer/lib/command-whitelist'
import {
  buildTraceFromAgentLogEntry,
  buildTraceFromAgentRunView,
  formatTraceExport
} from '@renderer/lib/agent-run-trace-export'
import {
  buildAvailableToolRefs,
  flattenProviderModels,
  formatMcpArgs,
  formatMcpEnv,
  formatProviderModels,
  parseCommandWhitelist,
  parseMcpArgs,
  parseMcpEnv,
  parseProviderModels
} from '@renderer/lib/agent-config'
import {
  CLOSE_TERMINAL_CONFIRM_STORAGE_KEY,
  PANE_ORDER_STORAGE_KEY,
  formatPipePrompt,
  hasConfiguredModelSelection,
  resolveInitialPaneOrder,
  type PaneOrder
} from '@renderer/lib/app-shell'
import {
  isBrowserSpeechAvailable,
  isWhisperUnavailableError,
  startVoiceInputSession,
  type VoiceLiveSession
} from '@renderer/lib/voice-input'
import {
  WIKI_MIN_PREVIEW_WIDTH,
  WIKI_REFRESH_MIN_LOADING_MS,
  WIKI_SHEET_SELECTED_FIXED_WIDTH,
  buildModelSelectionValue,
  getDefaultWikiPreviewWidth,
  isLocalConnection,
  parseModelSelectionValue,
  resolveOpsConnectionId,
  wait
} from '@renderer/lib/app-runtime'
import {
  addUniquePathRef,
  addUniqueSkillRef,
  addUniqueToolRef,
  addUniqueWikiRef,
  buildAgentInputWithReferences,
  buildCurrentTerminalAgentInput,
  buildPostLoginAgentInput,
  buildRecentConversationContext,
  buildResumeAgentInput,
  formatVisibleInputWithReferences,
  hasUsableCurrentTerminal,
  isContinueIntent,
  isExplicitConnectionRequest,
  isExplicitNonTerminalAgentRequest
} from '@renderer/lib/agent-input'
import { hasExplicitLocalFileOperationIntent } from '../../shared/agent-local-intent'
import {
  buildConnectionCommands,
  buildConnectionLoginActions,
  createCustomConnectionId,
  formatConnectionActionLog,
  isPasswordEnvVarMissing,
  mergeConnectionInput
} from '@renderer/lib/connection-commands'
import {
  formatConnectionAutomationFailure,
  shouldDrainPostConnectionTasks
} from '@renderer/lib/connection-automation-policy'
import { formatConnectionTarget } from '@renderer/lib/connections'
import { formatSuggestionsForInput, routeConnection, looksLikeRemoteOpsIntent, formatConnectionClarifyOptions, isExecutionTerminalReadyForAgent } from '@renderer/lib/connection-route'
import { getMcpServerStatus } from '@renderer/lib/mcp-status'
import {
  copyFeedback,
  copyText,
  downloadJson,
  downloadMarkdown,
  notifyOperationError
} from '@renderer/lib/operation-feedback'
import {
  buildInstalledSkillNameSet,
  buildSkillInstallCommand,
  filterLocalSkills
} from '@renderer/lib/skill-management'
import {
  extractPasswordPromptLine,
  hasInteractivePrompt,
  hasOutputBeyondEcho,
  isTerminalCurrentlyAtPasswordPrompt,
  parseSubterminalTabId
} from '@renderer/lib/terminal-text'
import {
  createTerminalTab,
  getNextTerminalTitle,
  getSessionChatTab,
  getSessionGroupId,
  getSessionTerminals,
  getTerminalDisplayTitle,
  isReservedTerminalTabId,
  resolveSessionChatTabId,
  resolveTabModelSelection,
  type AgentLogEntry,
  type AgentRunViewState,
  type AgentTerminalTab,
  type AgentToolReference
} from '@renderer/lib/terminal-tabs'
import {
  buildWikiContentFromHistory,
  filterWikiDocuments,
  upsertWikiSummary
} from '@renderer/lib/wiki'
import {
  buildConnectionSlashCommand,
  buildMcpSlashCommand,
  buildModeSlashCommands,
  buildSkillSlashCommand,
  buildSlashCommandOptions,
  buildToolSlashCommand,
  buildWikiSlashCommand,
  getSlashCommandQuery,
  isConnectionSlashQuery,
  isMcpSlashQuery,
  isModeSlashQuery,
  isToolSlashQuery,
  isWikiSlashQuery,
  matchesConnectionSlashCommand,
  matchesMcpSlashCommand,
  matchesModeSlashCommand,
  matchesSkillSlashCommand,
  matchesSlashCommand,
  matchesToolSlashCommand,
  matchesWikiSlashCommand,
  replaceSlashCommandInput,
  type SlashCommandOption
} from '@renderer/lib/slash-commands'
import type {
  AgentConfig,
  AgentMcpServerConfig,
  AgentModelOption,
  AgentOpenApiProfile,
  AgentPathReference,
  AgentProviderConfig,
  AgentSkillInstallEvent,
  AgentSkillSearchResult,
  AgentValidationResult,
  AgentSkillOption,
  AgentWikiReference,
  AgentConnectionIntentResult,
  ConnectionConfig,
  ConnectionInput,
  LocalInstructionDocument,
  StoredSessionHistoryItem,
  WikiDocument,
  WikiDocumentSummary
} from '../../shared/agent-types'
import {
  createEmptyOpenApiProfile,
  updateOpenApiProfileInConfig,
  resolveActiveOpenApiProfile,
  withActiveOpenApiProfile
} from '../../shared/openapi-profiles'
import {
  createExampleOpenApiProfile,
  dismissOnboarding,
  shouldShowOnboarding
} from '@renderer/lib/onboarding'
import { formatToolNameListText, parseToolNameListText } from '../../shared/tool-policy'

const emptyConfig: AgentConfig = {
  providers: [],
  providerId: undefined,
  model: '',
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
  skillRoot: '~/.agents/skills',
  mcpServers: []
}
const emptyProvider: AgentProviderConfig = {
  id: '',
  name: '',
  baseUrl: '',
  apiKey: '',
  models: []
}
const emptyMcpServer: AgentMcpServerConfig = {
  id: '',
  name: '',
  transport: 'stdio',
  command: '',
  args: [],
  env: {},
  enabled: true
}

interface ReuseAgentRun {
  logId: number
  runId: string
}

interface PostConnectionTask {
  input: string
  displayInput: string
  conversationContext?: string
  connection: ConnectionConfig
  appendUserLog: boolean
  startedAt: number
  reuseRun?: ReuseAgentRun
}

const initialTerminalTab = createTerminalTab({ title: 'Terminal' })
const emptyLocalTab = createTerminalTab({ title: 'Terminal' })

function App(): React.JSX.Element {
  const terminalHostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const terminalSessionIdRef = useRef<number | null>(null)
  const terminalModeRef = useRef<'pty' | 'pipe'>('pty')
  const terminalCwdRef = useRef('')
  const pipePromptRef = useRef('')
  const activeRunCanceledRef = useRef(new Set<string>())
  const activeRunIdRef = useRef(new Map<string, string>())
  const activeRunInputRef = useRef(new Map<string, string>())
  const activeExecutionTabIdRef = useRef(new Map<string, string>())
  const [executionTerminalByChatId, setExecutionTerminalByChatId] = useState<
    Record<string, string>
  >({})
  const passwordPromptsByTabRef = useRef(new Map<string, PasswordPromptRequest>())
  const validationRequestRef = useRef(0)
  const nextLogIdRef = useRef(1)
  const agentLogRef = useRef<HTMLDivElement | null>(null)
  const agentInputRef = useRef<HTMLTextAreaElement | null>(null)
  const passwordPromptInputRef = useRef<HTMLInputElement | null>(null)
  const slashCommandListRef = useRef<HTMLDivElement | null>(null)
  const activeTabIdRef = useRef(initialTerminalTab.id)
  const tabsRef = useRef<AgentTerminalTab[]>([])
  const connectionsRef = useRef<ConnectionConfig[]>([])
  const subterminalResizeRef = useRef<{
    tabId: string
    leftId: string
    rightId: string
    startX: number
    leftStart: number
    rightStart: number
  } | null>(null)
  const subterminalHeightResizeRef = useRef<{
    startY: number
    startHeight: number
  } | null>(null)
  const wikiSheetResizeRef = useRef<{
    startX: number
    startWidth: number
  } | null>(null)
  const pendingSshRef = useRef(new Map<string, ConnectionConfig>())
  const postConnectionTasksRef = useRef(new Map<string, PostConnectionTask[]>())
  const reconnectingTabsRef = useRef(new Set<string>())
  const suppressTerminalReconnectRef = useRef(new Set<string>())
  const automatedLoginTabsRef = useRef(new Set<string>())
  const skipConnectionReconnectRef = useRef(new Set<string>())
  const restoreTerminalSessionRef = useRef<((tabId: string) => Promise<boolean>) | null>(null)
  const passwordPromptBuffersRef = useRef(new Map<string, string>())
  const passwordPromptOpenTabsRef = useRef(new Set<string>())
  const passwordPromptRequestRef = useRef<PasswordPromptRequest | null>(null)
  const runAgentConversationRef = useRef<
    | ((
        input: string,
        tabId: string,
        connectionId?: string,
        displayInput?: string,
        appendUserLog?: boolean,
        startedAt?: number,
        options?: {
          allowTerminalTools?: boolean
          conversationContext?: string
          chatTabId?: string
          reuseRun?: ReuseAgentRun
        }
      ) => Promise<void>)
    | null
  >(null)
  const activeAgentRunRef = useRef(new Map<string, AgentRunViewState>())
  const skillInstallResultIdsRef = useRef(new Map<string, string>())
  const skillInstallNamesRef = useRef(new Map<string, string>())
  const splitDragRef = useRef(false)
  const [config, setConfig] = useState<AgentConfig>(emptyConfig)
  const [commandWhitelistText, setCommandWhitelistText] = useState('')
  const [providerModelsText, setProviderModelsText] = useState(
    formatProviderModels(emptyConfig.providers[0]?.models ?? [])
  )
  const [models, setModels] = useState<AgentModelOption[]>([])
  const [skills, setSkills] = useState<AgentSkillOption[]>([])
  const [localSkillSearchQuery, setLocalSkillSearchQuery] = useState('')
  const [skillSearchQuery, setSkillSearchQuery] = useState('')
  const [skillSearchResults, setSkillSearchResults] = useState<AgentSkillSearchResult[]>([])
  const [skillSearchLoading, setSkillSearchLoading] = useState(false)
  const [skillDeletingPath, setSkillDeletingPath] = useState<string | null>(null)
  const [copiedSkillCommandId, setCopiedSkillCommandId] = useState<string | null>(null)
  const [skillManageMessage, setSkillManageMessage] = useState<SkillManageMessage | null>(null)
  const [skillInstallIds, setSkillInstallIds] = useState<Record<string, string>>({})
  const [skillInstallLogs, setSkillInstallLogs] = useState<Record<string, string>>({})
  const [skillInstallLogNames, setSkillInstallLogNames] = useState<Record<string, string>>({})
  const [skillInstallLogStatuses, setSkillInstallLogStatuses] = useState<
    Record<string, SkillInstallLogStatus>
  >({})
  const [skillInstallLogCreatedAt, setSkillInstallLogCreatedAt] = useState<Record<string, number>>(
    {}
  )
  const [skillInstallLogResultId, setSkillInstallLogResultId] = useState<string | null>(null)
  const [selectedSkillPreview, setSelectedSkillPreview] = useState<{
    skill: AgentSkillOption
    content: string
  } | null>(null)
  const [skillPreviewLoadingPath, setSkillPreviewLoadingPath] = useState<string | null>(null)
  const [copiedSkillInstallLogId, setCopiedSkillInstallLogId] = useState<string | null>(null)
  const [skillInstallCancelingIds, setSkillInstallCancelingIds] = useState<Record<string, boolean>>(
    {}
  )
  const [instructionFiles, setInstructionFiles] = useState<LocalInstructionDocument[]>([])
  const [selectedInstructionName, setSelectedInstructionName] = useState('IDENTITY.md')
  const [instructionContent, setInstructionContent] = useState('')
  const [instructionSaved, setInstructionSaved] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [skillOpen, setSkillOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldShowOnboarding())
  const [mcpOpen, setMcpOpen] = useState(false)
  const [providerEditorOpen, setProviderEditorOpen] = useState(false)
  const [openApiEditorOpen, setOpenApiEditorOpen] = useState(false)
  const [instructionEditorOpen, setInstructionEditorOpen] = useState(false)
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [opsFeedbackByLogId, setOpsFeedbackByLogId] = useState<Record<number, 'like' | 'dislike'>>(
    {}
  )
  const [opsFeedbackBusyLogId, setOpsFeedbackBusyLogId] = useState<number | null>(null)
  const [voiceInputState, setVoiceInputState] = useState<'idle' | 'recording' | 'transcribing'>(
    'idle'
  )
  const [voiceWhisperSupported, setVoiceWhisperSupported] = useState(false)
  const [voiceBrowserSpeechAvailable] = useState(() => isBrowserSpeechAvailable())
  const [voiceInputSupportChecking, setVoiceInputSupportChecking] = useState(true)
  const voiceLiveSessionRef = useRef<VoiceLiveSession | null>(null)
  const voiceInputSupported = voiceWhisperSupported || voiceBrowserSpeechAvailable
  const [historyItems, setHistoryItems] = useState<StoredSessionHistoryItem[]>([])
  const [historyTitleEditingId, setHistoryTitleEditingId] = useState<string | null>(null)
  const [historyTitleDraft, setHistoryTitleDraft] = useState('')
  const [historyTitleSavingId, setHistoryTitleSavingId] = useState<string | null>(null)
  const [wikiOpen, setWikiOpen] = useState(false)
  const [wikiLoading, setWikiLoading] = useState(false)
  const [wikiDocumentLoadingId, setWikiDocumentLoadingId] = useState<string | null>(null)
  const [wikiDocuments, setWikiDocuments] = useState<WikiDocumentSummary[]>([])
  const [selectedWikiDocument, setSelectedWikiDocument] = useState<WikiDocument | null>(null)
  const [wikiSearchQuery, setWikiSearchQuery] = useState('')
  const [wikiEditing, setWikiEditing] = useState(false)
  const [wikiEditContent, setWikiEditContent] = useState('')
  const [wikiSaving, setWikiSaving] = useState(false)
  const [wikiDeletingId, setWikiDeletingId] = useState<string | null>(null)
  const [wikiMessage, setWikiMessage] = useState<SkillManageMessage | null>(null)
  const [wikiPreviewWidth, setWikiPreviewWidth] = useState(620)
  const [savingHistoryWikiTabId, setSavingHistoryWikiTabId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [validation, setValidation] = useState<AgentValidationResult | undefined>()
  const [validating, setValidating] = useState(false)
  const [importingOpenApi, setImportingOpenApi] = useState(false)
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [passwordPromptRequest, setPasswordPromptRequest] = useState<PasswordPromptRequest | null>(
    null
  )
  const [passwordPromptValue, setPasswordPromptValue] = useState('')
  const [passwordPromptError, setPasswordPromptError] = useState('')
  const [connectionModalOpen, setConnectionModalOpen] = useState(false)
  const [connectionSearchQuery, setConnectionSearchQuery] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [connectionEditing, setConnectionEditing] = useState(true)
  const [connectionForm, setConnectionForm] = useState<ConnectionInput>(createEmptyConnectionForm)
  const [connectionSshOptionsText, setConnectionSshOptionsText] = useState('')
  const [connectionActionsText, setConnectionActionsText] = useState('')
  const [connectionImportText, setConnectionImportText] = useState('')
  const [connectionSaveMessage, setConnectionSaveMessage] = useState<SkillManageMessage | null>(
    null
  )
  const [terminalPanePercent, setTerminalPanePercent] = useState(65)
  const [subterminalPanelHeight, setSubterminalPanelHeight] = useState(256)
  const [subterminalCollapsed, setSubterminalCollapsed] = useState(false)
  const [hiddenPane, setHiddenPane] = useState<'terminal' | 'chat' | null>('terminal')
  const [paneOrder, setPaneOrder] = useState<PaneOrder>(() => resolveInitialPaneOrder())
  const [terminalPage, setTerminalPage] = useState<'terminal' | 'connections'>('terminal')
  const [slashCommandOpen, setSlashCommandOpen] = useState(true)
  const [slashCommandIndex, setSlashCommandIndex] = useState(0)
  const [locale, setLocale] = useState<Locale>(() => resolveInitialLocale())
  const [closeTerminalConfirmEnabled, setCloseTerminalConfirmEnabled] = useState(
    () => localStorage.getItem(CLOSE_TERMINAL_CONFIRM_STORAGE_KEY) !== 'false'
  )
  const [closeTabsConfirmRequest, setCloseTabsConfirmRequest] =
    useState<CloseTabsConfirmRequest | null>(null)
  const [settingsProviderId, setSettingsProviderId] = useState('')
  const [settingsMcpServerId, setSettingsMcpServerId] = useState('')
  const [mcpArgsText, setMcpArgsText] = useState('')
  const [mcpEnvText, setMcpEnvText] = useState('')
  const [tabs, setTabs] = useState<AgentTerminalTab[]>([initialTerminalTab])
  const [activeTabId, setActiveTabId] = useState(initialTerminalTab.id)
  const [tabMenu, setTabMenu] = useState<{
    tabId: string
    x: number
    y: number
  } | null>(null)
  const {
    updateTab,
    updateSubterminalOutput,
    updateSubterminalCwd,
    updateSubterminalStatus,
    ensureSubterminal,
    closeSubterminal,
    closeAllSubterminals,
    resizeSubterminalPair
  } = useTerminalSessions({ tabsRef, setTabs })
  const t = dictionaries[locale]
  const {
    activeTab,
    sessionChatTab,
    sessionTerminals,
    sessionChatTabs,
    terminalTabs,
    activeAgentPending,
    selectSessionTab,
    openLocalTerminal
  } = useTerminalTabs({
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    activeTabIdRef,
    tabsRef,
    terminalPage,
    setTerminalPage,
    setHiddenPane,
    emptyLocalTab,
    updateTab,
    localTerminalTitle: t.connections.localTerminal,
    providerId: config.providerId
  })

  useEffect(() => {
    const connectionId = resolveOpsConnectionId(
      activeTab.connectionId ||
        sessionChatTab.connectionId ||
        sessionTerminals.find((tab) => tab.connectionId)?.connectionId
    )
    const assistantEntries = sessionChatTab.agentLog.filter((entry) => entry.kind === 'assistant')
    if (assistantEntries.length === 0) return

    let cancelled = false
    void (async () => {
      const [records, runs] = await Promise.all([
        window.api.storage.listOpsFeedback({ connectionId, limit: 40 }),
        window.api.storage.listAgentRuns({ tabId: sessionChatTab.id, limit: 40 })
      ])
      if (cancelled || records.length === 0) return

      const ratingByRunId = new Map(records.map((record) => [record.runId, record.rating]))
      const next: Record<number, 'like' | 'dislike'> = {}
      for (const entry of assistantEntries) {
        const activeRun = [...activeAgentRunRef.current.values()].find(
          (run) => run.logId === entry.id && run.runId
        )
        const resultText = extractResultMarkdown(entry.text, t)
        const matchedRun =
          (activeRun?.runId ? runs.find((run) => run.runId === activeRun.runId) : undefined) ??
          runs.find((run) => run.output && resultText && run.output.trim() === resultText.trim()) ??
          runs.find(
            (run) =>
              Math.abs(Date.parse(run.startedAt ?? '') - Date.parse(entry.createdAt)) < 5 * 60_000
          )
        const rating = matchedRun ? ratingByRunId.get(matchedRun.runId) : undefined
        if (rating) next[entry.id] = rating
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setOpsFeedbackByLogId((current) => ({ ...current, ...next }))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    activeTab.connectionId,
    sessionChatTab.agentLog,
    sessionChatTab.connectionId,
    sessionChatTab.id,
    sessionTerminals,
    t
  ])

  const connectionRecovery = useMemo(() => {
    const markers = connectionFailureMarkers(t)
    const latestError = [...sessionChatTab.agentLog]
      .reverse()
      .find((entry) => entry.kind === 'error')
    const visible = Boolean(latestError && isConnectionFailureLog(latestError.text, markers))
    const canRetry = Boolean(
      activeTab.connectionId ||
      sessionChatTab.connectionId ||
      sessionTerminals.some((tab) => Boolean(tab.connectionId))
    )
    return { visible, canRetry }
  }, [
    activeTab.connectionId,
    sessionChatTab.agentLog,
    sessionChatTab.connectionId,
    sessionTerminals,
    t
  ])
  const {
    appendLog,
    updateAgentRun,
    appendAgentEvent,
    liveRunByLogId,
    attachApprovalRequest,
    resolveApprovalStep
  } = useAgentRuns({
    activeTabIdRef,
    nextLogIdRef,
    activeAgentRunRef,
    activeRunCanceledRef,
    updateTab,
    t
  })
  const { configured, modelOptions, visibleModels, settingsProvider, settingsMcpServer } =
    useSettings({
      config,
      models,
      settingsProviderId,
      settingsMcpServerId,
      emptyProvider,
      emptyMcpServer
    })
  const activeTabProviderId = sessionChatTab.providerId ?? config.providerId
  const activeProviderId = config.providers.some((provider) => provider.id === activeTabProviderId)
    ? (activeTabProviderId ?? config.providers[0]?.id ?? '')
    : (visibleModels.find((model) => model.id === (sessionChatTab.model ?? config.model))
        ?.providerId ??
      config.providers[0]?.id ??
      '')
  const filteredModels = visibleModels.filter((model) => model.providerId === activeProviderId)
  const activeTabModelId =
    sessionChatTab.model && filteredModels.some((model) => model.id === sessionChatTab.model)
      ? sessionChatTab.model
      : (filteredModels[0]?.id ?? config.model)
  const activeModel = visibleModels.find(
    (model) => model.id === activeTabModelId && model.providerId === activeProviderId
  )
  const activeModelSelectionValue = buildModelSelectionValue(activeProviderId, activeTabModelId)
  const availableToolRefs = useMemo(() => buildAvailableToolRefs(validation), [validation])
  const mcpToolRefs = useMemo(
    () => availableToolRefs.filter((tool) => tool.source === 'mcp'),
    [availableToolRefs]
  )
  const mcpServerToolCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tool of validation?.tools ?? []) {
      const match = /^mcp:\/\/([^/]+)\//.exec(tool.path)
      if (!match) continue
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
    }
    return counts
  }, [validation])
  const mcpServerTools = useMemo(() => {
    const tools = new Map<string, NonNullable<AgentValidationResult['tools']>>()
    for (const tool of validation?.tools ?? []) {
      const match = /^mcp:\/\/([^/]+)\//.exec(tool.path)
      if (!match) continue
      const serverTools = tools.get(match[1]) ?? []
      serverTools.push(tool)
      tools.set(match[1], serverTools)
    }
    return tools
  }, [validation])
  const settingsMcpTools = mcpServerTools.get(settingsMcpServer.id) ?? []
  const filteredWikiDocuments = useMemo(
    () => filterWikiDocuments(wikiDocuments, wikiSearchQuery),
    [wikiDocuments, wikiSearchQuery]
  )
  const selectedInstructionFile = instructionFiles.find(
    (file) => file.name === selectedInstructionName
  )
  const modelValidationError =
    validation?.modelOk === false ? validation.error?.trim() || t.common.error : undefined
  const aiState: 'ready' | 'pending' | 'not-ready' = validating
    ? 'pending'
    : modelValidationError
      ? 'not-ready'
      : 'ready'
  const aiStatusText = validating
    ? t.app.aiPending
    : modelValidationError
      ? `${t.app.aiNotReady}: ${modelValidationError}`
      : t.app.aiReady
  const shellState: 'ready' | 'pending' | 'not-ready' = activeTab.terminalReady
    ? 'ready'
    : activeTab.sessionId
      ? 'not-ready'
      : 'pending'
  const terminalVisible = hiddenPane !== 'terminal' && terminalPage === 'terminal'
  const {
    displayConnections,
    filteredDisplayConnections,
    connectionFormReady,
    connectionCommandPreview
  } = useConnections({
    connections,
    query: connectionSearchQuery,
    connectionForm,
    connectionSshOptionsText,
    localTerminalLabel: t.connections.localTerminal,
    localTerminalDescription: t.connections.defaultTerminal
  })
  const slashCommandQuery = getSlashCommandQuery(sessionChatTab.agentInput)
  const slashCommandOptions = useMemo(() => {
    if (slashCommandQuery === undefined) return []

    if (isModeSlashQuery(slashCommandQuery)) {
      return buildModeSlashCommands(t).filter((command) =>
        matchesModeSlashCommand(command, slashCommandQuery ?? '')
      )
    }
    if (isToolSlashQuery(slashCommandQuery)) {
      return availableToolRefs
        .map((tool) => buildToolSlashCommand(tool))
        .filter((command) => matchesToolSlashCommand(command, slashCommandQuery ?? ''))
    }
    if (isMcpSlashQuery(slashCommandQuery)) {
      return mcpToolRefs
        .map((tool) => buildMcpSlashCommand(tool, t))
        .filter((command) => matchesMcpSlashCommand(command, slashCommandQuery ?? ''))
    }
    if (isWikiSlashQuery(slashCommandQuery)) {
      return wikiDocuments
        .map((document) => buildWikiSlashCommand(document, t))
        .filter((command) => matchesWikiSlashCommand(command, slashCommandQuery ?? ''))
    }
    if (slashCommandQuery?.startsWith('skill:')) {
      return skills
        .map((skill) => buildSkillSlashCommand(skill, t))
        .filter((command) => matchesSkillSlashCommand(command, slashCommandQuery))
    }
    if (isConnectionSlashQuery(slashCommandQuery)) {
      return connections
        .map((connection) => buildConnectionSlashCommand(connection, t))
        .filter((command) => matchesConnectionSlashCommand(command, slashCommandQuery ?? ''))
    }

    return buildSlashCommandOptions(t).filter((command) =>
      matchesSlashCommand(command, slashCommandQuery)
    )
  }, [availableToolRefs, connections, mcpToolRefs, skills, slashCommandQuery, t, wikiDocuments])
  const slashMenuVisible =
    slashCommandOpen && slashCommandQuery !== undefined && slashCommandOptions.length > 0
  const selectedSlashCommandIndex = slashCommandOptions.length
    ? Math.min(slashCommandIndex, slashCommandOptions.length - 1)
    : 0
  const failedToLoadConfigText = t.terminal.failedToLoadConfig
  const failedToLoadConnectionsText = t.terminal.failedToLoadConnections
  const failedToLoadModelsText = t.terminal.failedToLoadModels
  const terminalPaneFirst = paneOrder === 'terminal-chat'

  useEffect(() => {
    if (!slashMenuVisible) return

    const selectedItem = slashCommandListRef.current?.querySelector<HTMLElement>(
      `[data-slash-command-index="${selectedSlashCommandIndex}"]`
    )
    selectedItem?.scrollIntoView({ block: 'nearest' })
  }, [selectedSlashCommandIndex, slashCommandOptions.length, slashMenuVisible])

  const filteredLocalSkills = useMemo(
    () => filterLocalSkills(skills, localSkillSearchQuery),
    [localSkillSearchQuery, skills]
  )
  const installedSkillNames = useMemo(() => buildInstalledSkillNameSet(skills), [skills])

  const refreshSessionHistory = useCallback(async (): Promise<void> => {
    setHistoryLoading(true)
    try {
      const items = await window.api.storage.listSessionHistory(100)
      setHistoryItems(items)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  function setHistorySheetOpen(open: boolean): void {
    setHistoryOpen(open)
    if (open) void refreshSessionHistory()
  }

  const refreshWikiDocuments = useCallback(async (): Promise<void> => {
    const startedAt = Date.now()
    setWikiLoading(true)
    try {
      const documents = await window.api.agent.listWikiDocuments()
      setWikiDocuments(documents)
      setSelectedWikiDocument((current) =>
        current && documents.some((document) => document.id === current.id) ? current : null
      )
    } catch (error) {
      setWikiMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      const elapsed = Date.now() - startedAt
      if (elapsed < WIKI_REFRESH_MIN_LOADING_MS) {
        await wait(WIKI_REFRESH_MIN_LOADING_MS - elapsed)
      }
      setWikiLoading(false)
    }
  }, [])

  function setWikiSheetOpen(open: boolean): void {
    setWikiOpen(open)
    if (open) {
      setWikiEditing(false)
      setWikiMessage(null)
      void refreshWikiDocuments()
    }
  }

  runAgentConversationRef.current = runAgentConversation

  const abortPostConnectionTasks = useCallback(
    (targetTabId: string, reason: string): void => {
      const tasks = postConnectionTasksRef.current.get(targetTabId) ?? []
      postConnectionTasksRef.current.delete(targetTabId)
      if (tasks.length === 0) return

      const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTabId)
      for (const task of tasks) {
        const message = formatConnectionAutomationFailure({
          abortLabel: reason,
          originalTaskLabel: t.terminal.postLoginOriginalTask,
          originalTask: task.displayInput
        })
        const elapsedMs = Date.now() - task.startedAt
        if (task.reuseRun && activeAgentRunRef.current.get(chatTabId)?.logId === task.reuseRun.logId) {
          updateAgentRun(chatTabId, (run) => ({
            ...run,
            error: message,
            elapsedMs
          }))
          activeAgentRunRef.current.delete(chatTabId)
          activeRunCanceledRef.current.delete(chatTabId)
          activeRunIdRef.current.delete(chatTabId)
          activeRunInputRef.current.delete(chatTabId)
          updateTab(chatTabId, (current) => ({
            ...current,
            agentBusy: false,
            agentThinking: false,
            thinkingMessage: undefined
          }))
          continue
        }
        appendLog(
          {
            kind: 'error',
            text: appendElapsedFooter(message, elapsedMs, t)
          },
          chatTabId
        )
      }
    },
    [appendLog, t, updateAgentRun, updateTab]
  )

  const appendStatusToActiveRunOrLog = useCallback(
    (chatTabId: string, text: string, reuseRun?: ReuseAgentRun): void => {
      const active = activeAgentRunRef.current.get(chatTabId)
      if (reuseRun && active?.logId === reuseRun.logId) {
        updateAgentRun(chatTabId, (run) => ({
          ...run,
          steps: [
            ...(run.steps ?? []),
            {
              id: `status-${crypto.randomUUID()}`,
              kind: 'status',
              title: text
            }
          ]
        }))
        return
      }
      appendLog({ kind: 'status', text }, chatTabId)
    },
    [appendLog, updateAgentRun]
  )

  const drainPostConnectionTasks = useCallback(
    (targetTabId: string): void => {
      const tasks = postConnectionTasksRef.current.get(targetTabId) ?? []
      if (tasks.length === 0) return

      postConnectionTasksRef.current.delete(targetTabId)
      const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTabId)
      void Promise.all(
        tasks.map(async (task) => {
          const ready = await waitForTerminalReadyForAgent(targetTabId)
          if (!ready) {
            const message = t.terminal.postLoginNotReady
            const elapsedMs = Date.now() - task.startedAt
            if (
              task.reuseRun &&
              activeAgentRunRef.current.get(chatTabId)?.logId === task.reuseRun.logId
            ) {
              updateAgentRun(chatTabId, (run) => ({
                ...run,
                error: message,
                elapsedMs
              }))
              activeAgentRunRef.current.delete(chatTabId)
              activeRunIdRef.current.delete(chatTabId)
              activeRunInputRef.current.delete(chatTabId)
              updateTab(chatTabId, (current) => ({
                ...current,
                agentBusy: false,
                agentThinking: false,
                thinkingMessage: undefined
              }))
              return
            }
            appendLog(
              {
                kind: 'error',
                text: appendElapsedFooter(message, elapsedMs, t)
              },
              chatTabId
            )
            return
          }

          if (task.reuseRun) {
            appendStatusToActiveRunOrLog(
              chatTabId,
              t.terminal.postLoginTaskStarting,
              task.reuseRun
            )
          } else {
            appendLog(
              {
                kind: 'status',
                text: t.terminal.postLoginTaskStarting
              },
              chatTabId
            )
          }
          await runAgentConversationRef.current?.(
            task.input,
            targetTabId,
            task.connection.id,
            task.displayInput,
            task.appendUserLog,
            task.startedAt,
            {
              conversationContext: task.conversationContext,
              chatTabId,
              reuseRun: task.reuseRun
            }
          )
        })
      )
    },
    [appendLog, appendStatusToActiveRunOrLog, t, updateAgentRun, updateTab]
  )

  const executeConnectionAutomation = useCallback(
    async (
      connection: ConnectionConfig,
      targetTabId: string,
      includeSshCommand: boolean
    ): Promise<boolean> => {
      const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTabId)
      let resolvedConnection = connection
      try {
        const refreshed = await window.api.connections.resolve(connection.id)
        if (refreshed) {
          resolvedConnection = mergeConnectionInput(refreshed, connection)
          setConnections((current) =>
            current.map((item) => (item.id === refreshed.id ? refreshed : item))
          )
        }
      } catch {
        resolvedConnection = connection
      }

      const commands = includeSshCommand
        ? buildConnectionCommands(resolvedConnection)
        : buildConnectionLoginActions(resolvedConnection)

      if (isPasswordEnvVarMissing(resolvedConnection)) {
        const message = `${t.connections.passwordEnvVarMissing}: ${resolvedConnection.passwordEnvVar}`
        appendLog({ kind: 'error', text: message }, chatTabId)
        abortPostConnectionTasks(targetTabId, `${t.terminal.postLoginTaskAborted}\n${message}`)
        return false
      }

      if (commands.length === 0) return true

      const targetTab = tabsRef.current.find((tab) => tab.id === targetTabId)
      if (targetTab?.terminalMode !== 'pty') {
        const message =
          'SSH requires PTY mode. Current terminal is PIPE fallback; restart the app after node-pty is available.'
        appendLog({ kind: 'error', text: message }, chatTabId)
        abortPostConnectionTasks(targetTabId, `${t.terminal.postLoginTaskAborted}\n${message}`)
        return false
      }

      updateTab(targetTabId, (tab) => ({
        ...tab,
        title: tab.connectionId || tab.isSsh ? tab.title : resolvedConnection.name,
        connectionId: resolvedConnection.id,
        connectionName: resolvedConnection.name,
        isSsh: true
      }))
      const pendingReuseRun = (postConnectionTasksRef.current.get(targetTabId) ?? []).find(
        (task) => task.reuseRun
      )?.reuseRun
      appendStatusToActiveRunOrLog(
        chatTabId,
        resolvedConnection.actions?.length
          ? `${t.terminal.connectionStarting}: ${resolvedConnection.actions.length}`
          : t.terminal.connectionNoActions,
        pendingReuseRun
      )

      automatedLoginTabsRef.current.add(targetTabId)
      passwordPromptBuffersRef.current.set(targetTabId, '')
      try {
        const ok = includeSshCommand
          ? await runConnectionCommandSequence(commands, targetTabId, appendLog, t, chatTabId)
          : await runConnectionLoginActionSequence(commands, targetTabId, appendLog, t, chatTabId)
        if (!ok) {
          // Failed auth/host/login must not auto-retry the same SSH connection on exit.
          skipConnectionReconnectRef.current.add(targetTabId)
          abortPostConnectionTasks(targetTabId, t.terminal.postLoginTaskAborted)
        }
        return ok
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        skipConnectionReconnectRef.current.add(targetTabId)
        appendLog({ kind: 'error', text: message }, chatTabId)
        abortPostConnectionTasks(targetTabId, `${t.terminal.postLoginTaskAborted}\n${message}`)
        return false
      } finally {
        automatedLoginTabsRef.current.delete(targetTabId)
        passwordPromptBuffersRef.current.set(targetTabId, '')
      }
    },
    [abortPostConnectionTasks, appendLog, appendStatusToActiveRunOrLog, t, updateTab]
  )

  const executeConnectionCommands = useCallback(
    async (connection: ConnectionConfig, targetTabId: string): Promise<void> => {
      const ok = await executeConnectionAutomation(connection, targetTabId, true)
      if (shouldDrainPostConnectionTasks(ok)) drainPostConnectionTasks(targetTabId)
    },
    [drainPostConnectionTasks, executeConnectionAutomation]
  )

  useEffect(() => {
    connectionsRef.current = connections
  }, [connections])

  useEffect(() => {
    restoreTerminalSessionRef.current = restoreTerminalSession
  })

  useEffect(() => {
    if (!passwordPromptRequest) return

    passwordPromptRequestRef.current = passwordPromptRequest
    window.requestAnimationFrame(() => passwordPromptInputRef.current?.focus())
  }, [passwordPromptRequest])

  useEffect(() => {
    localStorage.setItem('crescent.locale', locale)
  }, [locale])

  useEffect(() => {
    return () => {
      voiceLiveSessionRef.current?.cancel()
      voiceLiveSessionRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const providerId = activeProviderId
    const model = activeTabModelId

    void (async () => {
      // Voice needs Whisper (/audio/transcriptions) and/or Chromium speech recognition.
      // Chat multimodal (e.g. Ark Responses input_image) is unrelated to mic input.
      if (!providerId || !model) {
        if (cancelled) return
        setVoiceWhisperSupported(false)
        setVoiceInputSupportChecking(false)
        return
      }

      setVoiceInputSupportChecking(true)
      try {
        const result = await window.api.agent.checkTranscriptionSupport({
          providerId,
          model
        })
        if (cancelled) return
        setVoiceWhisperSupported(result.supported)
        setVoiceInputSupportChecking(false)
        if (!result.supported && !voiceBrowserSpeechAvailable) {
          voiceLiveSessionRef.current?.cancel()
          voiceLiveSessionRef.current = null
          setVoiceInputState('idle')
        }
      } catch {
        if (cancelled) return
        setVoiceWhisperSupported(false)
        setVoiceInputSupportChecking(false)
        if (!voiceBrowserSpeechAvailable) {
          voiceLiveSessionRef.current?.cancel()
          voiceLiveSessionRef.current = null
          setVoiceInputState('idle')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeProviderId, activeTabModelId, config.providers, voiceBrowserSpeechAvailable])

  useEffect(() => {
    localStorage.setItem(PANE_ORDER_STORAGE_KEY, paneOrder)
    window.requestAnimationFrame(() => fitAddonRef.current?.fit())
  }, [paneOrder])

  useEffect(() => {
    localStorage.setItem(
      CLOSE_TERMINAL_CONFIRM_STORAGE_KEY,
      closeTerminalConfirmEnabled ? 'true' : 'false'
    )
  }, [closeTerminalConfirmEnabled])

  useEffect(() => {
    const handleConnectionShortcut = (event: globalThis.KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return

      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        showConnectionList()
        return
      }

      if (key === 't') {
        event.preventDefault()
        openNewConnectionForm()
      }
    }

    window.addEventListener('keydown', handleConnectionShortcut)

    return () => {
      window.removeEventListener('keydown', handleConnectionShortcut)
    }
  })

  useEffect(() => {
    if (!tabMenu) return

    const closeMenu = (): void => setTabMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [tabMenu])

  const maybeRequestTerminalPassword = useCallback((tabId: string, data: string): void => {
    const nextBuffer = `${passwordPromptBuffersRef.current.get(tabId) ?? ''}${data}`.slice(-4000)
    passwordPromptBuffersRef.current.set(tabId, nextBuffer)

    const promptLine = extractPasswordPromptLine(nextBuffer)
    if (!promptLine) return
    if (automatedLoginTabsRef.current.has(tabId)) {
      passwordPromptBuffersRef.current.set(tabId, '')
      return
    }
    if (
      passwordPromptsByTabRef.current.has(tabId) ||
      passwordPromptOpenTabsRef.current.has(tabId)
    ) {
      return
    }

    const tab = tabsRef.current.find((current) => current.id === tabId)
    if (!tab) return

    passwordPromptOpenTabsRef.current.add(tabId)
    const request = {
      tabId,
      title: tab.title,
      prompt: promptLine
    }
    passwordPromptsByTabRef.current.set(tabId, request)
    passwordPromptBuffersRef.current.set(tabId, '')

    if (!passwordPromptRequestRef.current) {
      passwordPromptRequestRef.current = request
      setPasswordPromptValue('')
      setPasswordPromptError('')
      setPasswordPromptRequest(request)
      return
    }

    const activeSession = resolveSessionChatTabId(
      tabsRef.current,
      passwordPromptRequestRef.current.tabId
    )
    const requestSession = resolveSessionChatTabId(tabsRef.current, tabId)
    // Prefer keeping the currently shown prompt; queue others by tab until it closes.
    if (activeSession === requestSession && passwordPromptRequestRef.current.tabId === tabId) {
      passwordPromptRequestRef.current = request
      setPasswordPromptRequest(request)
    }
  }, [])

  useEffect(() => {
    return window.api.terminal.onData((event) => {
      maybeRequestTerminalPassword(event.tabId, event.data)
    })
  }, [maybeRequestTerminalPassword])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      const subterminalHeightResize = subterminalHeightResizeRef.current
      if (subterminalHeightResize) {
        const maxHeight = Math.max(
          120,
          Math.min(window.innerHeight * 0.65, window.innerHeight - 180)
        )
        const nextHeight = Math.max(
          96,
          Math.min(
            maxHeight,
            subterminalHeightResize.startHeight - (event.clientY - subterminalHeightResize.startY)
          )
        )
        setSubterminalPanelHeight(nextHeight)
        window.requestAnimationFrame(() => fitAddonRef.current?.fit())
        return
      }

      const wikiSheetResize = wikiSheetResizeRef.current
      if (wikiSheetResize) {
        const maxWidth = Math.max(
          WIKI_MIN_PREVIEW_WIDTH,
          window.innerWidth - 48 - WIKI_SHEET_SELECTED_FIXED_WIDTH
        )
        const nextWidth = Math.max(
          WIKI_MIN_PREVIEW_WIDTH,
          Math.min(maxWidth, wikiSheetResize.startWidth + event.clientX - wikiSheetResize.startX)
        )
        setWikiPreviewWidth(nextWidth)
        return
      }

      const subterminalResize = subterminalResizeRef.current
      if (subterminalResize) {
        const deltaPercent = ((event.clientX - subterminalResize.startX) / window.innerWidth) * 100
        resizeSubterminalPair(
          subterminalResize.tabId,
          subterminalResize.leftId,
          subterminalResize.rightId,
          subterminalResize.leftStart + deltaPercent,
          subterminalResize.rightStart - deltaPercent
        )
        return
      }

      if (!splitDragRef.current) return

      const width = window.innerWidth
      const rawPercent =
        paneOrder === 'terminal-chat'
          ? (event.clientX / width) * 100
          : ((width - event.clientX) / width) * 100
      const nextPercent = Math.max(35, Math.min(78, rawPercent))
      setTerminalPanePercent(nextPercent)
      window.requestAnimationFrame(() => fitAddonRef.current?.fit())
    }
    const handlePointerUp = (): void => {
      splitDragRef.current = false
      subterminalResizeRef.current = null
      subterminalHeightResizeRef.current = null
      wikiSheetResizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [paneOrder, resizeSubterminalPair])

  const writeLine = useCallback((text: string): void => {
    terminalRef.current?.writeln(text.replace(/\n/g, '\r\n'))
  }, [])

  useEffect(() => {
    if (!isConnectionSlashQuery(slashCommandQuery)) return

    void window.api.connections
      .list()
      .then(setConnections)
      .catch((error) => {
        writeLine(`\x1b[31m${failedToLoadConnectionsText}: ${String(error)}\x1b[0m`)
      })
  }, [failedToLoadConnectionsText, slashCommandQuery, writeLine])

  useEffect(() => {
    if (!isWikiSlashQuery(slashCommandQuery)) return

    void window.api.agent
      .listWikiDocuments()
      .then(setWikiDocuments)
      .catch((error) => {
        setWikiMessage({
          type: 'error',
          text: error instanceof Error ? error.message : String(error)
        })
      })
  }, [slashCommandQuery])

  useEffect(() => {
    document.documentElement.classList.add('dark')

    window.api.agent
      .getConfig()
      .then((nextConfig) => {
        setConfig(nextConfig)
        setCommandWhitelistText((nextConfig.commandWhitelist ?? []).join('\n'))
        setModels(flattenProviderModels(nextConfig.providers))
        const firstProvider = nextConfig.providers[0]
        setSettingsProviderId(firstProvider?.id ?? '')
        setProviderModelsText(formatProviderModels(firstProvider?.models ?? []))
        const firstMcpServer = (nextConfig.mcpServers ?? [])[0]
        setSettingsMcpServerId(firstMcpServer?.id ?? '')
        setMcpArgsText(formatMcpArgs(firstMcpServer?.args ?? []))
        setMcpEnvText(formatMcpEnv(firstMcpServer?.env ?? {}))
        if (!hasConfiguredModelSelection(nextConfig)) {
          setValidation(undefined)
          setValidating(false)
          return
        }

        const requestId = validationRequestRef.current + 1
        validationRequestRef.current = requestId
        setValidating(true)
        setValidation(undefined)
        void window.api.agent
          .validateConfig(nextConfig)
          .then((result) => {
            if (validationRequestRef.current === requestId) setValidation(result)
          })
          .finally(() => {
            if (validationRequestRef.current === requestId) setValidating(false)
          })
      })
      .catch((error) => {
        writeLine(`\x1b[31m${failedToLoadConfigText}: ${String(error)}\x1b[0m`)
      })
    window.api.agent
      .getModels()
      .then(setModels)
      .catch((error) => {
        writeLine(`\x1b[31m${failedToLoadModelsText}: ${String(error)}\x1b[0m`)
      })
    window.api.agent
      .listSkills()
      .then(setSkills)
      .catch(() => setSkills([]))
    window.api.agent
      .listInstructionFiles()
      .then((files) => {
        setInstructionFiles(files)
        setInstructionContent(files.find((file) => file.name === 'IDENTITY.md')?.content ?? '')
      })
      .catch(() => setInstructionFiles([]))
    window.api.connections
      .list()
      .then((items) => {
        setConnections(items)
      })
      .catch((error) => {
        writeLine(`\x1b[31m${failedToLoadConnectionsText}: ${String(error)}\x1b[0m`)
      })
  }, [failedToLoadConfigText, failedToLoadConnectionsText, failedToLoadModelsText, writeLine])

  useEffect(() => {
    const unsubscribe = window.api.agent.onEvent((event) => {
      const eventTabId = event.tabId ?? activeTabIdRef.current
      const chatTabId = resolveSessionChatTabId(tabsRef.current, eventTabId)
      if (event.type === 'command' && event.phase === 'started' && event.runId && event.tabId) {
        for (const [ownerTabId, runId] of activeRunIdRef.current) {
          if (runId === event.runId) {
            setActiveExecutionTerminal(ownerTabId, event.tabId)
            break
          }
        }
      }
      appendAgentEvent(event, chatTabId)
    })

    return unsubscribe
  }, [appendAgentEvent])

  useEffect(() => {
    return window.api.agent.onCommandApprovalRequest((request) => {
      const targetId = request.chatTabId ?? request.tabId
      const alive =
        isApprovalTargetAlive(request.tabId, tabsRef.current) ||
        isApprovalTargetAlive(request.chatTabId, tabsRef.current)
      if (!alive) {
        void window.api.agent.resolveCommandApproval({
          requestId: request.id,
          approved: false,
          rejectionReason: t.commandReview.sessionClosedRejection
        })
        return
      }

      const chatTabId = resolveSessionChatTabId(tabsRef.current, targetId ?? activeTabIdRef.current)
      attachApprovalRequest(chatTabId, request)
    })
  }, [attachApprovalRequest, t.commandReview.sessionClosedRejection])

  useEffect(() => {
    return window.api.agent.onCommandApprovalDismiss((payload) => {
      for (const [chatTabId, run] of activeAgentRunRef.current.entries()) {
        if (run.runId !== payload.runId) continue
        const pending = (run.steps ?? []).some(
          (step) =>
            step.kind === 'approval' &&
            step.requestId === payload.requestId &&
            step.phase === 'pending'
        )
        if (!pending) continue
        resolveApprovalStep(
          chatTabId,
          payload.requestId,
          false,
          t.commandReview.sessionClosedRejection
        )
      }
    })
  }, [resolveApprovalStep, t.commandReview.sessionClosedRejection])

  useEffect(() => {
    return window.api.agent.onSkillInstallEvent((event) => {
      handleSkillInstallEvent(event)
    })
  })

  useEffect(() => {
    return window.api.storage.onSessionSummaryUpdated((event) => {
      setHistoryItems((current) =>
        current.map((item) =>
          item.tabId === event.tabId
            ? { ...item, title: event.title, summary: event.summary, updatedAt: event.updatedAt }
            : item
        )
      )
    })
  }, [])

  useEffect(() => {
    pruneExpiredSkillInstallLogs()

    const now = Date.now()
    const nextExpirationDelay = Object.entries(skillInstallLogCreatedAt)
      .filter(([resultId]) => !skillInstallIds[resultId])
      .map(([, createdAt]) => createdAt + 24 * 60 * 60 * 1000 - now)
      .filter((delay) => delay > 0)
      .sort((left, right) => left - right)[0]

    if (!nextExpirationDelay) return undefined

    const timeout = window.setTimeout(
      () => pruneExpiredSkillInstallLogs(),
      Math.max(1000, nextExpirationDelay)
    )

    return () => window.clearTimeout(timeout)
    // Rebuild this timer only when the tracked log state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillInstallIds, skillInstallLogCreatedAt])

  useEffect(() => {
    agentLogRef.current?.scrollTo({ top: agentLogRef.current.scrollHeight })
  }, [activeTab?.agentLog, activeTab?.agentThinking, activeTab?.thinkingMessage])

  const activeTabExists = tabs.some((tab) => tab.id === activeTabId)

  useXtermLifecycle({
    terminalVisible,
    activeTabId,
    activeTabExists,
    activeTabIdRef,
    tabsRef,
    terminalHostRef,
    terminalRef,
    fitAddonRef,
    terminalSessionIdRef,
    terminalModeRef,
    terminalCwdRef,
    pipePromptRef,
    pendingSshRef,
    suppressTerminalReconnectRef,
    automatedLoginTabsRef,
    passwordPromptBuffersRef,
    skipConnectionReconnectRef,
    restoreTerminalSessionRef,
    updateTab,
    updateSubterminalOutput,
    updateSubterminalCwd,
    updateSubterminalStatus,
    executeConnectionCommands,
    abortPostConnectionTasks,
    appendLog,
    shellExitedText: t.terminal.shellExited,
    failedToStartShellText: t.terminal.failedToStartShell,
    postLoginTaskAbortedText: t.terminal.postLoginTaskAborted
  })

  async function saveConfig(): Promise<void> {
    await saveAgentConfig({
      ...config,
      commandWhitelist: parseCommandWhitelist(commandWhitelistText)
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
  }

  async function saveSkillRoot(): Promise<void> {
    try {
      const nextConfig = await saveAgentConfig({
        ...config,
        skillRoot: config.skillRoot.trim() || '~/.agents/skills',
        commandWhitelist: parseCommandWhitelist(commandWhitelistText)
      })
      setSkillManageMessage({ type: 'success', text: t.settings.skillDirectorySaved })
      setSkills(await window.api.agent.listSkills())
      setConfig(nextConfig)
    } catch (error) {
      setSkillManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async function saveInstructionFile(): Promise<void> {
    const savedFile = await window.api.agent.saveInstructionFile({
      name: selectedInstructionName,
      content: instructionContent
    })

    setInstructionFiles((current) =>
      current.some((file) => file.name === savedFile.name)
        ? current.map((file) => (file.name === savedFile.name ? savedFile : file))
        : [...current, savedFile]
    )
    setInstructionSaved(true)
    setTimeout(() => setInstructionSaved(false), 1400)
  }

  function selectInstructionFile(name: string): void {
    setSelectedInstructionName(name)
    setInstructionContent(instructionFiles.find((file) => file.name === name)?.content ?? '')
    setInstructionSaved(false)
  }

  function toggleInstructionDetails(name: string): void {
    if (instructionEditorOpen && selectedInstructionName === name) {
      setInstructionEditorOpen(false)
      return
    }

    selectInstructionFile(name)
    setProviderEditorOpen(false)
    setOpenApiEditorOpen(false)
    setInstructionEditorOpen(true)
  }

  async function refreshSkills(): Promise<void> {
    try {
      setSkills(await window.api.agent.listSkills())
      setSkillManageMessage({ type: 'success', text: t.settings.skillsRefreshed })
    } catch (error) {
      setSkillManageMessage({ type: 'error', text: String(error) })
    }
  }

  async function searchSkills(): Promise<void> {
    const query = skillSearchQuery.trim()
    if (!query) return

    setSkillSearchLoading(true)
    setSkillManageMessage({ type: 'info', text: t.settings.skillsSearching })
    try {
      const results = await window.api.agent.searchSkills(query)
      setSkillSearchResults(results)
      setSkillManageMessage(
        results.length
          ? { type: 'success', text: t.settings.skillsSearchComplete }
          : { type: 'info', text: t.settings.skillsNoResults }
      )
    } catch (error) {
      setSkillManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setSkillSearchLoading(false)
    }
  }

  async function installSkill(result: AgentSkillSearchResult): Promise<void> {
    if (skillInstallIds[result.id]) {
      setSkillInstallLogResultId((current) => (current === result.id ? null : result.id))
      return
    }

    setSkillInstallLogNames((current) => ({ ...current, [result.id]: result.name }))
    setSkillInstallLogCreatedAt((current) => ({ ...current, [result.id]: Date.now() }))
    setSkillInstallLogStatuses((current) => ({ ...current, [result.id]: 'running' }))
    setSkillInstallLogs((current) => ({
      ...current,
      [result.id]: `${buildSkillInstallCommand(result)}\n\n`
    }))
    setSkillManageMessage({
      type: 'info',
      text: `${t.settings.skillInstalling}: ${result.name}`
    })
    try {
      const response = await window.api.agent.startSkillInstall({
        installSource: result.installSource,
        installSkill: result.installSkill
      })

      skillInstallResultIdsRef.current.set(response.installId, result.id)
      skillInstallNamesRef.current.set(response.installId, result.name)
      setSkillInstallIds((current) => ({ ...current, [result.id]: response.installId }))
      setSkillInstallLogResultId(result.id)
    } catch (error) {
      setSkillManageMessage({
        type: 'error',
        text: `${t.settings.skillInstallFailed}: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
      setSkillInstallIds((current) => {
        const next = { ...current }
        delete next[result.id]
        return next
      })
      setSkillInstallLogStatuses((current) => ({ ...current, [result.id]: 'error' }))
    }
  }

  async function cancelSkillInstall(resultId: string): Promise<void> {
    const installId = skillInstallIds[resultId]
    if (!installId) return

    setSkillInstallCancelingIds((current) => ({ ...current, [resultId]: true }))
    try {
      await window.api.agent.cancelSkillInstall(installId)
    } finally {
      setSkillInstallCancelingIds((current) => {
        const next = { ...current }
        delete next[resultId]
        return next
      })
    }
  }

  function handleSkillInstallEvent(event: AgentSkillInstallEvent): void {
    const resultId = skillInstallResultIdsRef.current.get(event.installId)
    if (!resultId) return

    if (event.type === 'log') {
      setSkillInstallLogs((current) => ({
        ...current,
        [resultId]: `${current[resultId] ?? ''}${event.data}`
      }))
      return
    }

    const skillName = skillInstallNamesRef.current.get(event.installId) ?? resultId
    skillInstallResultIdsRef.current.delete(event.installId)
    skillInstallNamesRef.current.delete(event.installId)
    setSkillInstallIds((current) => {
      const next = { ...current }
      delete next[resultId]
      return next
    })
    setSkillInstallCancelingIds((current) => {
      const next = { ...current }
      delete next[resultId]
      return next
    })

    if (event.type === 'done') {
      setSkills(event.result.skills)
      setSkillInstallLogStatuses((current) => ({ ...current, [resultId]: 'success' }))
      setSkillInstallLogs((current) => ({
        ...current,
        [resultId]: `${current[resultId] ?? ''}\n${t.settings.skillInstalled}: ${skillName}\n`
      }))
      setSkillManageMessage({
        type: 'success',
        text: [
          `${t.settings.skillInstalled}: ${skillName}`,
          event.result.fallbackInstalledAll && event.result.requestedSkill
            ? `${t.settings.skillFallbackInstalledAll}: ${event.result.requestedSkill}`
            : ''
        ]
          .filter(Boolean)
          .join('\n\n')
      })
      return
    }

    setSkillInstallLogStatuses((current) => ({ ...current, [resultId]: 'error' }))
    setSkillInstallLogs((current) => ({
      ...current,
      [resultId]: `${current[resultId] ?? ''}\n${event.error}\n`
    }))
    setSkillManageMessage({
      type: event.canceled ? 'info' : 'error',
      text: event.canceled
        ? `${t.settings.skillInstallCanceled}: ${skillName}`
        : `${t.settings.skillInstallFailed}: ${event.error}`
    })
  }

  function deleteSkillInstallLog(resultId: string): void {
    const installId = skillInstallIds[resultId]
    if (installId) void window.api.agent.cancelSkillInstall(installId)

    skillInstallResultIdsRef.current.forEach((mappedResultId, activeInstallId) => {
      if (mappedResultId === resultId) {
        skillInstallResultIdsRef.current.delete(activeInstallId)
        skillInstallNamesRef.current.delete(activeInstallId)
      }
    })
    setSkillInstallIds((current) => omitRecordKey(current, resultId))
    setSkillInstallLogs((current) => omitRecordKey(current, resultId))
    setSkillInstallLogNames((current) => omitRecordKey(current, resultId))
    setSkillInstallLogStatuses((current) => omitRecordKey(current, resultId))
    setSkillInstallLogCreatedAt((current) => omitRecordKey(current, resultId))
    setSkillInstallCancelingIds((current) => omitRecordKey(current, resultId))
    setSkillInstallLogResultId((current) => {
      if (current !== resultId) return current

      const nextIds = Object.keys(skillInstallLogs).filter((id) => id !== resultId)
      return nextIds[0] ?? null
    })
  }

  function pruneExpiredSkillInstallLogs(): void {
    const now = Date.now()
    const expiredIds = Object.entries(skillInstallLogCreatedAt)
      .filter(
        ([resultId, createdAt]) =>
          !skillInstallIds[resultId] && now - createdAt > 24 * 60 * 60 * 1000
      )
      .map(([resultId]) => resultId)

    for (const resultId of expiredIds) deleteSkillInstallLog(resultId)
  }

  async function copySkillInstallCommand(result: AgentSkillSearchResult): Promise<void> {
    await copyText(buildSkillInstallCommand(result), copyFeedback(t))
    setCopiedSkillCommandId(result.id)
    window.setTimeout(() => {
      setCopiedSkillCommandId((current) => (current === result.id ? null : current))
    }, 1400)
  }

  async function copySelectedSkillInstallLog(): Promise<void> {
    if (!skillInstallLogResultId) return

    const selectedText = window.getSelection()?.toString().trim()
    const text = selectedText || skillInstallLogs[skillInstallLogResultId] || ''
    if (!text) return

    await copyText(text, copyFeedback(t))
    setCopiedSkillInstallLogId(skillInstallLogResultId)
    window.setTimeout(() => {
      setCopiedSkillInstallLogId((current) =>
        current === skillInstallLogResultId ? null : current
      )
    }, 1400)
  }

  async function deleteSkill(skill: AgentSkillOption): Promise<void> {
    if (!skill.removable) return
    if (!window.confirm(`${t.confirm.deleteSkill}\n\n${skill.name}`)) return

    setSkillDeletingPath(skill.path)
    setSkillManageMessage({ type: 'info', text: `${t.settings.skillDeleting}: ${skill.name}` })
    try {
      setSkills(await window.api.agent.deleteSkill(skill.path))
      setSkillManageMessage({ type: 'success', text: `${t.settings.skillDeleted}: ${skill.name}` })
    } catch (error) {
      setSkillManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setSkillDeletingPath(null)
    }
  }

  async function previewSkill(skill: AgentSkillOption): Promise<void> {
    setSkillPreviewLoadingPath(skill.path)
    setSkillManageMessage(null)
    setSkillInstallLogResultId(null)
    setSelectedSkillPreview({ skill, content: '' })
    try {
      const content = await window.api.agent.getSkillContent(skill.path)
      setSelectedSkillPreview({ skill, content })
    } catch (error) {
      setSelectedSkillPreview(null)
      setSkillManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setSkillPreviewLoadingPath(null)
    }
  }

  async function saveAgentConfig(nextConfigInput: AgentConfig): Promise<AgentConfig> {
    const nextConfig = await window.api.agent.saveConfig(nextConfigInput)
    setConfig(nextConfig)
    setCommandWhitelistText((nextConfig.commandWhitelist ?? []).join('\n'))
    setModels(flattenProviderModels(nextConfig.providers))
    const nextSettingsProvider =
      nextConfig.providers.find((provider) => provider.id === settingsProviderId) ??
      nextConfig.providers[0]
    setSettingsProviderId(nextSettingsProvider?.id ?? '')
    setProviderModelsText(formatProviderModels(nextSettingsProvider?.models ?? []))
    const nextMcpServer =
      (nextConfig.mcpServers ?? []).find((server) => server.id === settingsMcpServerId) ??
      (nextConfig.mcpServers ?? [])[0]
    setSettingsMcpServerId(nextMcpServer?.id ?? '')
    setMcpArgsText(formatMcpArgs(nextMcpServer?.args ?? []))
    setMcpEnvText(formatMcpEnv(nextMcpServer?.env ?? {}))
    return nextConfig
  }

  async function openHistorySession(item: StoredSessionHistoryItem): Promise<void> {
    const detail = await window.api.storage.getSessionHistory(item.tabId)
    if (!detail) return

    const connection = detail.connectionId
      ? await findConnectionById(detail.connectionId)
      : undefined
    const restoredLogs = detail.logs.map(hydrateStoredAgentLog)
    if (detail.connectionId && !connection) {
      restoredLogs.push({
        id: Math.max(0, ...restoredLogs.map((log) => log.id)) + 1,
        kind: 'error',
        text: `${t.history.connectionMissing}: ${detail.connectionName ?? detail.connectionId}`,
        createdAt: new Date().toISOString()
      })
    }
    const nextLogId = Math.max(0, ...restoredLogs.map((log) => log.id)) + 1
    nextLogIdRef.current = Math.max(nextLogIdRef.current, nextLogId)
    const existingTab = tabsRef.current.find((tab) => tab.id === detail.tabId)
    const restoreTabId = isReservedTerminalTabId(detail.tabId) ? undefined : detail.tabId
    const restoreGroupId = isReservedTerminalTabId(detail.sessionGroupId)
      ? undefined
      : detail.sessionGroupId
    const restoredTab = createTerminalTab({
      id: restoreTabId,
      sessionGroupId: restoreGroupId ?? restoreTabId,
      title: detail.title,
      connectionId: detail.connectionId,
      connectionName: detail.connectionName,
      isSsh: detail.isSsh,
      terminalCwd: detail.terminalCwd,
      terminalMode: detail.terminalMode ?? 'pty',
      terminalReady: false,
      terminalOutput: '',
      agentLog: restoredLogs
    })

    setTabs((current) =>
      existingTab
        ? current.map((tab) => (tab.id === detail.tabId ? { ...tab, agentLog: restoredLogs } : tab))
        : [...current, restoredTab]
    )
    setActiveTabId(existingTab?.id ?? restoredTab.id)
    setHistoryOpen(false)
    setHiddenPane(null)

    if (connection) {
      const liveTabId = existingTab?.id ?? restoredTab.id
      const activeSession = tabsRef.current.find((tab) => tab.id === liveTabId)?.sessionId
      if (!activeSession) {
        pendingSshRef.current.set(liveTabId, connection)
      }
    }
  }

  async function saveHistorySessionToWiki(item: StoredSessionHistoryItem): Promise<void> {
    setSavingHistoryWikiTabId(item.tabId)
    setWikiMessage(null)
    try {
      const detail = await window.api.storage.getSessionHistory(item.tabId)
      if (!detail) return

      const title = `${detail.title} SOP`
      const document = await window.api.agent.saveWikiDocument({
        title,
        content: buildWikiContentFromHistory(detail, t)
      })
      setWikiDocuments((current) => upsertWikiSummary(current, document))
      setSelectedWikiDocument(document)
      setWikiEditContent(document.content)
      setWikiEditing(false)
      setWikiPreviewWidth(getDefaultWikiPreviewWidth())
      setWikiMessage({ type: 'success', text: `${t.wiki.saved}: ${document.title}` })
      setWikiOpen(true)
    } catch (error) {
      setWikiMessage({
        type: 'error',
        text: `${t.wiki.saveFailed}: ${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      setSavingHistoryWikiTabId(null)
    }
  }

  function startRenameHistorySession(item: StoredSessionHistoryItem): void {
    setHistoryTitleEditingId(item.tabId)
    setHistoryTitleDraft(item.title)
  }

  function cancelRenameHistorySession(): void {
    setHistoryTitleEditingId(null)
    setHistoryTitleDraft('')
  }

  async function saveHistorySessionTitle(item: StoredSessionHistoryItem): Promise<void> {
    const nextTitle = historyTitleDraft.trim()
    if (!nextTitle) return

    setHistoryTitleSavingId(item.tabId)
    try {
      const result = await window.api.storage.renameSessionHistory({
        tabId: item.tabId,
        title: nextTitle
      })
      if (!result.ok) return

      setHistoryItems((current) =>
        current.map((candidate) =>
          candidate.tabId === item.tabId ? { ...candidate, title: nextTitle } : candidate
        )
      )
      setTabs((current) =>
        current.map((tab) => (tab.id === item.tabId ? { ...tab, title: nextTitle } : tab))
      )
      cancelRenameHistorySession()
    } finally {
      setHistoryTitleSavingId(null)
    }
  }

  async function openWikiDocument(document: WikiDocumentSummary): Promise<void> {
    setWikiDocumentLoadingId(document.id)
    setWikiEditing(false)
    setWikiMessage(null)
    try {
      const detail = (await window.api.agent.getWikiDocument(document.id)) ?? null
      setSelectedWikiDocument(detail)
      setWikiEditContent(detail?.content ?? '')
      if (detail) setWikiPreviewWidth(getDefaultWikiPreviewWidth())
    } catch (error) {
      setWikiMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setWikiDocumentLoadingId(null)
    }
  }

  async function saveWikiEdits(): Promise<void> {
    if (!selectedWikiDocument) return

    setWikiSaving(true)
    setWikiMessage(null)
    try {
      const document = await window.api.agent.saveWikiDocument({
        id: selectedWikiDocument.id,
        title: selectedWikiDocument.title,
        content: wikiEditContent
      })
      setSelectedWikiDocument(document)
      setWikiEditContent(document.content)
      setWikiDocuments((current) => upsertWikiSummary(current, document))
      setWikiEditing(false)
      setWikiMessage({ type: 'success', text: `${t.wiki.saved}: ${document.title}` })
    } catch (error) {
      setWikiMessage({
        type: 'error',
        text: `${t.wiki.saveFailed}: ${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      setWikiSaving(false)
    }
  }

  async function deleteWikiDocument(): Promise<void> {
    if (!selectedWikiDocument) return
    if (!window.confirm(`${t.confirm.deleteWikiDocument}\n\n${selectedWikiDocument.title}`)) return

    setWikiDeletingId(selectedWikiDocument.id)
    setWikiMessage(null)
    try {
      const deleted = await window.api.agent.deleteWikiDocument(selectedWikiDocument.id)
      if (!deleted.ok) throw new Error(t.wiki.deleteFailed)

      const deletedTitle = selectedWikiDocument.title
      setWikiDocuments((current) =>
        current.filter((document) => document.id !== selectedWikiDocument.id)
      )
      setSelectedWikiDocument(null)
      setWikiEditContent('')
      setWikiEditing(false)
      setWikiMessage({ type: 'success', text: `${t.wiki.deleted}: ${deletedTitle}` })
    } catch (error) {
      setWikiMessage({
        type: 'error',
        text: `${t.wiki.deleteFailed}: ${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      setWikiDeletingId(null)
    }
  }

  async function deleteHistorySession(item: StoredSessionHistoryItem): Promise<void> {
    if (!window.confirm(`${t.confirm.deleteHistory}\n\n${item.title}`)) return

    await window.api.storage.deleteSessionHistory(item.tabId)
    setHistoryItems((current) => current.filter((candidate) => candidate.tabId !== item.tabId))
  }

  async function findConnectionById(id: string): Promise<ConnectionConfig | undefined> {
    let candidates = connections

    try {
      candidates = await window.api.connections.list()
      setConnections(candidates)
    } catch {
      candidates = connections
    }

    return candidates.find((connection) => connection.id === id)
  }

  async function validateConfig(nextConfigInput = config): Promise<void> {
    const requestId = validationRequestRef.current + 1
    validationRequestRef.current = requestId
    setValidating(true)
    setValidation(undefined)

    try {
      const result = await window.api.agent.validateConfig(nextConfigInput)
      if (validationRequestRef.current === requestId) setValidation(result)
    } finally {
      if (validationRequestRef.current === requestId) setValidating(false)
    }
  }

  async function importOpenApiDocument(): Promise<void> {
    setImportingOpenApi(true)
    try {
      const result = await window.api.agent.importOpenApiDocument()
      if (!result.ok || !result.path) return
      patchActiveOpenApiProfile({ document: result.path })
    } finally {
      setImportingOpenApi(false)
    }
  }

  function selectOpenApiProfile(profileId: string): void {
    const nextConfig = withActiveOpenApiProfile(config, profileId)
    setConfig(nextConfig)
    setValidation(undefined)
    void validateConfig(nextConfig)
  }

  function toggleOpenApiProfileDetails(profileId: string): void {
    if (openApiEditorOpen && config.openApiProfileId === profileId) {
      setOpenApiEditorOpen(false)
      return
    }

    selectOpenApiProfile(profileId)
    setProviderEditorOpen(false)
    setInstructionEditorOpen(false)
    setOpenApiEditorOpen(true)
  }

  function createOpenApiProfile(): void {
    const profile = createEmptyOpenApiProfile(`openapi-${crypto.randomUUID()}`)
    profile.name = `OpenAPI ${config.openApiProfiles.length + 1}`
    const nextConfig = withActiveOpenApiProfile(
      {
        ...config,
        openApiProfiles: [...config.openApiProfiles, profile]
      },
      profile.id
    )
    setConfig(nextConfig)
    setProviderEditorOpen(false)
    setInstructionEditorOpen(false)
    setOpenApiEditorOpen(true)
    setValidation(undefined)
  }

  function deleteOpenApiProfile(): void {
    const profileId = config.openApiProfileId
    if (!profileId) return
    const profile = (config.openApiProfiles ?? []).find((candidate) => candidate.id === profileId)
    if (!profile) return
    if (!window.confirm(`${t.settings.deleteOpenApiProfile}\n\n${profile.name}`)) return

    const remaining = config.openApiProfiles.filter((candidate) => candidate.id !== profileId)
    const nextActive = remaining[0]
    const nextConfig = nextActive
      ? withActiveOpenApiProfile({ ...config, openApiProfiles: remaining }, nextActive.id)
      : {
          ...config,
          openApiProfiles: [],
          openApiProfileId: undefined,
          openApiBaseUrl: '',
          openApiDocument: '',
          openApiTimeoutMs: 30_000,
          openApiMaxRetries: 2,
          openApiRetryBackoffMs: 300
        }
    setConfig(nextConfig)
    if (!nextActive) setOpenApiEditorOpen(false)
    setValidation(undefined)
  }

  function patchActiveOpenApiProfile(
    patch: Partial<{
      name: string
      baseUrl: string
      document: string
      timeoutMs: number
      maxRetries: number
      retryBackoffMs: number
      promptTemplate: string
      pinnedWorkflows: AgentOpenApiProfile['pinnedWorkflows']
      toolAllowList: string[]
      toolDenyList: string[]
    }>
  ): void {
    setConfig((current) => {
      let next = current
      let profileId = current.openApiProfileId
      if (!profileId || !current.openApiProfiles.some((profile) => profile.id === profileId)) {
        const profile = createEmptyOpenApiProfile(`openapi-${crypto.randomUUID()}`)
        next = withActiveOpenApiProfile(
          {
            ...current,
            openApiProfiles: [...current.openApiProfiles, profile]
          },
          profile.id
        )
        profileId = profile.id
      }

      return updateOpenApiProfileInConfig(next, profileId, patch)
    })
    setValidation(undefined)
  }

  async function applyDefaultModel(selection: string): Promise<void> {
    const parsed = parseModelSelectionValue(selection)
    const selectedModel =
      modelOptions.find(
        (model) => model.providerId === parsed.providerId && model.id === parsed.model
      ) ?? modelOptions.find((model) => model.id === parsed.model)
    if (!selectedModel) return

    const optimisticConfig = {
      ...config,
      providerId: selectedModel.providerId,
      model: selectedModel.id
    }

    setConfig(optimisticConfig)
    setValidation(undefined)
    const nextConfig = await saveAgentConfig(optimisticConfig)
    void validateConfig(nextConfig)
  }

  async function persistModelSelection(
    providerId: string | undefined,
    model: string
  ): Promise<void> {
    const optimisticConfig = { ...config, providerId, model }
    setConfig(optimisticConfig)
    setValidation(undefined)

    try {
      const nextConfig = await saveAgentConfig(optimisticConfig)
      void validateConfig(nextConfig)
    } catch (error) {
      writeLine(`\x1b[31m${failedToLoadConfigText}: ${String(error)}\x1b[0m`)
    }
  }

  function applyConversationModel(selection: string): void {
    const parsed = parseModelSelectionValue(selection)
    const selectedModel = visibleModels.find(
      (model) => model.providerId === parsed.providerId && model.id === parsed.model
    )
    if (!selectedModel) return

    updateTab(sessionChatTab.id, (tab) => ({
      ...tab,
      providerId: selectedModel.providerId,
      model: selectedModel.id
    }))
    void persistModelSelection(selectedModel.providerId, selectedModel.id)
  }

  function setActiveExecutionTerminal(chatTabId: string, terminalTabId: string | null): void {
    if (terminalTabId) {
      activeExecutionTabIdRef.current.set(chatTabId, terminalTabId)
      setExecutionTerminalByChatId((current) =>
        current[chatTabId] === terminalTabId ? current : { ...current, [chatTabId]: terminalTabId }
      )
      return
    }
    activeExecutionTabIdRef.current.delete(chatTabId)
    setExecutionTerminalByChatId((current) => {
      if (!(chatTabId in current)) return current
      const next = { ...current }
      delete next[chatTabId]
      return next
    })
  }

  function remapActiveExecutionTerminal(fromChatTabId: string, toChatTabId: string): void {
    const executionTabId = activeExecutionTabIdRef.current.get(fromChatTabId)
    if (!executionTabId) return
    activeExecutionTabIdRef.current.delete(fromChatTabId)
    activeExecutionTabIdRef.current.set(toChatTabId, executionTabId)
    setExecutionTerminalByChatId((current) => {
      const next = { ...current }
      delete next[fromChatTabId]
      next[toChatTabId] = executionTabId
      return next
    })
  }

  function cancelAgentRunForChatTab(chatTabId: string): void {
    activeRunCanceledRef.current.add(chatTabId)
    const runId = activeRunIdRef.current.get(chatTabId)
    if (runId) {
      void window.api.agent.cancel(runId)
    }
    activeAgentRunRef.current.delete(chatTabId)
    activeRunIdRef.current.delete(chatTabId)
    activeRunInputRef.current.delete(chatTabId)
    setActiveExecutionTerminal(chatTabId, null)
    updateTab(chatTabId, (tab) => ({
      ...tab,
      agentBusy: false,
      agentThinking: false,
      thinkingMessage: undefined
    }))
  }

  function cancelAgentRunsOutsideTabs(remainingTabs: AgentTerminalTab[]): void {
    const aliveSessionIds = new Set(remainingTabs.map((tab) => getSessionGroupId(tab)))
    for (const chatTabId of [...activeRunIdRef.current.keys()]) {
      if (aliveSessionIds.has(chatTabId)) continue
      cancelAgentRunForChatTab(chatTabId)
    }
  }

  function rejectApprovalsForClosedTabs(closedTabIds: string[]): void {
    for (const tabId of closedTabIds) {
      void window.api.agent.rejectApprovalsForTab(tabId)
      passwordPromptsByTabRef.current.delete(tabId)
      passwordPromptOpenTabsRef.current.delete(tabId)
    }

    if (
      passwordPromptRequestRef.current &&
      closedTabIds.includes(passwordPromptRequestRef.current.tabId)
    ) {
      showNextPasswordPrompt()
    }
  }

  function stopAgentRun(tabId = activeTabIdRef.current): void {
    const chatTabId = resolveSessionChatTabId(tabsRef.current, tabId)
    activeRunCanceledRef.current.add(chatTabId)
    const runId = activeRunIdRef.current.get(chatTabId)
    if (runId) void window.api.agent.cancel(runId)
    if (runId) {
      updateAgentRun(chatTabId, (run) => ({
        ...run,
        error: t.input.agentCanceled,
        elapsedMs: Date.now() - (run.startedAt ?? Date.now())
      }))
      const canceledRun = activeAgentRunRef.current.get(chatTabId)
      void window.api.storage.saveAgentRun({
        runId,
        tabId: chatTabId,
        input: activeRunInputRef.current.get(chatTabId) ?? '',
        status: 'canceled',
        output: canceledRun?.result,
        error: t.input.agentCanceled,
        startedAt:
          typeof canceledRun?.startedAt === 'number'
            ? new Date(canceledRun.startedAt).toISOString()
            : undefined,
        elapsedMs: canceledRun?.elapsedMs,
        trace: buildTraceFromAgentRunView({
          runId,
          tabId: chatTabId,
          displayInput: activeRunInputRef.current.get(chatTabId) ?? '',
          status: 'canceled',
          run: canceledRun,
          error: t.input.agentCanceled
        })
      })
    }
    setActiveExecutionTerminal(chatTabId, null)
    updateTab(chatTabId, (tab) => ({
      ...tab,
      agentBusy: false,
      agentThinking: false,
      thinkingMessage: undefined
    }))
  }

  async function submitPasswordPrompt(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!passwordPromptRequest) return

    const context = await window.api.terminal.getContext(passwordPromptRequest.tabId)
    if (!isTerminalCurrentlyAtPasswordPrompt(context.output)) {
      passwordPromptBuffersRef.current.set(passwordPromptRequest.tabId, '')
      setPasswordPromptValue('')
      setPasswordPromptError(t.terminal.passwordPromptExpired)
      return
    }

    sendTerminalInput(passwordPromptValue, passwordPromptRequest.tabId)
    passwordPromptBuffersRef.current.set(passwordPromptRequest.tabId, '')
    passwordPromptOpenTabsRef.current.delete(passwordPromptRequest.tabId)
    passwordPromptsByTabRef.current.delete(passwordPromptRequest.tabId)
    setPasswordPromptValue('')
    setPasswordPromptError('')
    showNextPasswordPrompt(passwordPromptRequest.tabId)
  }

  function cancelPasswordPrompt(): void {
    if (passwordPromptRequest) {
      passwordPromptBuffersRef.current.set(passwordPromptRequest.tabId, '')
      passwordPromptOpenTabsRef.current.delete(passwordPromptRequest.tabId)
      passwordPromptsByTabRef.current.delete(passwordPromptRequest.tabId)
    }
    setPasswordPromptValue('')
    setPasswordPromptError('')
    showNextPasswordPrompt(passwordPromptRequest?.tabId)
  }

  function resolveInlineCommandApproval(requestId: string, approved: boolean, note?: string): void {
    const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    // Prefer the chat that owns the pending approval step.
    let targetChatTabId = chatTabId
    for (const [candidateId, run] of activeAgentRunRef.current.entries()) {
      const pending = (run.steps ?? []).some(
        (step) =>
          step.kind === 'approval' && step.requestId === requestId && step.phase === 'pending'
      )
      if (pending) {
        targetChatTabId = candidateId
        break
      }
    }
    resolveApprovalStep(targetChatTabId, requestId, approved, note)
    void window.api.agent.resolveCommandApproval({
      requestId,
      approved,
      note,
      rejectionReason: approved ? undefined : note
    })
  }

  async function addCommandToWhitelist(command: string): Promise<void> {
    const rule = suggestWhitelistRule(command)
    if (!rule) return
    const existing = parseCommandWhitelist(commandWhitelistText)
    if (existing.some((item) => item.trim() === rule)) {
      toast.message(t.commandReview.addedToWhitelist)
      return
    }
    const nextText = [...existing, rule].join('\n')
    setCommandWhitelistText(nextText)
    try {
      const nextConfig = await window.api.agent.saveConfig({
        ...config,
        commandWhitelist: parseCommandWhitelist(nextText)
      })
      setConfig(nextConfig)
      setCommandWhitelistText((nextConfig.commandWhitelist ?? []).join('\n'))
      toast.success(t.commandReview.addedToWhitelist)
    } catch (error) {
      notifyOperationError(t.commandReview.addToWhitelist, error)
    }
  }

  function showNextPasswordPrompt(preferredTabId = activeTabIdRef.current): void {
    const preferredSession = resolveSessionChatTabId(tabsRef.current, preferredTabId)
    const prompts = [...passwordPromptsByTabRef.current.values()]
    const preferred =
      prompts.find(
        (prompt) => resolveSessionChatTabId(tabsRef.current, prompt.tabId) === preferredSession
      ) ?? prompts[0]
    passwordPromptRequestRef.current = preferred ?? null
    setPasswordPromptRequest(preferred ?? null)
    if (!preferred) {
      setPasswordPromptValue('')
      setPasswordPromptError('')
    }
  }

  async function restoreTerminalSession(tabId: string): Promise<boolean> {
    const tab = tabsRef.current.find((current) => current.id === tabId)
    if (!tab) return false

    if (skipConnectionReconnectRef.current.delete(tabId)) {
      return restoreLocalTerminal(tabId)
    }

    return tab.connectionId ? restoreTerminalConnection(tabId) : restoreLocalTerminal(tabId)
  }

  async function restoreLocalTerminal(tabId: string): Promise<boolean> {
    if (reconnectingTabsRef.current.has(tabId)) return waitForTerminalRestore(tabId)

    reconnectingTabsRef.current.add(tabId)
    const chatTabId = resolveSessionChatTabId(tabsRef.current, tabId)
    appendLog({ kind: 'status', text: t.terminal.terminalReconnecting }, chatTabId)

    try {
      const dimensions =
        tabId === activeTabIdRef.current ? fitAddonRef.current?.proposeDimensions() : undefined
      const session = await window.api.terminal.start({
        cols: dimensions?.cols ?? 80,
        rows: dimensions?.rows ?? 24,
        tabId
      })
      updateTab(tabId, (current) => ({
        ...current,
        sessionId: session.sessionId,
        terminalMode: session.mode,
        terminalCwd: session.cwd,
        terminalReady: true
      }))
      if (tabId === activeTabIdRef.current) {
        terminalSessionIdRef.current = session.sessionId
        terminalModeRef.current = session.mode
        terminalCwdRef.current = session.cwd
        pipePromptRef.current = formatPipePrompt(session.cwd)
      }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendLog(
        { kind: 'error', text: `${t.terminal.terminalReconnectFailed}: ${message}` },
        chatTabId
      )
      updateTab(tabId, (current) => ({
        ...current,
        sessionId: undefined,
        terminalReady: false
      }))
      return false
    } finally {
      reconnectingTabsRef.current.delete(tabId)
    }
  }

  async function restoreTerminalConnection(tabId: string): Promise<boolean> {
    if (reconnectingTabsRef.current.has(tabId)) return waitForTerminalRestore(tabId)

    const tab = tabsRef.current.find((current) => current.id === tabId)
    if (!tab?.connectionId) return false

    reconnectingTabsRef.current.add(tabId)
    const chatTabId = resolveSessionChatTabId(tabsRef.current, tabId)
    appendLog({ kind: 'status', text: t.terminal.terminalReconnecting }, chatTabId)

    try {
      const connection = await findConnectionById(tab.connectionId)
      if (!connection) {
        throw new Error(`${t.history.connectionMissing}: ${tab.connectionName ?? tab.connectionId}`)
      }

      const dimensions =
        tabId === activeTabIdRef.current ? fitAddonRef.current?.proposeDimensions() : undefined
      const session = await window.api.terminal.start({
        cols: dimensions?.cols ?? 80,
        rows: dimensions?.rows ?? 24,
        tabId
      })
      updateTab(tabId, (current) => ({
        ...current,
        sessionId: session.sessionId,
        terminalMode: session.mode,
        terminalCwd: session.cwd,
        terminalReady: true
      }))
      if (tabId === activeTabIdRef.current) {
        terminalSessionIdRef.current = session.sessionId
        terminalModeRef.current = session.mode
        terminalCwdRef.current = session.cwd
        pipePromptRef.current = formatPipePrompt(session.cwd)
      }
      const ok = await executeConnectionAutomation(connection, tabId, true)
      if (shouldDrainPostConnectionTasks(ok)) drainPostConnectionTasks(tabId)
      if (!ok) {
        // Keep local shell; do not schedule another SSH reconnect cycle.
        skipConnectionReconnectRef.current.add(tabId)
      }
      return ok
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      skipConnectionReconnectRef.current.add(tabId)
      appendLog(
        { kind: 'error', text: `${t.terminal.terminalReconnectFailed}: ${message}` },
        chatTabId
      )
      updateTab(tabId, (current) => ({
        ...current,
        sessionId: undefined,
        terminalReady: false
      }))
      return false
    } finally {
      reconnectingTabsRef.current.delete(tabId)
    }
  }

  async function waitForTerminalRestore(tabId: string): Promise<boolean> {
    const deadline = Date.now() + 90_000

    while (Date.now() < deadline) {
      const context = await window.api.terminal.getContext(tabId)
      if (context.mode !== 'none') return true
      if (!reconnectingTabsRef.current.has(tabId)) return false
      await sleep(500)
    }

    return false
  }

  function connectToConnection(
    connection: ConnectionConfig,
    postLoginInput?: string,
    postLoginDisplayInput?: string,
    postLoginConversationContext?: string,
    postLoginAppendUserLog = true,
    postLoginStartedAt = Date.now(),
    reuseRun?: ReuseAgentRun
  ): string {
    const currentTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
    let targetTabId = currentTab?.id ?? ''
    let targetTab = currentTab
    let forceFreshLogin = false

    void window.api.connections.setLastUsed(connection.id).catch(() => undefined)

    if (currentTab?.isSsh && currentTab.connectionId === connection.id) {
      targetTabId = currentTab.id
      targetTab = currentTab
      forceFreshLogin = true
      updateTab(currentTab.id, (tab) => ({
        ...tab,
        connectionId: connection.id,
        connectionName: connection.name,
        isSsh: true,
        sessionId: undefined,
        terminalReady: false
      }))
      setActiveTabId(currentTab.id)
      void window.api.terminal.stop(currentTab.id)
    } else if (currentTab?.isSsh) {
      // Keep the current chat session and open a peer terminal for comparison.
      const groupId = getSessionGroupId(currentTab)
      if (currentTab.sessionGroupId !== groupId) {
        updateTab(currentTab.id, (tab) => ({ ...tab, sessionGroupId: groupId }))
      }
      const nextTab = createTerminalTab({
        title: getNextTerminalTitle(connection.name, tabsRef.current),
        sessionGroupId: groupId,
        providerId: currentTab.providerId ?? config.providerId,
        model: currentTab.model,
        connectionId: connection.id,
        connectionName: connection.name,
        isSsh: true
      })
      targetTabId = nextTab.id
      targetTab = nextTab
      setTabs((current) => [...current, nextTab])
      setActiveTabId(nextTab.id)
      const chatTabId = resolveSessionChatTabId(
        [...tabsRef.current.filter((tab) => tab.id !== nextTab.id), nextTab],
        nextTab.id
      )
      appendLog(
        {
          kind: 'status',
          text: `${t.terminal.openedPeerTerminal}: ${connection.name}`
        },
        chatTabId
      )
    } else if (!currentTab) {
      const nextTab = createTerminalTab({
        title: getNextTerminalTitle(connection.name, tabsRef.current),
        providerId: config.providerId,
        connectionId: connection.id,
        connectionName: connection.name,
        isSsh: true
      })
      targetTabId = nextTab.id
      targetTab = nextTab
      setTabs((current) => [...current, nextTab])
      setActiveTabId(nextTab.id)
    } else {
      updateTab(currentTab.id, (tab) => ({
        ...tab,
        title:
          tab.connectionId || tab.isSsh
            ? tab.title
            : getNextTerminalTitle(connection.name, tabsRef.current),
        connectionId: connection.id,
        connectionName: connection.name,
        isSsh: true
      }))
      setActiveTabId(currentTab.id)
    }
    setHiddenPane(null)
    setTerminalPage('terminal')

    if (postLoginInput) {
      const tasks = postConnectionTasksRef.current.get(targetTabId) ?? []
      postConnectionTasksRef.current.set(targetTabId, [
        ...tasks,
        {
          input: postLoginInput,
          displayInput: postLoginDisplayInput ?? postLoginInput,
          conversationContext: postLoginConversationContext,
          connection,
          appendUserLog: postLoginAppendUserLog,
          startedAt: postLoginStartedAt,
          reuseRun
        }
      ])
    }

    if (!forceFreshLogin && targetTab?.sessionId) {
      void executeConnectionCommands(connection, targetTabId)
    } else {
      pendingSshRef.current.set(targetTabId, connection)
    }

    return targetTabId
  }

  async function retryActiveConnection(): Promise<void> {
    const targetTab =
      tabsRef.current.find((tab) => tab.id === activeTabIdRef.current) ??
      tabsRef.current.find((tab) => tab.id === sessionChatTab.id)
    const connectionId =
      targetTab?.connectionId ||
      sessionTerminals.find((tab) => tab.connectionId)?.connectionId ||
      sessionChatTab.connectionId
    if (!connectionId) {
      showConnectionList()
      return
    }

    const connection = await findConnectionById(connectionId)
    if (!connection) {
      showConnectionList()
      return
    }

    if (targetTab?.id) {
      skipConnectionReconnectRef.current.delete(targetTab.id)
    }
    connectToConnection(connection)
  }

  function showConnectionList(): void {
    setConnectionModalOpen(true)
    void window.api.connections
      .list()
      .then(setConnections)
      .catch((error) => {
        writeLine(`\x1b[31m${failedToLoadConnectionsText}: ${String(error)}\x1b[0m`)
      })
  }

  function closeOnboarding(): void {
    dismissOnboarding()
    setOnboardingOpen(false)
  }

  function addExampleOpenApiFromOnboarding(): void {
    const profile = createExampleOpenApiProfile()
    setConfig((current) =>
      withActiveOpenApiProfile(
        {
          ...current,
          openApiProfiles: [...current.openApiProfiles, profile]
        },
        profile.id
      )
    )
    setValidation(undefined)
    setOpenApiEditorOpen(true)
    setSheetOpen(true)
    closeOnboarding()
  }

  function startNewSession(): void {
    const previousChatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    const nextTab = createTerminalTab({
      title: getNextTerminalTitle(t.connections.localTerminal, tabsRef.current),
      providerId: config.providerId,
      isSsh: false
    })
    // Clear slash residue (e.g. "/") from the previous session before switching away.
    const nextTabs = [
      ...tabsRef.current.map((tab) =>
        tab.id === previousChatTabId
          ? {
              ...tab,
              agentInput: '',
              skillRefs: [],
              pathRefs: [],
              toolRefs: [],
              wikiRefs: []
            }
          : tab
      ),
      nextTab
    ]

    // Keep refs and React state aligned in one commit so chat + terminal switch together.
    tabsRef.current = nextTabs
    activeTabIdRef.current = nextTab.id
    setSlashCommandOpen(false)
    setSlashCommandIndex(0)
    flushSync(() => {
      setHiddenPane(null)
      setTerminalPage('terminal')
      setTabs(nextTabs)
      setActiveTabId(nextTab.id)
    })
  }

  function openConnectionTerminal(connection: ConnectionConfig): void {
    if (isLocalConnection(connection)) {
      openLocalTerminal()
      return
    }

    setHiddenPane(null)
    setTerminalPage('terminal')
    const nextTab = createTerminalTab({
      title: getNextTerminalTitle(connection.name, tabsRef.current),
      providerId: config.providerId,
      connectionId: connection.id,
      connectionName: connection.name,
      isSsh: true
    })

    pendingSshRef.current.set(nextTab.id, connection)
    setTabs((current) => [...current, nextTab])
    setActiveTabId(nextTab.id)
  }

  function openConnectionInCurrentSession(connection: ConnectionConfig): void {
    if (isLocalConnection(connection)) {
      const currentTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
      if (!currentTab) {
        openLocalTerminal()
        return
      }

      const groupId = getSessionGroupId(currentTab)
      if (currentTab.sessionGroupId !== groupId) {
        updateTab(currentTab.id, (tab) => ({ ...tab, sessionGroupId: groupId }))
      }
      const nextTab = createTerminalTab({
        title: getNextTerminalTitle(t.connections.localTerminal, tabsRef.current),
        sessionGroupId: groupId,
        providerId: currentTab.providerId ?? config.providerId,
        model: currentTab.model,
        isSsh: false
      })
      setTabs((current) => [...current, nextTab])
      setActiveTabId(nextTab.id)
      setHiddenPane(null)
      setTerminalPage('terminal')
      appendLog(
        {
          kind: 'status',
          text: `${t.terminal.openedPeerTerminal}: ${t.connections.localTerminal}`
        },
        resolveSessionChatTabId([...tabsRef.current, nextTab], nextTab.id)
      )
      return
    }

    const currentTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
    if (!currentTab) {
      openConnectionTerminal(connection)
      return
    }

    const groupId = getSessionGroupId(currentTab)
    if (currentTab.sessionGroupId !== groupId) {
      updateTab(currentTab.id, (tab) => ({ ...tab, sessionGroupId: groupId }))
    }
    const nextTab = createTerminalTab({
      title: getNextTerminalTitle(connection.name, tabsRef.current),
      sessionGroupId: groupId,
      providerId: currentTab.providerId ?? config.providerId,
      model: currentTab.model,
      connectionId: connection.id,
      connectionName: connection.name,
      isSsh: true
    })
    pendingSshRef.current.set(nextTab.id, connection)
    setTabs((current) => [...current, nextTab])
    setActiveTabId(nextTab.id)
    setHiddenPane(null)
    setTerminalPage('terminal')
    appendLog(
      {
        kind: 'status',
        text: `${t.terminal.openedPeerTerminal}: ${connection.name}`
      },
      resolveSessionChatTabId([...tabsRef.current, nextTab], nextTab.id)
    )
  }

  async function openLocalSubterminal(): Promise<void> {
    const parentTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
    if (!parentTab) return
    if (parentTab.subTerminals.length >= 3) {
      appendLog({ kind: 'error', text: t.terminal.subterminalLimitReached }, parentTab.id)
      return
    }

    const usedNames = new Set(parentTab.subTerminals.map((subterminal) => subterminal.name))
    let terminalName = 'local'
    for (let index = 1; usedNames.has(terminalName); index += 1) {
      terminalName = `local-${index}`
    }

    const dimensions = fitAddonRef.current?.proposeDimensions()
    const opened = await window.api.terminal.openSubterminal({
      parentTabId: parentTab.id,
      terminalName,
      cols: dimensions?.cols ?? 100,
      rows: Math.max(12, Math.floor((dimensions?.rows ?? 24) / 2))
    })
    if (!opened.ok || !opened.tabId || !opened.name) {
      appendLog(
        {
          kind: 'error',
          text: opened.error || t.terminal.subterminalLimitReached
        },
        parentTab.id
      )
      return
    }

    ensureSubterminal(parentTab.id, {
      id: opened.tabId,
      name: opened.name,
      output: '',
      rawOutput: '',
      cwd: opened.cwd ?? '',
      status: 'active',
      isSsh: false,
      terminalMode: opened.mode,
      sessionId: opened.sessionId,
      terminalReady: true
    })
    setSubterminalCollapsed(false)
    appendLog(
      { kind: 'status', text: `${t.terminal.openedSubterminal}: ${opened.name}` },
      resolveSessionChatTabId(tabsRef.current, parentTab.id)
    )
  }

  async function openConnectionInSubterminal(connection: ConnectionConfig): Promise<void> {
    const parentTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
    if (!parentTab) {
      connectFromConnectionManager(connection)
      return
    }
    if (parentTab.subTerminals.length >= 3) {
      appendLog({ kind: 'error', text: t.terminal.subterminalLimitReached }, parentTab.id)
      return
    }

    if (isLocalConnection(connection)) {
      await openLocalSubterminal()
      return
    }

    const baseName = connection.name.trim().replace(/\s+/g, '-').slice(0, 32) || 'remote'
    const usedNames = new Set(parentTab.subTerminals.map((subterminal) => subterminal.name))
    let terminalName = baseName
    for (let index = 1; usedNames.has(terminalName); index += 1) {
      terminalName = `${baseName}-${index}`
    }

    const dimensions = fitAddonRef.current?.proposeDimensions()
    const opened = await window.api.terminal.openSubterminal({
      parentTabId: parentTab.id,
      terminalName,
      cols: dimensions?.cols ?? 100,
      rows: Math.max(12, Math.floor((dimensions?.rows ?? 24) / 2))
    })
    if (!opened.ok || !opened.tabId || !opened.name) {
      appendLog(
        {
          kind: 'error',
          text: opened.error || t.terminal.subterminalLimitReached
        },
        parentTab.id
      )
      return
    }

    ensureSubterminal(parentTab.id, {
      id: opened.tabId,
      name: opened.name,
      output: '',
      rawOutput: '',
      cwd: opened.cwd ?? '',
      status: 'active',
      connectionId: connection.id,
      connectionName: connection.name,
      isSsh: true,
      terminalMode: opened.mode,
      sessionId: opened.sessionId,
      terminalReady: true
    })
    setSubterminalCollapsed(false)
    setHiddenPane(null)
    setTerminalPage('terminal')
    appendLog(
      { kind: 'status', text: `${t.terminal.openedSubterminal}: ${connection.name}` },
      resolveSessionChatTabId(tabsRef.current, parentTab.id)
    )
    void executeConnectionAutomation(connection, opened.tabId, true)
  }

  function connectFromConnectionManager(connection: ConnectionConfig): void {
    if (isLocalConnection(connection)) {
      openLocalTerminal()
      if (connectionModalOpen) setConnectionModalOpen(false)
      return
    }

    if (connectionModalOpen) {
      openConnectionTerminal(connection)
      setConnectionModalOpen(false)
      return
    }

    connectToConnection(connection)
    setHiddenPane(null)
    setTerminalPage('terminal')
  }

  function openNewConnectionForm(): void {
    resetConnectionForm()
    setConnectionModalOpen(true)
  }

  async function saveConnection(connectAfterSave = false): Promise<void> {
    const normalizedInput = normalizeConnectionInputForSave(
      connectionForm,
      connectionActionsText,
      connectionSshOptionsText
    )
    if (!normalizedInput) return

    const input = normalizedInput.id
      ? normalizedInput
      : { ...normalizedInput, id: createCustomConnectionId() }

    setConnectionSaveMessage(null)

    try {
      const nextConnections = await window.api.connections.save(input)
      setConnections(nextConnections)
      const fallbackConnection: ConnectionConfig = {
        ...input,
        id: input.id ?? '',
        source: 'custom'
      }
      const savedConnection = mergeConnectionInput(
        nextConnections.find((connection) => connection.id === input.id),
        fallbackConnection
      )

      setConnectionSaveMessage({
        type: 'success',
        text: connectAfterSave ? t.connections.saveAndConnectSucceeded : t.connections.saveSucceeded
      })

      if (connectAfterSave && savedConnection) {
        connectFromConnectionManager(savedConnection)
        setConnectionModalOpen(false)
        resetConnectionForm()
        return
      }

      if (savedConnection) {
        editConnection(savedConnection)
      }
    } catch (error) {
      setConnectionSaveMessage({
        type: 'error',
        text: `${t.connections.saveFailed}: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }

  async function deleteConnection(id: string): Promise<void> {
    if (!window.confirm(t.confirm.deleteConnection)) return

    const nextConnections = await window.api.connections.delete(id)
    setConnections(nextConnections)
    if (connectionForm.id === id) resetConnectionForm()
  }

  async function resolveConnectionIntentForInput(
    input: string,
    options?: {
      conversationContext?: string
      currentConnectionId?: string
      currentConnectionName?: string
      terminalSummary?: string
    }
  ): Promise<{
    analysis?: AgentConnectionIntentResult
    connection?: ConnectionConfig
  }> {
    let candidates = connections

    try {
      candidates = await window.api.connections.list()
      setConnections(candidates)
    } catch {
      candidates = connections
    }

    try {
      const analysis = await window.api.agent.resolveConnectionIntent({
        input,
        conversationContext: options?.conversationContext,
        currentConnectionId: options?.currentConnectionId,
        currentConnectionName: options?.currentConnectionName,
        terminalSummary: options?.terminalSummary
      })
      if (analysis.needsClarification) {
        return { analysis }
      }
      if (!analysis.shouldConnect || !analysis.ok || !analysis.connectionId) {
        return { analysis }
      }

      return {
        analysis,
        connection: candidates.find((connection) => connection.id === analysis.connectionId)
      }
    } catch (error) {
      return {
        analysis: {
          ok: false,
          shouldConnect: false,
          confidence: 0,
          needsClarification: true,
          clarificationQuestion: t.terminal.connectionClarifyFallback,
          reason: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }

  async function submitAgent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await submitAgentMessage()
  }

  async function submitAgentMessage(overrideInput?: string): Promise<void> {
    const terminalTabId = activeTabIdRef.current
    const chatTabId = resolveSessionChatTabId(tabsRef.current, terminalTabId)
    const tab = tabsRef.current.find((candidate) => candidate.id === chatTabId)
    const terminalTab = tabsRef.current.find((candidate) => candidate.id === terminalTabId)
    const displayInput = (overrideInput ?? tab?.agentInput ?? '').trim()
    if (!displayInput) return

    if (/^\/new$/i.test(displayInput)) {
      startNewSession()
      return
    }

    const skillRefs = tab?.skillRefs ?? []
    const pathRefs = tab?.pathRefs ?? []
    const toolRefs = tab?.toolRefs ?? []
    const wikiRefs = tab?.wikiRefs ?? []
    const resumeRequested = isContinueIntent(displayInput)
    const baseInput = buildAgentInputWithReferences(
      displayInput,
      skillRefs,
      pathRefs,
      toolRefs,
      wikiRefs,
      t
    )
    const input = resumeRequested && tab ? buildResumeAgentInput(tab, baseInput, t) : baseInput
    const conversationContext = tab ? buildRecentConversationContext(tab, displayInput, t) : ''
    const startedAt = Date.now()

    if (tab?.agentBusy) {
      updateTab(chatTabId, (current) => ({
        ...current,
        agentInput: '',
        skillRefs: [],
        pathRefs: [],
        toolRefs: [],
        wikiRefs: []
      }))
      const runId = activeRunIdRef.current.get(chatTabId)
      if (runId) void window.api.agent.supplement({ runId, input })
      updateAgentRun(chatTabId, (run) => ({
        ...run,
        steps: [
          ...(run.steps ?? []),
          {
            id: `supplement-${Date.now()}`,
            kind: 'status',
            title: t.input.contextSupplement,
            detail: formatVisibleInputWithReferences(
              `${t.input.contextSupplementDetail}\n${displayInput}`,
              skillRefs,
              pathRefs,
              toolRefs,
              wikiRefs,
              t
            )
          }
        ]
      }))
      return
    }

    updateTab(chatTabId, (current) => ({
      ...current,
      agentInput: '',
      skillRefs: [],
      pathRefs: [],
      toolRefs: [],
      wikiRefs: []
    }))
    appendLog(
      {
        kind: 'user',
        text: displayInput
      },
      chatTabId
    )
    const setThinking = (message: string): void => {
      updateTab(chatTabId, (current) => ({
        ...current,
        agentThinking: true,
        thinkingMessage: message
      }))
    }
    const clearThinking = (): void => {
      updateTab(chatTabId, (current) => ({
        ...current,
        agentThinking: false,
        thinkingMessage: undefined
      }))
    }
    setThinking(t.input.thinkingAnalyzingRequest)

    const terminalContext = await window.api.terminal.getContext(terminalTabId)
    const pendingClarification = tab?.pendingClarification
    const intentSourceInput =
      pendingClarification?.kind === 'connection-intent'
        ? `${pendingClarification.originalInput}\n\n${t.terminal.connectionClarifyReplyPrefix}\n${displayInput}`
        : displayInput
    if (pendingClarification) {
      updateTab(chatTabId, (current) => ({ ...current, pendingClarification: undefined }))
    }

    const explicitNonTerminalRequest = isExplicitNonTerminalAgentRequest(displayInput, toolRefs)
    const explicitLocalFileRequest = hasExplicitLocalFileOperationIntent(intentSourceInput)
    const sessionTabs = getSessionTerminals(
      tabsRef.current,
      getSessionGroupId(tab ?? terminalTab ?? { id: terminalTabId, sessionGroupId: terminalTabId })
    )
    const lastUsedConnectionId =
      (await window.api.connections.getLastUsed().catch(() => null)) ?? undefined
    const route = routeConnection({
      message: intentSourceInput,
      activeTabId: terminalTabId,
      activeTab: terminalTab,
      sessionTabs,
      connections,
      lastUsedConnectionId: lastUsedConnectionId || undefined,
      resumeRequested,
      explicitNonTerminal: explicitNonTerminalRequest,
      explicitLocalFile: explicitLocalFileRequest
    })

    const terminalSummary = [
      `mode=${terminalContext.mode}`,
      `cwd=${terminalContext.cwd || '-'}`,
      terminalTab?.connectionId ? `tabConnectionId=${terminalTab.connectionId}` : '',
      terminalTab?.connectionName ? `tabConnectionName=${terminalTab.connectionName}` : '',
      terminalTab?.isSsh ? 'tabIsSsh=true' : 'tabIsSsh=false',
      route.label ? `routeLabel=${route.label}` : '',
      route.action ? `routeAction=${route.action}` : '',
      `recentOutput=${terminalContext.output.slice(-1200)}`
    ]
      .filter(Boolean)
      .join('\n')

    let connectionIntent: Awaited<ReturnType<typeof resolveConnectionIntentForInput>> | undefined
    let executionTerminalId = terminalTabId
    try {
      if (route.action === 'llm-fallback') {
        setThinking(t.input.thinkingResolvingConnection)
        connectionIntent = await resolveConnectionIntentForInput(intentSourceInput, {
          conversationContext,
          currentConnectionId: terminalTab?.connectionId,
          currentConnectionName: terminalTab?.connectionName,
          terminalSummary
        })
        // Remote ops must not proceed without a target — never let the main model invent login methods.
        if (
          looksLikeRemoteOpsIntent(intentSourceInput) &&
          connectionIntent.analysis &&
          !connectionIntent.analysis.needsClarification &&
          !connectionIntent.analysis.shouldConnect
        ) {
          if (connections.length === 1) {
            connectionIntent = {
              analysis: {
                ok: true,
                shouldConnect: true,
                connectionId: connections[0].id,
                confidence: 100,
                executeAfterLogin: true,
                matchBasis: 'name',
                reason: `${t.terminal.connectionMatched}: ${connections[0].name}`
              },
              connection: connections[0]
            }
          } else if (lastUsedConnectionId) {
            const last = connections.find((c) => c.id === lastUsedConnectionId)
            if (last) {
              connectionIntent = {
                analysis: {
                  ok: true,
                  shouldConnect: true,
                  connectionId: last.id,
                  confidence: 90,
                  executeAfterLogin: true,
                  matchBasis: 'name',
                  reason: `${t.terminal.connectionMatched}: ${last.name}`
                },
                connection: last
              }
            } else {
              connectionIntent = {
                analysis: {
                  ok: false,
                  shouldConnect: false,
                  confidence: 0,
                  needsClarification: true,
                  clarificationQuestion:
                    connections.length > 0
                      ? t.terminal.connectionClarifyPickOne.replace(
                          '{options}',
                          formatConnectionClarifyOptions(
                            connections.map((c) => ({ id: c.id, label: c.name }))
                          )
                        )
                      : t.terminal.connectionNoneConfigured,
                  reason: 'llm-no-connect-remote'
                }
              }
            }
          } else {
            connectionIntent = {
              analysis: {
                ok: false,
                shouldConnect: false,
                confidence: 0,
                needsClarification: true,
                clarificationQuestion:
                  connections.length > 0
                    ? t.terminal.connectionClarifyPickOne.replace(
                        '{options}',
                        formatConnectionClarifyOptions(
                          connections.map((c) => ({ id: c.id, label: c.name }))
                        )
                      )
                    : t.terminal.connectionNoneConfigured,
                reason: 'llm-no-connect-remote'
              }
            }
          }
        }
      } else if (route.action === 'clarify') {
        const optionsText = formatConnectionClarifyOptions(route.clarifyOptions ?? [])
        const clarificationQuestion =
          route.reason === 'remote-no-connections'
            ? t.terminal.connectionNoneConfigured
            : optionsText
              ? t.terminal.connectionClarifyPickOne.replace('{options}', optionsText)
              : t.terminal.connectionClarifyFallback
        connectionIntent = {
          analysis: {
            ok: false,
            shouldConnect: false,
            confidence: 0,
            needsClarification: true,
            clarificationQuestion,
            reason: route.reason
          }
        }
      } else if (
        (route.action === 'connect' || route.action === 'switch') &&
        route.connection
      ) {
        const thinkingLabel = route.label || route.connection.name
        setThinking(
          route.action === 'connect'
            ? t.terminal.autoConnecting.replace('{label}', thinkingLabel)
            : t.input.routingTo.replace('{label}', thinkingLabel)
        )
        // switch to an already-connected peer tab: reuse without reconnect
        if (route.action === 'switch' && route.targetTabId !== terminalTabId) {
          executionTerminalId = route.targetTabId
          setActiveExecutionTerminal(chatTabId, route.targetTabId)
          connectionIntent = undefined
        } else {
          connectionIntent = {
            analysis: {
              ok: true,
              shouldConnect: true,
              connectionId: route.connection.id,
              confidence: 100,
              executeAfterLogin: route.executeAfterLogin !== false,
              matchBasis: 'name',
              reason: `${t.terminal.connectionMatched}: ${route.connection.name}`
            },
            connection: route.connection
          }
        }
      } else {
        // reuse — instantaneous routing indicator, no LLM
        if (route.label) {
          setThinking(t.input.routingTo.replace('{label}', route.label))
        }
        connectionIntent = undefined
      }
    } finally {
      // Keep thinking visible until the next concrete UI phase replaces it.
    }

    if (connectionIntent?.analysis?.needsClarification) {
      clearThinking()
      const question =
        connectionIntent.analysis.clarificationQuestion?.trim() ||
        t.terminal.connectionClarifyFallback
      const clarifyOptions =
        route.clarifyOptions && route.clarifyOptions.length > 0
          ? route.clarifyOptions
          : connections.map((c) => ({ id: c.id, label: c.name }))
      const defaultOptionId =
        lastUsedConnectionId && clarifyOptions.some((option) => option.id === lastUsedConnectionId)
          ? lastUsedConnectionId
          : undefined
      appendLog(
        {
          kind: 'assistant',
          text: formatAgentRunMarkdown(
            {
              logId: -1,
              actions: [],
              steps: [
                {
                  id: 'clarify',
                  kind: 'status',
                  title: t.terminal.connectionClarifyTitle,
                  detail: [connectionIntent.analysis.reason, question].filter(Boolean).join('\n')
                }
              ],
              result: question,
              elapsedMs: Date.now() - startedAt
            },
            t
          )
        },
        chatTabId
      )
      updateTab(chatTabId, (current) => ({
        ...current,
        pendingClarification: {
          kind: 'connection-intent',
          originalInput: pendingClarification?.originalInput || displayInput,
          question,
          options: clarifyOptions.length > 0 ? clarifyOptions : undefined,
          defaultOptionId
        }
      }))
      return
    }

    const shouldUseCurrentTerminal =
      terminalContext.mode !== 'none' &&
      hasUsableCurrentTerminal(
        tabsRef.current.find((candidate) => candidate.id === executionTerminalId) ?? terminalTab,
        terminalContext.output,
        terminalContext.mode
      ) &&
      !connectionIntent?.analysis?.shouldConnect &&
      !explicitNonTerminalRequest &&
      !isExplicitConnectionRequest(displayInput)

    // Remote ops without a resolved connection must not fall through to the main model
    // when configured connections exist (would otherwise invent "pick a login method").
    if (
      !connectionIntent?.analysis?.shouldConnect &&
      looksLikeRemoteOpsIntent(intentSourceInput) &&
      connections.length > 0 &&
      !(
        tabsRef.current.find((candidate) => candidate.id === executionTerminalId)?.connectionId ||
        terminalTab?.connectionId ||
        terminalTab?.isSsh
      )
    ) {
      clearThinking()
      const optionsText = formatConnectionClarifyOptions(
        connections.map((c) => ({ id: c.id, label: c.name }))
      )
      const question = t.terminal.connectionClarifyPickOne.replace('{options}', optionsText)
      const clarifyOptions = connections.map((c) => ({ id: c.id, label: c.name }))
      const defaultOptionId =
        lastUsedConnectionId && clarifyOptions.some((option) => option.id === lastUsedConnectionId)
          ? lastUsedConnectionId
          : undefined
      appendLog(
        {
          kind: 'assistant',
          text: formatAgentRunMarkdown(
            {
              logId: -1,
              actions: [],
              steps: [
                {
                  id: 'clarify',
                  kind: 'status',
                  title: t.terminal.connectionClarifyTitle,
                  detail: question
                }
              ],
              result: question,
              elapsedMs: Date.now() - startedAt
            },
            t
          )
        },
        chatTabId
      )
      updateTab(chatTabId, (current) => ({
        ...current,
        pendingClarification: {
          kind: 'connection-intent',
          originalInput: pendingClarification?.originalInput || displayInput,
          question,
          options: clarifyOptions.length > 0 ? clarifyOptions : undefined,
          defaultOptionId
        }
      }))
      return
    }

    if (connectionIntent?.analysis?.shouldConnect) {
      clearThinking()
      const matchedConnection = connectionIntent.connection
      const executeAfterLogin = connectionIntent.analysis.executeAfterLogin === true

      if (!matchedConnection) {
        appendLog(
          {
            kind: 'assistant',
            text: formatAgentRunMarkdown(
              {
                logId: -1,
                actions: [],
                steps: [
                  {
                    id: 'match-miss',
                    kind: 'status',
                    title: t.terminal.connectionMatched,
                    detail: connectionIntent.analysis.reason ?? displayInput
                  }
                ],
                error: t.terminal.connectionNoMatch,
                elapsedMs: Date.now() - startedAt
              },
              t
            )
          },
          chatTabId
        )
        return
      }

      const matchDetail = [
        matchedConnection.name,
        `${t.terminal.connectionTarget}: ${formatConnectionTarget(matchedConnection)}`,
        connectionIntent.analysis.reason,
        executeAfterLogin ? t.terminal.postLoginSkillHint : ''
      ]
        .filter(Boolean)
        .join('\n')

      const taskInput =
        intentSourceInput === displayInput
          ? input
          : buildAgentInputWithReferences(
              intentSourceInput,
              skillRefs,
              pathRefs,
              toolRefs,
              wikiRefs,
              t
            )

      if (executeAfterLogin) {
        const runId = `run-${crypto.randomUUID()}`
        updateTab(chatTabId, (current) => ({
          ...current,
          agentInput: '',
          agentBusy: true,
          agentThinking: false,
          thinkingMessage: undefined
        }))
        activeRunCanceledRef.current.delete(chatTabId)
        activeRunIdRef.current.set(chatTabId, runId)
        activeRunInputRef.current.set(chatTabId, displayInput)
        const matchStep = {
          id: 'match',
          kind: 'status' as const,
          title: t.terminal.connectionMatched,
          detail: matchDetail
        }
        const runLogId = appendLog(
          {
            kind: 'assistant',
            text: formatAgentRunMarkdown(
              {
                logId: -1,
                actions: [],
                steps: [matchStep],
                startedAt
              },
              t
            )
          },
          chatTabId
        )
        activeAgentRunRef.current.set(chatTabId, {
          logId: runLogId,
          runId,
          actions: [],
          steps: [matchStep],
          startedAt
        })
        updateAgentRun(chatTabId, (run) => run)
        void window.api.storage.saveAgentRun({
          runId,
          tabId: chatTabId,
          input: displayInput,
          status: 'running',
          connectionId: matchedConnection.id
        })

        const targetTabId = connectToConnection(
          matchedConnection,
          buildPostLoginAgentInput(taskInput, matchedConnection, t),
          formatVisibleInputWithReferences(
            displayInput,
            skillRefs,
            pathRefs,
            toolRefs,
            wikiRefs,
            t
          ),
          conversationContext,
          false,
          startedAt,
          { logId: runLogId, runId }
        )
        setActiveExecutionTerminal(chatTabId, targetTabId)
        return
      }

      appendLog(
        {
          kind: 'assistant',
          text: formatAgentRunMarkdown(
            {
              logId: -1,
              actions: [],
              steps: [
                {
                  id: 'match',
                  kind: 'status',
                  title: t.terminal.connectionMatched,
                  detail: matchDetail
                }
              ],
              result: t.terminal.connectionIntentResult,
              elapsedMs: Date.now() - startedAt
            },
            t
          )
        },
        chatTabId
      )

      connectToConnection(matchedConnection)
      return
    }

    setThinking(t.input.thinkingPreparingRun)
    const resolvedInput =
      intentSourceInput === displayInput
        ? input
        : buildAgentInputWithReferences(
            intentSourceInput,
            skillRefs,
            pathRefs,
            toolRefs,
            wikiRefs,
            t
          )
    const runInput = shouldUseCurrentTerminal
      ? buildCurrentTerminalAgentInput(resolvedInput, terminalContext, t)
      : resolvedInput
    const executionTab =
      tabsRef.current.find((candidate) => candidate.id === executionTerminalId) ?? terminalTab

    // Gate: never dispatch agent bash before the execution PTY is ready.
    const readyForAgent = await waitForTerminalReadyForAgent(executionTerminalId)
    const executionContext = await window.api.terminal.getContext(executionTerminalId)
    if (
      !readyForAgent ||
      !isExecutionTerminalReadyForAgent({
        tab: executionTab,
        terminalMode: executionContext.mode
      })
    ) {
      clearThinking()
      appendLog(
        {
          kind: 'assistant',
          text: formatAgentRunMarkdown(
            {
              logId: -1,
              actions: [],
              steps: [
                {
                  id: 'terminal-not-ready',
                  kind: 'status',
                  title: t.terminal.failedToStartShell,
                  detail: t.terminal.connectionNoActions
                }
              ],
              error: t.terminal.failedToStartShell,
              elapsedMs: Date.now() - startedAt
            },
            t
          )
        },
        chatTabId
      )
      return
    }

    await runAgentConversation(
      runInput,
      executionTerminalId,
      executionTab?.connectionId || terminalTab?.connectionId || undefined,
      displayInput,
      false,
      startedAt,
      {
        conversationContext,
        chatTabId,
        connectionRouteLabel: route.label
      }
    )
  }

  async function runAgentConversation(
    input: string,
    terminalTabId: string,
    connectionId?: string,
    displayInput = input,
    appendUserLog = true,
    startedAt = Date.now(),
    options: {
      conversationContext?: string
      chatTabId?: string
      reuseRun?: ReuseAgentRun
      connectionRouteLabel?: string
    } = {}
  ): Promise<void> {
    const chatTabId = options.chatTabId ?? resolveSessionChatTabId(tabsRef.current, terminalTabId)
    const reuseRun = options.reuseRun
    const existingReuse =
      reuseRun && activeAgentRunRef.current.get(chatTabId)?.logId === reuseRun.logId
        ? activeAgentRunRef.current.get(chatTabId)
        : undefined

    updateTab(chatTabId, (current) => ({
      ...current,
      agentInput: '',
      agentBusy: true,
      agentThinking: false,
      thinkingMessage: undefined
    }))
    activeRunCanceledRef.current.delete(chatTabId)
    const runId = existingReuse?.runId ?? reuseRun?.runId ?? `run-${crypto.randomUUID()}`
    activeRunIdRef.current.set(chatTabId, runId)
    activeRunInputRef.current.set(chatTabId, displayInput)
    setActiveExecutionTerminal(chatTabId, terminalTabId)
    void window.api.storage.saveAgentRun({
      runId,
      tabId: chatTabId,
      input: displayInput,
      status: 'running',
      connectionId
    })
    if (existingReuse) {
      activeAgentRunRef.current.set(chatTabId, {
        ...existingReuse,
        runId,
        startedAt: existingReuse.startedAt ?? startedAt
      })
      updateAgentRun(chatTabId, (run) => run)
    } else {
      if (appendUserLog) appendLog({ kind: 'user', text: displayInput }, chatTabId)
      const runLogId = appendLog(
        {
          kind: 'assistant',
          text: formatAgentRunMarkdown(
            {
              logId: -1,
              actions: [],
              steps: []
            },
            t
          )
        },
        chatTabId
      )
      activeAgentRunRef.current.set(chatTabId, {
        logId: runLogId,
        runId,
        actions: [],
        steps: [],
        startedAt
      })

      // Publish the initial structured run so the timeline renders immediately.
      updateAgentRun(chatTabId, (run) => run)
    }

    try {
      const runTab = tabsRef.current.find((candidate) => candidate.id === terminalTabId)
      const chatTab = tabsRef.current.find((candidate) => candidate.id === chatTabId)
      const runModelSelection = resolveTabModelSelection(chatTab ?? runTab, config, visibleModels)
      const executionTabId = activeExecutionTabIdRef.current.get(chatTabId) ?? terminalTabId
      let terminalContext = ''
      try {
        const context = await window.api.terminal.getContext(executionTabId)
        const routeLine = options.connectionRouteLabel?.trim()
          ? `当前终端/连接：${options.connectionRouteLabel.trim()}`
          : ''
        terminalContext = [
          routeLine,
          `mode: ${context.mode}`,
          `cwd: ${context.cwd || '-'}`,
          `shell: ${context.shell || '-'}`,
          '',
          (context.output || '').slice(-8000)
        ]
          .filter(Boolean)
          .join('\n')
      } catch {
        terminalContext = options.connectionRouteLabel?.trim()
          ? `当前终端/连接：${options.connectionRouteLabel.trim()}`
          : ''
      }
      const result = await window.api.agent.run({
        runId,
        input,
        skillInput: displayInput,
        conversationContext:
          options.conversationContext ?? buildRecentConversationContext(chatTab, displayInput, t),
        providerId: runModelSelection.providerId,
        model: runModelSelection.model,
        tabId: chatTabId,
        executionTabId,
        terminalContext,
        locale
      })

      if (activeRunCanceledRef.current.has(chatTabId)) return

      if (result.ok) {
        const resolved = resolveSuccessfulAgentResult({
          text: result.text,
          run: activeAgentRunRef.current.get(chatTabId),
          doneFallback: t.input.done
        })
        const elapsedMs = Date.now() - startedAt
        if (!resolved.ok) {
          updateAgentRun(chatTabId, (run) => ({
            ...run,
            steps: closeStreamingOpenSteps(run.steps ?? []),
            error: resolved.error,
            elapsedMs
          }))
          void window.api.storage.saveAgentRun({
            runId,
            tabId: chatTabId,
            input: displayInput,
            status: 'error',
            connectionId,
            error: resolved.error,
            startedAt: new Date(startedAt).toISOString(),
            elapsedMs,
            trace: buildTraceFromAgentRunView({
              runId,
              tabId: chatTabId,
              displayInput,
              status: 'error',
              connectionId,
              run: activeAgentRunRef.current.get(chatTabId),
              startedAt,
              error: resolved.error
            })
          })
        } else {
          updateAgentRun(chatTabId, (run) => ({
            ...run,
            steps: closeStreamingOpenSteps(run.steps ?? []),
            result: resolved.text,
            elapsedMs
          }))
          void window.api.storage.saveAgentRun({
            runId,
            tabId: chatTabId,
            input: displayInput,
            status: 'success',
            connectionId,
            output: resolved.text,
            startedAt: new Date(startedAt).toISOString(),
            elapsedMs,
            trace: buildTraceFromAgentRunView({
              runId,
              tabId: chatTabId,
              displayInput,
              status: 'success',
              connectionId,
              run: activeAgentRunRef.current.get(chatTabId),
              startedAt,
              output: resolved.text
            })
          })
        }
      } else {
        const elapsedMs = Date.now() - startedAt
        updateAgentRun(chatTabId, (run) => ({
          ...run,
          steps: closeStreamingOpenSteps(run.steps ?? []),
          error: result.error || t.input.failed,
          elapsedMs
        }))
        void window.api.storage.saveAgentRun({
          runId,
          tabId: chatTabId,
          input: displayInput,
          status: 'error',
          connectionId,
          error: result.error || t.input.failed,
          startedAt: new Date(startedAt).toISOString(),
          elapsedMs,
          trace: buildTraceFromAgentRunView({
            runId,
            tabId: chatTabId,
            displayInput,
            status: 'error',
            connectionId,
            run: activeAgentRunRef.current.get(chatTabId),
            startedAt,
            error: result.error || t.input.failed
          })
        })
      }
    } catch (error) {
      if (activeRunCanceledRef.current.has(chatTabId)) return

      const message = error instanceof Error ? error.message : String(error)
      const elapsedMs = Date.now() - startedAt
      updateAgentRun(chatTabId, (run) => ({
        ...run,
        steps: closeStreamingOpenSteps(run.steps ?? []),
        error: message,
        elapsedMs
      }))
      void window.api.storage.saveAgentRun({
        runId,
        tabId: chatTabId,
        input: displayInput,
        status: 'error',
        connectionId,
        error: message,
        startedAt: new Date(startedAt).toISOString(),
        elapsedMs,
        trace: buildTraceFromAgentRunView({
          runId,
          tabId: chatTabId,
          displayInput,
          status: 'error',
          connectionId,
          run: activeAgentRunRef.current.get(chatTabId),
          startedAt,
          error: message
        })
      })
    } finally {
      activeAgentRunRef.current.delete(chatTabId)
      activeRunCanceledRef.current.delete(chatTabId)
      activeRunIdRef.current.delete(chatTabId)
      activeRunInputRef.current.delete(chatTabId)
      updateTab(chatTabId, (current) => ({
        ...current,
        agentInput: '',
        agentBusy: false,
        agentThinking: false,
        thinkingMessage: undefined
      }))
    }
  }

  function handleAgentInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && isComposingInput(event)) return

    if (slashMenuVisible) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlashCommandIndex((current) => (current + 1) % slashCommandOptions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashCommandIndex(
          (current) => (current - 1 + slashCommandOptions.length) % slashCommandOptions.length
        )
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setSlashCommandOpen(false)
        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        insertSlashCommand(slashCommandOptions[selectedSlashCommandIndex])
        return
      }
    }

    if (event.key !== 'Enter' || event.shiftKey) return

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  async function handleAgentInputPaste(
    event: ReactClipboardEvent<HTMLTextAreaElement>
  ): Promise<void> {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return

    event.preventDefault()
    const references = await Promise.all(files.map(resolvePastedFileReference))
    const validReferences = references.filter((reference): reference is AgentPathReference =>
      Boolean(reference)
    )
    if (validReferences.length === 0) return

    updateTab(resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current), (tab) => ({
      ...tab,
      pathRefs: validReferences.reduce(addUniquePathRef, tab.pathRefs)
    }))
  }

  function insertSlashCommand(command: SlashCommandOption): void {
    const shouldOpenModeList = command.id === 'mode'
    const shouldOpenSkillList = command.id === 'skill'
    const shouldOpenConnectionList = command.id === 'connection'
    const shouldOpenToolList = command.id === 'tool'
    const shouldOpenMcpList = command.id === 'mcp'
    const shouldOpenWikiList = command.id === 'wiki'

    if (command.id === 'new') {
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      startNewSession()
      return
    }

    if (command.pathReferenceKind) {
      updateTab(sessionChatTab.id, (tab) => ({
        ...tab,
        agentInput: replaceSlashCommandInput(tab.agentInput, '')
      }))
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      void pickPathReference(command.pathReferenceKind)
      return
    }

    if (command.toolRef) {
      updateTab(sessionChatTab.id, (tab) => ({
        ...tab,
        agentInput: replaceSlashCommandInput(tab.agentInput, ''),
        toolRefs: addUniqueToolRef(tab.toolRefs, command.toolRef as AgentToolReference)
      }))
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      return
    }

    if (command.wikiDocument) {
      void addWikiReference(command.wikiDocument)
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      return
    }

    if (command.wikiRef) {
      updateTab(sessionChatTab.id, (tab) => ({
        ...tab,
        agentInput: replaceSlashCommandInput(tab.agentInput, ''),
        wikiRefs: addUniqueWikiRef(tab.wikiRefs, command.wikiRef as AgentWikiReference)
      }))
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      return
    }

    if (command.agentMode) {
      updateConfig('agentMode', command.agentMode)
      updateTab(sessionChatTab.id, (tab) => ({
        ...tab,
        agentInput: replaceSlashCommandInput(tab.agentInput, '')
      }))
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      return
    }

    if (command.connection) {
      updateTab(sessionChatTab.id, (tab) => ({
        ...tab,
        agentInput: replaceSlashCommandInput(tab.agentInput, '')
      }))
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      connectToConnection(command.connection)
      return
    }

    updateTab(sessionChatTab.id, (tab) => ({
      ...tab,
      agentInput: replaceSlashCommandInput(
        tab.agentInput,
        command.templateInput ?? (command.skill ? '' : command.value)
      ),
      skillRefs: command.skill ? addUniqueSkillRef(tab.skillRefs, command.skill) : tab.skillRefs
    }))
    setSlashCommandIndex(0)
    setSlashCommandOpen(
      shouldOpenModeList ||
        shouldOpenSkillList ||
        shouldOpenConnectionList ||
        shouldOpenToolList ||
        shouldOpenMcpList ||
        shouldOpenWikiList
    )
  }

  function removeSkillRef(skillId: string): void {
    updateTab(sessionChatTab.id, (tab) => ({
      ...tab,
      skillRefs: tab.skillRefs.filter((skill) => skill.id !== skillId)
    }))
  }

  function removeToolRef(toolId: string): void {
    updateTab(sessionChatTab.id, (tab) => ({
      ...tab,
      toolRefs: tab.toolRefs.filter((tool) => tool.id !== toolId)
    }))
  }

  function removeWikiRef(wikiId: string): void {
    updateTab(sessionChatTab.id, (tab) => ({
      ...tab,
      wikiRefs: tab.wikiRefs.filter((wiki) => wiki.id !== wikiId)
    }))
  }

  async function addWikiReference(document: WikiDocumentSummary): Promise<void> {
    const detail = await window.api.agent.getWikiDocument(document.id)
    if (!detail) return

    updateTab(sessionChatTab.id, (tab) => ({
      ...tab,
      agentInput: replaceSlashCommandInput(tab.agentInput, ''),
      wikiRefs: addUniqueWikiRef(tab.wikiRefs, {
        id: detail.id,
        title: detail.title,
        path: detail.path,
        content: detail.content
      })
    }))
  }

  async function pickPathReference(kind: AgentPathReference['kind']): Promise<void> {
    const reference = await window.api.agent.pickPathReference(kind)
    if (!reference) return

    updateTab(sessionChatTab.id, (tab) => ({
      ...tab,
      pathRefs: addUniquePathRef(tab.pathRefs, reference)
    }))
  }

  async function toggleVoiceInput(): Promise<void> {
    if (voiceInputState === 'transcribing') return
    // Allow recording while Whisper is still probing if browser speech works.
    if (!voiceInputSupported || (voiceInputSupportChecking && !voiceBrowserSpeechAvailable)) {
      toast.error(t.input.voiceUnsupported)
      return
    }

    if (voiceInputState === 'recording') {
      const liveSession = voiceLiveSessionRef.current
      voiceLiveSessionRef.current = null
      if (!liveSession) {
        setVoiceInputState('idle')
        return
      }

      setVoiceInputState('transcribing')
      try {
        const transcript = (await liveSession.stop()).trim()
        if (!transcript) {
          toast.error(t.input.voiceEmpty)
          setVoiceInputState('idle')
          return
        }
        const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
        flushSync(() => {
          updateTab(chatTabId, (tab) => ({
            ...tab,
            agentInput: transcript
          }))
        })
        setVoiceInputState('idle')
        await submitAgentMessage(transcript)
      } catch (error) {
        const message = error instanceof Error ? error.message : t.input.voiceFailed
        toast.error(isWhisperUnavailableError(message) ? t.input.voiceProviderUnsupported : message)
        setVoiceInputState('idle')
      }
      return
    }

    try {
      const permission = await window.api.agent.requestMicrophonePermission()
      if (!permission.granted) {
        toast.error(t.input.voicePermissionDenied)
        return
      }

      const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
      let whisperUnavailableNotified = false
      const useWhisper = voiceWhisperSupported
      if (!useWhisper && voiceBrowserSpeechAvailable) {
        toast.message(t.input.voiceProviderUnsupportedFallback)
      }
      const session = await startVoiceInputSession({
        speechLanguage: locale.startsWith('zh')
          ? 'zh-CN'
          : locale.startsWith('en')
            ? 'en-US'
            : locale,
        whisperLanguage: locale.startsWith('zh')
          ? 'zh'
          : locale.startsWith('en')
            ? 'en'
            : undefined,
        intervalMs: 2800,
        transcribe: useWhisper
          ? async ({ base64, mimeType, language: lang }) => {
              const result = await window.api.agent.transcribeAudio({
                base64,
                mimeType,
                name: `voice-input${extensionForAudioMime(mimeType)}`,
                language: lang
              })
              if (!result.ok) {
                throw new Error(result.error || t.input.voiceFailed)
              }
              return result.text?.trim() || ''
            }
          : undefined,
        onTranscript: (text) => {
          updateTab(chatTabId, (tab) => ({
            ...tab,
            agentInput: text
          }))
        },
        onError: (error) => {
          if (isWhisperUnavailableError(error.message)) {
            if (!whisperUnavailableNotified) {
              whisperUnavailableNotified = true
              toast.message(t.input.voiceProviderUnsupportedFallback)
            }
            return
          }
          if (/permission|denied|NotAllowed/i.test(error.message)) {
            toast.error(t.input.voicePermissionDenied)
            voiceLiveSessionRef.current?.cancel()
            voiceLiveSessionRef.current = null
            setVoiceInputState('idle')
            return
          }
          toast.error(error.message || t.input.voiceFailed)
        }
      })
      voiceLiveSessionRef.current = session
      setVoiceInputState('recording')
    } catch (error) {
      const message = error instanceof Error ? error.message : t.input.voiceFailed
      toast.error(
        /permission|denied|NotAllowed/i.test(message)
          ? t.input.voicePermissionDenied
          : isWhisperUnavailableError(message)
            ? t.input.voiceProviderUnsupported
            : message
      )
      setVoiceInputState('idle')
    }
  }

  function removePathRef(pathRefId: string): void {
    updateTab(sessionChatTab.id, (tab) => ({
      ...tab,
      pathRefs: tab.pathRefs.filter((reference) => reference.id !== pathRefId)
    }))
  }

  function updateConfig<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]): void {
    setConfig((current) => ({ ...current, [key]: value }))
    setValidation(undefined)
  }

  function updateSettingsProvider<K extends keyof AgentProviderConfig>(
    key: K,
    value: AgentProviderConfig[K]
  ): void {
    const currentProviderId = settingsProviderId || settingsProvider.id
    if (!currentProviderId) return

    if (key === 'id') {
      const nextProviderId = String(value).trim()
      if (!nextProviderId) return
      if (
        config.providers.some(
          (provider) => provider.id !== currentProviderId && provider.id === nextProviderId
        )
      ) {
        return
      }

      setConfig((current) => {
        const providers = current.providers.map((provider) =>
          provider.id === currentProviderId ? { ...provider, id: nextProviderId } : provider
        )

        return {
          ...current,
          providers,
          providerId: current.providerId === currentProviderId ? nextProviderId : current.providerId
        }
      })
      setSettingsProviderId(nextProviderId)
      setValidation(undefined)
      return
    }

    setConfig((current) => ({
      ...current,
      providers: current.providers.map((provider) =>
        provider.id === currentProviderId ? { ...provider, [key]: value } : provider
      )
    }))
    setValidation(undefined)
  }

  function updateSettingsProviderModels(value: string): void {
    setProviderModelsText(value)
    updateSettingsProvider('models', parseProviderModels(value))
  }

  function selectSettingsProvider(providerId: string): void {
    const provider = config.providers.find((candidate) => candidate.id === providerId)
    setSettingsProviderId(providerId)
    setProviderModelsText(formatProviderModels(provider?.models ?? []))
  }

  function toggleProviderDetails(providerId: string): void {
    selectSettingsProvider(providerId)
    setOpenApiEditorOpen(false)
    setInstructionEditorOpen(false)
    setProviderEditorOpen(true)
    window.requestAnimationFrame(() => {
      document.getElementById('provider-editor-panel')?.scrollIntoView({
        block: 'start',
        behavior: 'smooth'
      })
    })
  }

  function createProvider(): void {
    const id = `provider-${Date.now()}`
    const provider: AgentProviderConfig = {
      id,
      name: '',
      baseUrl: '',
      apiKey: '',
      models: []
    }

    setConfig((current) => ({ ...current, providers: [...current.providers, provider] }))
    setSettingsProviderId(id)
    setProviderModelsText(formatProviderModels(provider.models))
    setOpenApiEditorOpen(false)
    setInstructionEditorOpen(false)
    setProviderEditorOpen(true)
    setValidation(undefined)
    window.requestAnimationFrame(() => {
      document.getElementById('provider-editor-panel')?.scrollIntoView({
        block: 'start',
        behavior: 'smooth'
      })
    })
  }

  function deleteSettingsProvider(providerId = settingsProviderId): void {
    const targetId = providerId.trim()
    if (!targetId) return
    if (config.providers.length <= 1) return

    const target = config.providers.find((provider) => provider.id === targetId) ?? settingsProvider
    const label = target.name.trim() || target.id || targetId
    if (!window.confirm(`${t.confirm.deleteProvider}\n\n${label}`)) return

    const remainingProviders = config.providers.filter((provider) => provider.id !== targetId)
    const nextProvider = remainingProviders[0]
    const modelProvider = remainingProviders.find((provider) =>
      provider.models.some((model) => model.id === config.model)
    )
    const modelStillAvailable = Boolean(modelProvider)
    const wasEditingTarget = targetId === settingsProviderId

    setConfig({
      ...config,
      providers: remainingProviders,
      providerId: modelStillAvailable ? modelProvider?.id : nextProvider?.id,
      model: modelStillAvailable ? config.model : (nextProvider?.models[0]?.id ?? '')
    })
    setSettingsProviderId(wasEditingTarget ? (nextProvider?.id ?? '') : settingsProviderId)
    setProviderModelsText(
      formatProviderModels(
        (wasEditingTarget ? nextProvider?.models : settingsProvider.models) ?? []
      )
    )
    if (wasEditingTarget) setProviderEditorOpen(false)
    setValidation(undefined)
  }

  function updateSettingsMcpServer<K extends keyof AgentMcpServerConfig>(
    key: K,
    value: AgentMcpServerConfig[K]
  ): void {
    const nextServerId = key === 'id' ? String(value) : settingsMcpServerId
    if (
      key === 'id' &&
      config.mcpServers.some(
        (server) => server.id !== settingsMcpServer.id && server.id === nextServerId
      )
    ) {
      return
    }

    setConfig((current) => ({
      ...current,
      mcpServers: current.mcpServers.map((server) =>
        server.id === settingsMcpServer.id ? { ...server, [key]: value } : server
      )
    }))
    if (key === 'id') setSettingsMcpServerId(nextServerId)
    setValidation(undefined)
  }

  function updateSettingsMcpServerForId<K extends keyof AgentMcpServerConfig>(
    serverId: string,
    key: K,
    value: AgentMcpServerConfig[K]
  ): void {
    const nextServerId = key === 'id' ? String(value) : serverId
    if (
      key === 'id' &&
      config.mcpServers.some((server) => server.id !== serverId && server.id === nextServerId)
    ) {
      return
    }

    setConfig((current) => ({
      ...current,
      mcpServers: current.mcpServers.map((server) =>
        server.id === serverId ? { ...server, [key]: value } : server
      )
    }))
    if (settingsMcpServerId === serverId || key === 'id') setSettingsMcpServerId(nextServerId)
    setValidation(undefined)
  }

  function updateSettingsMcpArgs(value: string): void {
    setMcpArgsText(value)
    updateSettingsMcpServer('args', parseMcpArgs(value))
  }

  function updateSettingsMcpEnv(value: string): void {
    setMcpEnvText(value)
    updateSettingsMcpServer('env', parseMcpEnv(value))
  }

  function selectSettingsMcpServer(serverId: string): void {
    const server = config.mcpServers.find((candidate) => candidate.id === serverId)
    setSettingsMcpServerId(serverId)
    setMcpArgsText(formatMcpArgs(server?.args ?? []))
    setMcpEnvText(formatMcpEnv(server?.env ?? {}))
  }

  function toggleMcpDetails(serverId: string): void {
    if (mcpEditorOpen && settingsMcpServerId === serverId) {
      setMcpEditorOpen(false)
      return
    }

    selectSettingsMcpServer(serverId)
    setMcpEditorOpen(true)
  }

  function createMcpServer(): void {
    const id = `mcp-${Date.now()}`
    const server: AgentMcpServerConfig = {
      id,
      name: id,
      transport: 'stdio',
      command: '',
      args: [],
      env: {},
      enabled: true
    }

    setConfig((current) => ({ ...current, mcpServers: [...current.mcpServers, server] }))
    setSettingsMcpServerId(id)
    setMcpArgsText('')
    setMcpEnvText('')
    setMcpEditorOpen(true)
    setValidation(undefined)
  }

  function updateConnectionForm<K extends keyof ConnectionInput>(
    key: K,
    value: ConnectionInput[K]
  ): void {
    setConnectionForm((current) => ({ ...current, [key]: value }))
  }

  function resetConnectionForm(): void {
    setConnectionForm(createEmptyConnectionForm())
    setConnectionSshOptionsText('')
    setConnectionActionsText('')
    setConnectionImportText('')
    setConnectionSaveMessage(null)
    setSelectedConnectionId('')
    setConnectionEditing(true)
  }

  function loadConnectionIntoForm(connection: ConnectionConfig, editing: boolean): void {
    setConnectionForm(connectionToForm(connection))
    setConnectionSshOptionsText(connection.sshOptions?.join('\n') ?? '')
    setConnectionActionsText(connection.actions?.join('\n') ?? '')
    setSelectedConnectionId(connection.id)
    setConnectionEditing(editing)
  }

  function selectConnection(connection: ConnectionConfig): void {
    loadConnectionIntoForm(connection, false)
  }

  function editConnection(connection: ConnectionConfig): void {
    loadConnectionIntoForm(connection, true)
  }

  function duplicateConnection(connection: ConnectionConfig): void {
    const form = connectionToForm(connection)
    setConnectionForm({
      ...form,
      id: undefined,
      name: `${connection.name} copy`
    })
    setConnectionSshOptionsText(connection.sshOptions?.join('\n') ?? '')
    setConnectionActionsText(connection.actions?.join('\n') ?? '')
    setSelectedConnectionId('')
    setConnectionEditing(true)
  }

  async function copyConnection(connection: ConnectionConfig): Promise<void> {
    const value: ConnectionInput = {
      name: connection.name,
      host: connection.host,
      user: connection.user,
      password: connection.password,
      passwordEnvVar: connection.passwordEnvVar,
      port: connection.port,
      identityFile: connection.identityFile,
      sshOptions: connection.sshOptions,
      description: connection.description,
      actions: connection.actions
    }

    await copyText(JSON.stringify(value, null, 2), copyFeedback(t))
  }

  function importConnectionFromText(): void {
    try {
      const parsed = JSON.parse(connectionImportText) as Partial<ConnectionInput>
      setConnectionForm({
        name: parsed.name ? `${parsed.name} copy` : '',
        host: String(parsed.host ?? ''),
        user: parsed.user,
        password: parsed.password,
        passwordEnvVar: parsed.passwordEnvVar,
        port: parsed.port ?? 22,
        identityFile: parsed.identityFile,
        sshOptions: parsed.sshOptions,
        description: parsed.description,
        actions: parsed.actions
      })
      setConnectionSshOptionsText(parsed.sshOptions?.join('\n') ?? '')
      setConnectionActionsText(parsed.actions?.join('\n') ?? '')
      setConnectionImportText('')
      setSelectedConnectionId('')
      setConnectionEditing(true)
    } catch {
      setConnectionImportText((current) => current)
    }
  }

  function performCloseTab(tabId: string): void {
    const { closingTab, groupId, peers, shouldPromote, nextRoot } = planCloseTabPromotion(
      tabsRef.current,
      tabId
    )

    if (shouldPromote && nextRoot && closingTab) {
      const run = activeAgentRunRef.current.get(groupId)
      if (run) {
        activeAgentRunRef.current.delete(groupId)
        activeAgentRunRef.current.set(nextRoot.id, run)
      }
      const runId = activeRunIdRef.current.get(groupId)
      if (runId) {
        activeRunIdRef.current.delete(groupId)
        activeRunIdRef.current.set(nextRoot.id, runId)
      }
      const runInput = activeRunInputRef.current.get(groupId)
      if (runInput !== undefined) {
        activeRunInputRef.current.delete(groupId)
        activeRunInputRef.current.set(nextRoot.id, runInput)
      }
      if (activeRunCanceledRef.current.delete(groupId)) {
        activeRunCanceledRef.current.add(nextRoot.id)
      }
      remapActiveExecutionTerminal(groupId, nextRoot.id)
    } else if (peers.length === 0) {
      // Last terminal in this session is closing — stop any orphaned agent run.
      cancelAgentRunForChatTab(groupId)
    } else if (activeExecutionTabIdRef.current.get(groupId) === tabId) {
      // Closing the terminal currently executing agent commands — stop the run.
      cancelAgentRunForChatTab(groupId)
    }

    rejectApprovalsForClosedTabs([
      tabId,
      ...(closingTab?.subTerminals.map((subterminal) => subterminal.id) ?? [])
    ])

    suppressTerminalReconnectRef.current.add(tabId)
    window.api.terminal.stop(tabId)
    closingTab?.subTerminals.forEach((subterminal) => {
      suppressTerminalReconnectRef.current.add(subterminal.id)
      window.api.terminal.stop(subterminal.id)
    })
    pendingSshRef.current.delete(tabId)
    setTabs((current) => {
      let next = current
      if (shouldPromote && nextRoot && closingTab) {
        next = reassignSessionRootOnClose(current, closingTab, nextRoot, groupId, tabId)
      }
      next = next.filter((tab) => tab.id !== tabId)
      if (activeTabIdRef.current === tabId) {
        const sameSession = next.find((tab) => getSessionGroupId(tab) === (nextRoot?.id ?? groupId))
        const fallback = sameSession ?? next[0]
        if (fallback) {
          setActiveTabId(fallback.id)
          setTerminalPage('terminal')
        } else {
          setActiveTabId('')
          setTerminalPage('connections')
        }
      }
      return next
    })
    setTabMenu(null)
  }

  function performCloseOtherTabs(tabId: string): void {
    const closedTabIds: string[] = []
    for (const tab of tabsRef.current) {
      if (tab.id !== tabId) {
        closedTabIds.push(tab.id, ...tab.subTerminals.map((subterminal) => subterminal.id))
        suppressTerminalReconnectRef.current.add(tab.id)
        window.api.terminal.stop(tab.id)
        tab.subTerminals.forEach((subterminal) => {
          suppressTerminalReconnectRef.current.add(subterminal.id)
          window.api.terminal.stop(subterminal.id)
        })
        pendingSshRef.current.delete(tab.id)
      }
    }

    const keepTab = tabsRef.current.find((tab) => tab.id === tabId)
    const remaining = keepTab ? [keepTab] : [createTerminalTab({ title: 'Terminal' })]
    cancelAgentRunsOutsideTabs(remaining)
    rejectApprovalsForClosedTabs(closedTabIds)

    setTabs(() => remaining)
    setActiveTabId(remaining[0]?.id ?? '')
    setTabMenu(null)
  }

  function performCloseAllTabs(): void {
    const closedTabIds: string[] = []
    for (const tab of tabsRef.current) {
      closedTabIds.push(tab.id, ...tab.subTerminals.map((subterminal) => subterminal.id))
      suppressTerminalReconnectRef.current.add(tab.id)
      window.api.terminal.stop(tab.id)
      tab.subTerminals.forEach((subterminal) => {
        suppressTerminalReconnectRef.current.add(subterminal.id)
        window.api.terminal.stop(subterminal.id)
      })
      pendingSshRef.current.delete(tab.id)
    }

    cancelAgentRunsOutsideTabs([])
    rejectApprovalsForClosedTabs(closedTabIds)

    setTabs([])
    setActiveTabId('')
    setTerminalPage('connections')
    setTabMenu(null)
  }

  function requestCloseTabs(mode: CloseTabsConfirmRequest['mode'], tabId: string): void {
    setTabMenu(null)
    if (!closeTerminalConfirmEnabled) {
      if (mode === 'tab') performCloseTab(tabId)
      else if (mode === 'other-tabs') performCloseOtherTabs(tabId)
      else performCloseAllTabs()
      return
    }

    setCloseTabsConfirmRequest({ mode, tabId, dontAskAgain: false })
  }

  function closeTab(tabId: string): void {
    requestCloseTabs('tab', tabId)
  }

  function closeOtherTabs(tabId: string): void {
    requestCloseTabs('other-tabs', tabId)
  }

  function closeAllTabs(tabId: string): void {
    requestCloseTabs('all-tabs', tabId)
  }

  function confirmCloseTabs(): void {
    if (!closeTabsConfirmRequest) return

    const request = closeTabsConfirmRequest
    setCloseTabsConfirmRequest(null)
    if (request.dontAskAgain) setCloseTerminalConfirmEnabled(false)

    if (request.mode === 'tab') performCloseTab(request.tabId)
    else if (request.mode === 'other-tabs') performCloseOtherTabs(request.tabId)
    else performCloseAllTabs()
  }

  async function copyLogEntry(entry: AgentLogEntry): Promise<void> {
    const tabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    await copyText(getSelectedTextWithinLog(entry.id) || entry.text, copyFeedback(t))
    updateTab(tabId, (tab) => ({ ...tab, copiedLogId: entry.id }))
    window.setTimeout(() => {
      updateTab(tabId, (tab) => ({
        ...tab,
        copiedLogId: tab.copiedLogId === entry.id ? null : tab.copiedLogId
      }))
    }, 1200)
  }

  async function copyLogEntryResult(entry: AgentLogEntry): Promise<void> {
    const tabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    await copyText(extractResultMarkdown(entry.text, t) || entry.text, copyFeedback(t))
    updateTab(tabId, (tab) => ({ ...tab, copiedLogId: entry.id }))
    window.setTimeout(() => {
      updateTab(tabId, (tab) => ({
        ...tab,
        copiedLogId: tab.copiedLogId === entry.id ? null : tab.copiedLogId
      }))
    }, 1200)
  }

  function exportLogEntryResultMarkdown(entry: AgentLogEntry): void {
    void downloadMarkdown(
      extractResultMarkdown(entry.text, t) || entry.text,
      buildLogMarkdownFilename(entry, 'result'),
      t
    )
  }

  function exportLogEntryFullMarkdown(entry: AgentLogEntry): void {
    void downloadMarkdown(entry.text, buildLogMarkdownFilename(entry), t)
  }

  async function exportLogEntryTrace(entry: AgentLogEntry): Promise<void> {
    const tabId = activeTabIdRef.current
    const runs = await window.api.storage.listAgentRuns({ tabId, limit: 40 })
    const resultText = extractResultMarkdown(entry.text, t)
    const storedRun =
      runs.find(
        (run) => run.trace && run.output && resultText && run.output.trim() === resultText.trim()
      ) ??
      runs.find(
        (run) =>
          run.trace &&
          Math.abs(Date.parse(run.startedAt ?? '') - Date.parse(entry.createdAt)) < 5 * 60_000
      )

    const trace = buildTraceFromAgentLogEntry({
      entry,
      tabId,
      t,
      storedRun
    })

    await downloadJson(formatTraceExport(trace), buildLogTraceFilename(entry), t)
  }

  async function resolveRunIdForLogEntry(entry: AgentLogEntry): Promise<string | undefined> {
    for (const run of activeAgentRunRef.current.values()) {
      if (run.logId === entry.id && run.runId) return run.runId
    }

    const tabId =
      getSessionChatTab(tabsRef.current, getSessionGroupId(activeTab))?.id ?? activeTabIdRef.current
    const runs = await window.api.storage.listAgentRuns({ tabId, limit: 40 })
    const resultText = extractResultMarkdown(entry.text, t)
    const matched =
      runs.find((run) => run.output && resultText && run.output.trim() === resultText.trim()) ??
      runs.find(
        (run) =>
          Math.abs(Date.parse(run.startedAt ?? '') - Date.parse(entry.createdAt)) < 5 * 60_000
      )
    return matched?.runId
  }

  async function submitOpsFeedbackForEntry(
    entry: AgentLogEntry,
    rating: 'like' | 'dislike'
  ): Promise<void> {
    if (opsFeedbackBusyLogId === entry.id) return

    const existingRating = opsFeedbackByLogId[entry.id]
    if (existingRating) {
      toast.error(t.common.opsFeedbackAlreadyRated)
      return
    }

    const chatTab = getSessionChatTab(tabsRef.current, getSessionGroupId(activeTab)) ?? activeTab
    const connectionId = resolveOpsConnectionId(
      activeTab.connectionId ||
        chatTab.connectionId ||
        getSessionTerminals(tabsRef.current, getSessionGroupId(activeTab)).find(
          (tab) => tab.connectionId
        )?.connectionId
    )

    const runId = await resolveRunIdForLogEntry(entry)
    if (!runId) {
      toast.error(t.common.opsFeedbackFailed)
      return
    }

    setOpsFeedbackBusyLogId(entry.id)
    const savingToast = toast.loading(t.common.opsFeedbackSaving)
    try {
      const result = await window.api.storage.submitOpsFeedback({
        tabId: chatTab.id,
        runId,
        rating,
        connectionId
      })
      toast.dismiss(savingToast)
      if (!result.ok || !result.record) {
        toast.error(result.error || t.common.opsFeedbackFailed)
        return
      }
      setOpsFeedbackByLogId((current) => ({ ...current, [entry.id]: result.record!.rating }))
      toast.success(
        result.record.rating === 'like'
          ? t.common.opsFeedbackSavedLike
          : t.common.opsFeedbackSavedDislike
      )
    } catch (error) {
      toast.dismiss(savingToast)
      notifyOperationError(t.common.opsFeedbackFailed, error)
    } finally {
      setOpsFeedbackBusyLogId(null)
    }
  }

  const skillSheet = (
    <SkillManager
      open={skillOpen}
      onOpenChange={setSkillOpen}
      t={t}
      skillRoot={config.skillRoot}
      skills={skills}
      filteredLocalSkills={filteredLocalSkills}
      localSkillSearchQuery={localSkillSearchQuery}
      skillSearchQuery={skillSearchQuery}
      skillSearchResults={skillSearchResults}
      skillSearchLoading={skillSearchLoading}
      skillDeletingPath={skillDeletingPath}
      copiedSkillCommandId={copiedSkillCommandId}
      skillManageMessage={skillManageMessage}
      selectedSkillPreview={selectedSkillPreview}
      skillPreviewLoadingPath={skillPreviewLoadingPath}
      copiedSkillInstallLogId={copiedSkillInstallLogId}
      skillInstallCancelingIds={skillInstallCancelingIds}
      skillInstallIds={skillInstallIds}
      skillInstallLogs={skillInstallLogs}
      skillInstallLogNames={skillInstallLogNames}
      skillInstallLogStatuses={skillInstallLogStatuses}
      skillInstallLogResultId={skillInstallLogResultId}
      installedSkillNames={installedSkillNames}
      onSkillRootChange={(value) => updateConfig('skillRoot', value)}
      onSaveSkillRoot={() => void saveSkillRoot()}
      onLocalSkillSearchQueryChange={setLocalSkillSearchQuery}
      onSkillSearchQueryChange={setSkillSearchQuery}
      onRefreshSkills={() => void refreshSkills()}
      onSearchSkills={() => void searchSkills()}
      onInstallSkill={(result) => void installSkill(result)}
      onCancelSkillInstall={(resultId) => void cancelSkillInstall(resultId)}
      onCopySkillInstallCommand={(result) => void copySkillInstallCommand(result)}
      onCopySelectedSkillInstallLog={() => void copySelectedSkillInstallLog()}
      onDeleteSkill={(skill) => void deleteSkill(skill)}
      onPreviewSkill={(skill) => void previewSkill(skill)}
      onDeleteSkillInstallLog={deleteSkillInstallLog}
      onSelectedSkillPreviewChange={setSelectedSkillPreview}
      onSkillInstallLogResultIdChange={setSkillInstallLogResultId}
    />
  )

  const mcpSheet = (
    <Sheet
      open={mcpOpen}
      onOpenChange={(open) => {
        setMcpOpen(open)
        if (!open) setMcpEditorOpen(false)
      }}
    >
      <SheetContent
        side="right"
        className={`w-full ${mcpEditorOpen && settingsMcpServer.id ? 'sm:max-w-5xl' : 'sm:max-w-2xl'}`}
      >
        <SheetHeader>
          <SheetTitle>{t.settings.mcpServers}</SheetTitle>
          <SheetDescription>{t.settings.mcpServersHint}</SheetDescription>
        </SheetHeader>
        <div className="app-sheet-split flex min-h-0 flex-1 flex-row-reverse gap-3 overflow-hidden px-4">
          <div className="app-sheet-main min-w-0 flex-1 space-y-4 overflow-auto">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-muted-foreground">
                {t.settings.mcpServerList} · {config.mcpServers.length}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={createMcpServer}>
                <PlusIcon data-icon="inline-start" />
                {t.settings.newMcpServer}
              </Button>
            </div>
            {config.mcpServers.length === 0 ? (
              <div className="rounded-md border bg-muted/10 p-3 text-xs text-muted-foreground">
                <PlugIcon className="mr-2 inline size-3" aria-hidden="true" />
                {t.settings.noMcpServers}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {config.mcpServers.map((server) => {
                  const toolCount = mcpServerToolCounts.get(server.id) ?? 0
                  const status = getMcpServerStatus(server, validation, validating, toolCount, t)

                  return (
                    <div
                      key={server.id}
                      className={`flex min-w-0 cursor-pointer flex-col gap-3 rounded-md border bg-card p-3 text-xs transition hover:bg-muted/30 ${
                        mcpEditorOpen && settingsMcpServerId === server.id
                          ? 'border-primary/70 ring-1 ring-primary/30'
                          : ''
                      }`}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleMcpDetails(server.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          toggleMcpDetails(server.id)
                        }
                      }}
                    >
                      <div className="min-w-0 text-left">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <McpStatusDot status={status.state} title={status.label} />
                              <span className="truncate text-sm font-medium">
                                {server.name || server.id}
                              </span>
                            </div>
                            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                              {server.id}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant={server.enabled ? 'destructive' : 'outline'}
                            size="sm"
                            className="shrink-0"
                            onClick={(event) => {
                              event.stopPropagation()
                              selectSettingsMcpServer(server.id)
                              updateSettingsMcpServerForId(server.id, 'enabled', !server.enabled)
                            }}
                          >
                            {server.enabled ? (
                              <TriangleAlertIcon data-icon="inline-start" />
                            ) : (
                              <CheckIcon data-icon="inline-start" />
                            )}
                            {server.enabled
                              ? t.settings.disableMcpServer
                              : t.settings.enableMcpServer}
                          </Button>
                        </div>
                        <div className="mt-3 line-clamp-2 font-mono text-[11px] text-muted-foreground">
                          {[server.command, ...server.args].filter(Boolean).join(' ') || '-'}
                        </div>
                        <div className="mt-2 text-[11px] text-muted-foreground">
                          {t.settings.mcpToolCount}: {toolCount}
                        </div>
                        <div
                          className={`mt-1 line-clamp-3 text-[11px] ${
                            status.state === 'not-ready'
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                          }`}
                          title={status.label}
                        >
                          {status.label}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {mcpEditorOpen && settingsMcpServer.id ? (
            <div className="app-sheet-detail flex w-[560px] shrink-0 flex-col overflow-hidden rounded-md border bg-background">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {t.settings.mcpServers}: {settingsMcpServer.name || settingsMcpServer.id}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {settingsMcpServer.id}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.common.close}
                  title={t.common.close}
                  onClick={() => setMcpEditorOpen(false)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3">
                <FieldGroup>
                  <label
                    htmlFor="mcp-enabled"
                    className="flex items-start justify-between gap-3 rounded-md border bg-muted/10 p-3"
                  >
                    <span className="space-y-1">
                      <span className="block text-sm font-medium">{t.settings.mcpEnabled}</span>
                      <FieldDescription>{t.settings.mcpEnabledHint}</FieldDescription>
                    </span>
                    <Input
                      id="mcp-enabled"
                      type="checkbox"
                      checked={settingsMcpServer.enabled}
                      onChange={(event) => updateSettingsMcpServer('enabled', event.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <FieldLabel htmlFor="mcp-id">{t.settings.mcpServerId}</FieldLabel>
                      <Input
                        id="mcp-id"
                        value={settingsMcpServer.id}
                        onChange={(event) => updateSettingsMcpServer('id', event.target.value)}
                        placeholder="filesystem"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="mcp-name">{t.settings.mcpServerName}</FieldLabel>
                      <Input
                        id="mcp-name"
                        value={settingsMcpServer.name}
                        onChange={(event) => updateSettingsMcpServer('name', event.target.value)}
                        placeholder={t.settings.mcpServerName}
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="mcp-command">{t.settings.mcpCommand}</FieldLabel>
                    <Input
                      id="mcp-command"
                      value={settingsMcpServer.command}
                      onChange={(event) => updateSettingsMcpServer('command', event.target.value)}
                      placeholder="npx"
                    />
                    <FieldDescription>{t.settings.mcpCommandHint}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mcp-args">{t.settings.mcpArgs}</FieldLabel>
                    <Textarea
                      id="mcp-args"
                      className="min-h-24 resize-y font-mono text-xs"
                      value={mcpArgsText}
                      onChange={(event) => updateSettingsMcpArgs(event.target.value)}
                      placeholder={'-y\n@modelcontextprotocol/server-filesystem\n~/Documents'}
                    />
                    <FieldDescription>{t.settings.mcpArgsHint}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mcp-env">{t.settings.mcpEnv}</FieldLabel>
                    <Textarea
                      id="mcp-env"
                      className="min-h-24 resize-y font-mono text-xs"
                      value={mcpEnvText}
                      onChange={(event) => updateSettingsMcpEnv(event.target.value)}
                      placeholder={'API_KEY=value\nNODE_ENV=production'}
                    />
                    <FieldDescription>{t.settings.mcpEnvHint}</FieldDescription>
                  </Field>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="mcp-tool-allow">
                        {t.settings.mcpToolAllowList}
                      </FieldLabel>
                      <Textarea
                        id="mcp-tool-allow"
                        className="min-h-20 resize-y font-mono text-xs"
                        value={formatToolNameListText(settingsMcpServer.toolAllowList)}
                        onChange={(event) =>
                          updateSettingsMcpServer(
                            'toolAllowList',
                            parseToolNameListText(event.target.value)
                          )
                        }
                        placeholder={t.settings.toolNameListPlaceholder}
                      />
                      <FieldDescription>{t.settings.mcpToolAllowListHint}</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="mcp-tool-deny">{t.settings.mcpToolDenyList}</FieldLabel>
                      <Textarea
                        id="mcp-tool-deny"
                        className="min-h-20 resize-y font-mono text-xs"
                        value={formatToolNameListText(settingsMcpServer.toolDenyList)}
                        onChange={(event) =>
                          updateSettingsMcpServer(
                            'toolDenyList',
                            parseToolNameListText(event.target.value)
                          )
                        }
                        placeholder={t.settings.toolNameListPlaceholder}
                      />
                      <FieldDescription>{t.settings.mcpToolDenyListHint}</FieldDescription>
                    </Field>
                  </div>
                  <Field>
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel>{t.settings.mcpTools}</FieldLabel>
                      <span className="text-xs text-muted-foreground">
                        {settingsMcpTools.length}
                      </span>
                    </div>
                    {settingsMcpTools.length === 0 ? (
                      <div className="rounded-md border bg-muted/10 p-3 text-xs text-muted-foreground">
                        {t.settings.noMcpTools}
                      </div>
                    ) : (
                      <div className="max-h-56 space-y-2 overflow-auto rounded-md border bg-muted/10 p-2">
                        {settingsMcpTools.map((tool) => (
                          <div
                            key={`${tool.method}:${tool.path}:${tool.name}`}
                            className="min-w-0 rounded-md border bg-background p-2 text-xs"
                          >
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <span className="min-w-0 truncate font-medium">{tool.name}</span>
                              <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                                {tool.method.toUpperCase()}
                              </Badge>
                            </div>
                            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                              {tool.path}
                            </div>
                            {tool.description ? (
                              <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                                {tool.description}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </Field>
                </FieldGroup>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2">
                <Button
                  type="button"
                  onClick={async () => {
                    await saveConfig()
                    setMcpEditorOpen(false)
                  }}
                >
                  {saved ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : (
                    <PlugIcon data-icon="inline-start" />
                  )}
                  {saved ? t.settings.saved : t.settings.saveSettings}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <SheetFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => validateConfig()}
            disabled={validating}
          >
            {validating ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <TestTube2Icon data-icon="inline-start" />
            )}
            {validating ? t.settings.validating : t.settings.validateTools}
          </Button>
          <Button onClick={saveConfig}>
            {saved ? <CheckIcon data-icon="inline-start" /> : <PlugIcon data-icon="inline-start" />}
            {saved ? t.settings.saved : t.settings.saveSettings}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )

  const historySheet = (
    <HistoryPanel
      open={historyOpen}
      onOpenChange={setHistorySheetOpen}
      t={t}
      loading={historyLoading}
      items={historyItems}
      titleEditingId={historyTitleEditingId}
      titleDraft={historyTitleDraft}
      titleSavingId={historyTitleSavingId}
      savingWikiTabId={savingHistoryWikiTabId}
      onTitleDraftChange={setHistoryTitleDraft}
      onRefresh={() => void refreshSessionHistory()}
      onOpenSession={(item) => void openHistorySession(item)}
      onStartRename={startRenameHistorySession}
      onCancelRename={cancelRenameHistorySession}
      onSaveTitle={(item) => void saveHistorySessionTitle(item)}
      onSaveToWiki={(item) => void saveHistorySessionToWiki(item)}
      onDeleteSession={(item) => void deleteHistorySession(item)}
    />
  )

  const wikiSheet = (
    <WikiSheet
      open={wikiOpen}
      onOpenChange={setWikiSheetOpen}
      t={t}
      wikiLoading={wikiLoading}
      wikiDocumentLoadingId={wikiDocumentLoadingId}
      wikiDocuments={wikiDocuments}
      filteredWikiDocuments={filteredWikiDocuments}
      selectedWikiDocument={selectedWikiDocument}
      wikiSearchQuery={wikiSearchQuery}
      wikiEditing={wikiEditing}
      wikiEditContent={wikiEditContent}
      wikiSaving={wikiSaving}
      wikiDeletingId={wikiDeletingId}
      wikiMessage={wikiMessage}
      wikiPreviewWidth={wikiPreviewWidth}
      onRefresh={() => void refreshWikiDocuments()}
      onSearchQueryChange={setWikiSearchQuery}
      onOpenDocument={(document) => void openWikiDocument(document)}
      onStartEdit={() => {
        if (!selectedWikiDocument) return
        setWikiEditContent(selectedWikiDocument.content)
        setWikiEditing(true)
      }}
      onCancelEdit={() => {
        if (!selectedWikiDocument) return
        setWikiEditing(false)
        setWikiEditContent(selectedWikiDocument.content)
      }}
      onSaveEdits={() => void saveWikiEdits()}
      onDeleteDocument={() => void deleteWikiDocument()}
      onEditContentChange={setWikiEditContent}
      onStartResize={(startX, startWidth) => {
        wikiSheetResizeRef.current = { startX, startWidth }
      }}
    />
  )

  return (
    <main className="app-shell flex h-full flex-col bg-background">
      <Toaster richColors closeButton position="top-right" />
      <header className="app-titlebar flex h-16 shrink-0 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-3">
          <ProductLogo />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Crescent</span>
              <Badge
                variant="outline"
                className="hidden rounded-md font-mono text-[10px] sm:inline-flex"
              >
                {activeTab.terminalMode.toUpperCase()}
              </Badge>
            </div>
            <div className="mt-0.5 hidden max-w-[40vw] truncate text-[11px] text-muted-foreground md:block">
              {getTerminalDisplayTitle(activeTab, tabs)} ·{' '}
              {activeTab.terminalCwd || t.app.shellStarting}
            </div>
          </div>
        </div>
        <div className="app-commandbar flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t.connections.manageConnections}
            title={t.connections.manageConnections}
            onClick={showConnectionList}
          >
            <ServerIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t.settings.mcpServers}
            title={t.settings.mcpServers}
            onClick={() => setMcpOpen(true)}
          >
            <PlugIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t.settings.skillsManagement}
            title={t.settings.skillsManagement}
            onClick={() => setSkillOpen(true)}
          >
            <BotIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t.history.title}
            title={t.history.title}
            onClick={() => setHistorySheetOpen(true)}
          >
            <HistoryIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t.wiki.title}
            title={t.wiki.title}
            onClick={() => setWikiSheetOpen(true)}
          >
            <BookOpenIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t.app.swapPanes}
            title={t.app.swapPanes}
            onClick={() =>
              setPaneOrder((current) =>
                current === 'terminal-chat' ? 'chat-terminal' : 'terminal-chat'
              )
            }
          >
            <ArrowLeftRightIcon aria-hidden="true" />
          </Button>
          <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
            <SelectTrigger
              size="sm"
              className="h-8 w-auto min-w-28 justify-start px-2"
              aria-label={t.app.language}
              title={t.app.language}
            >
              <LanguagesIcon aria-hidden="true" />
              <SelectValue aria-label={t.app.language} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>{t.app.language}</SelectLabel>
                {localeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <SettingsSheet
            open={sheetOpen}
            onOpenChange={(open) => {
              setSheetOpen(open)
              if (!open) {
                setProviderEditorOpen(false)
                setOpenApiEditorOpen(false)
                setInstructionEditorOpen(false)
              }
            }}
            t={t}
            config={config}
            settingsProvider={settingsProvider}
            settingsProviderId={settingsProviderId}
            modelOptions={modelOptions}
            providerModelsText={providerModelsText}
            commandWhitelistText={commandWhitelistText}
            instructionFiles={instructionFiles}
            selectedInstructionName={selectedInstructionName}
            selectedInstructionFile={selectedInstructionFile}
            instructionContent={instructionContent}
            instructionSaved={instructionSaved}
            providerEditorOpen={providerEditorOpen}
            openApiEditorOpen={openApiEditorOpen}
            settingsOpenApiProfile={
              (config.openApiProfiles ?? []).find(
                (profile) => profile.id === config.openApiProfileId
              ) ?? (config.openApiProfiles ?? [])[0]
            }
            instructionEditorOpen={instructionEditorOpen}
            validation={validation}
            validating={validating}
            saved={saved}
            importingOpenApi={importingOpenApi}
            closeTerminalConfirmEnabled={closeTerminalConfirmEnabled}
            onCreateProvider={createProvider}
            onToggleProviderDetails={toggleProviderDetails}
            onDeleteProvider={deleteSettingsProvider}
            onApplyDefaultModel={applyDefaultModel}
            onCloseTerminalConfirmChange={setCloseTerminalConfirmEnabled}
            onWorkspaceCwdChange={(value) =>
              updateConfig('workspaceCwd', value.trim() || undefined)
            }
            onMaxActiveToolsChange={(value) => updateConfig('maxActiveTools', value)}
            onCommandWhitelistChange={(text) => {
              setCommandWhitelistText(text)
              updateConfig('commandWhitelist', parseCommandWhitelist(text))
            }}
            onCreateOpenApiProfile={createOpenApiProfile}
            onToggleOpenApiProfileDetails={toggleOpenApiProfileDetails}
            onDeleteOpenApiProfile={deleteOpenApiProfile}
            onOpenApiEditorOpenChange={setOpenApiEditorOpen}
            onPatchActiveOpenApiProfile={patchActiveOpenApiProfile}
            onImportOpenApiDocument={importOpenApiDocument}
            onToggleInstructionDetails={toggleInstructionDetails}
            onProviderEditorOpenChange={setProviderEditorOpen}
            onUpdateSettingsProvider={updateSettingsProvider}
            onUpdateSettingsProviderModels={updateSettingsProviderModels}
            onSaveProviderEditor={async () => {
              await saveConfig()
              setProviderEditorOpen(false)
            }}
            onSaveOpenApiEditor={async () => {
              await saveConfig()
              setOpenApiEditorOpen(false)
            }}
            onInstructionEditorOpenChange={setInstructionEditorOpen}
            onInstructionContentChange={(value) => {
              setInstructionContent(value)
              setInstructionSaved(false)
            }}
            onSaveInstructionFile={saveInstructionFile}
            onValidateConfig={validateConfig}
            onSaveConfig={saveConfig}
          />
        </div>
      </header>
      {skillSheet}
      {mcpSheet}
      {historySheet}
      {wikiSheet}
      <section
        className={`app-frame flex min-h-0 flex-1 ${terminalPaneFirst ? 'flex-row' : 'flex-row-reverse'}`}
      >
        {hiddenPane !== 'terminal' && (
          <TerminalPane
            widthPercent={terminalPanePercent}
            fillWidth={hiddenPane === 'chat'}
            terminalTabs={terminalTabs}
            labelTabs={tabs}
            terminalPage={terminalPage}
            activeTabId={activeTabId}
            executionTerminalId={executionTerminalByChatId[sessionChatTab.id]}
            agentPending={activeAgentPending}
            activeTab={activeTab}
            tabMenu={tabMenu}
            displayConnections={displayConnections}
            filteredDisplayConnections={filteredDisplayConnections}
            connectionSearchQuery={connectionSearchQuery}
            terminalHostRef={terminalHostRef}
            subterminalCollapsed={subterminalCollapsed}
            subterminalPanelHeight={subterminalPanelHeight}
            subterminalResizeRef={subterminalResizeRef}
            subterminalHeightResizeRef={subterminalHeightResizeRef}
            connectionRecovery={connectionRecovery}
            t={t}
            formatConnectionTarget={formatConnectionTarget}
            onNewConnection={openNewConnectionForm}
            onSelectTab={(tabId) => {
              activeTabIdRef.current = tabId
              setActiveTabId(tabId)
              setTerminalPage('terminal')
            }}
            onOpenTabMenu={setTabMenu}
            onCloseTab={closeTab}
            onCloseOtherTabs={closeOtherTabs}
            onCloseAllTabs={closeAllTabs}
            onConnectionQueryChange={setConnectionSearchQuery}
            onShowConnectionList={showConnectionList}
            onConnect={connectFromConnectionManager}
            onSubterminalCollapsedChange={setSubterminalCollapsed}
            onCloseSubterminal={closeSubterminal}
            onCloseAllSubterminals={closeAllSubterminals}
            onOpenLocalSubterminal={() => void openLocalSubterminal()}
            onRetryConnection={() => void retryActiveConnection()}
          />
        )}
        {!hiddenPane && (
          <div
            className="app-pane-resizer w-2 shrink-0 cursor-col-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize terminal and chat panes"
            onPointerDown={(event) => {
              event.preventDefault()
              splitDragRef.current = true
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
            }}
          />
        )}
        {hiddenPane !== 'chat' && (
          <AgentPanel
            sessionChatTab={sessionChatTab}
            sessionChatTabs={sessionChatTabs}
            sessionTerminals={sessionTerminals}
            activeTab={activeTab}
            tabs={tabs}
            agentLogRef={agentLogRef}
            agentInputRef={agentInputRef}
            slashCommandListRef={slashCommandListRef}
            slashMenuVisible={slashMenuVisible}
            slashCommandOptions={slashCommandOptions}
            selectedSlashCommandIndex={selectedSlashCommandIndex}
            terminalPaneFirst={terminalPaneFirst}
            terminalHidden={hiddenPane === 'terminal'}
            activeModel={activeModel}
            activeModelSelectionValue={activeModelSelectionValue}
            activeTabModelId={activeTabModelId}
            visibleModels={visibleModels}
            aiState={aiState}
            aiStatusText={aiStatusText}
            modelValidationError={modelValidationError}
            configured={configured}
            activeAgentPending={activeAgentPending}
            executionTerminalId={executionTerminalByChatId[sessionChatTab.id]}
            pinnedWorkflows={(resolveActiveOpenApiProfile(config)?.pinnedWorkflows ?? []).filter(
              (workflow) => workflow.pinned !== false
            )}
            connectionRecovery={connectionRecovery}
            t={t}
            onCopyEntry={(entry) => void copyLogEntry(entry)}
            onCopyResult={(entry) => void copyLogEntryResult(entry)}
            onExportResult={(entry) => void exportLogEntryResultMarkdown(entry)}
            onExportFull={(entry) => void exportLogEntryFullMarkdown(entry)}
            onExportTrace={(entry) => void exportLogEntryTrace(entry)}
            onOpsFeedback={(entry, rating) => void submitOpsFeedbackForEntry(entry, rating)}
            feedbackByLogId={opsFeedbackByLogId}
            feedbackBusyLogId={opsFeedbackBusyLogId}
            liveRunByLogId={liveRunByLogId}
            onResolveApproval={resolveInlineCommandApproval}
            onAddCommandToWhitelist={(command) => void addCommandToWhitelist(command)}
            onInjectSuggestions={(texts) => {
              const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
              const block = formatSuggestionsForInput(texts)
              if (!block) return
              updateTab(chatTabId, (current) => ({
                ...current,
                agentInput: current.agentInput.trim()
                  ? `${current.agentInput.trim()}\n${block}`
                  : block
              }))
              queueMicrotask(() => {
                agentInputRef.current?.focus()
                const el = agentInputRef.current
                if (el) {
                  const end = el.value.length
                  el.setSelectionRange(end, end)
                }
              })
            }}
            onClarifyConfirm={(label) => {
              const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
              const trimmed = label.trim()
              if (!trimmed) return
              updateTab(chatTabId, (current) => ({
                ...current,
                agentInput: current.agentInput.trim()
                  ? `${current.agentInput.trim()}\n${trimmed}`
                  : trimmed
              }))
              queueMicrotask(() => {
                agentInputRef.current?.focus()
                const el = agentInputRef.current
                if (el) {
                  const end = el.value.length
                  el.setSelectionRange(end, end)
                }
              })
            }}
            onClarifyDismiss={() => {
              const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
              updateTab(chatTabId, (current) => ({
                ...current,
                pendingClarification: undefined
              }))
            }}
            passwordPromptRequest={passwordPromptRequest}
            passwordPromptValue={passwordPromptValue}
            passwordPromptError={passwordPromptError}
            passwordPromptInputRef={passwordPromptInputRef}
            onPasswordPromptChange={setPasswordPromptValue}
            onPasswordPromptCancel={cancelPasswordPrompt}
            onPasswordPromptSubmit={submitPasswordPrompt}
            onToggleTerminalPane={() => {
              setHiddenPane((current) => (current === 'terminal' ? null : 'terminal'))
            }}
            onSelectSession={(groupId) => {
              const focusTab =
                getSessionTerminals(tabsRef.current, groupId).find(
                  (tab) => tab.id === activeTabIdRef.current
                ) ??
                getSessionChatTab(tabsRef.current, groupId) ??
                tabsRef.current.find((tab) => getSessionGroupId(tab) === groupId)
              if (focusTab) selectSessionTab(focusTab.id)
            }}
            onSelectTerminal={(tabId) => selectSessionTab(tabId)}
            onModelChange={applyConversationModel}
            onSubmit={(event) => void submitAgent(event)}
            onInsertSlashCommand={insertSlashCommand}
            onInsertPinnedWorkflow={(workflow) => {
              updateTab(sessionChatTab.id, (tab) => ({
                ...tab,
                agentInput: tab.agentInput.trim()
                  ? `${tab.agentInput.trim()}\n${workflow.prompt}`
                  : workflow.prompt
              }))
            }}
            onAgentInputChange={(value) => {
              setSlashCommandOpen(true)
              setSlashCommandIndex(0)
              updateTab(sessionChatTab.id, (tab) => ({
                ...tab,
                agentInput: value
              }))
            }}
            onAgentInputKeyDown={handleAgentInputKeyDown}
            onAgentInputPaste={(event) => void handleAgentInputPaste(event)}
            onRemoveSkill={removeSkillRef}
            onRemovePath={removePathRef}
            onRemoveTool={removeToolRef}
            onRemoveWiki={removeWikiRef}
            onPickPathReference={(kind) => void pickPathReference(kind)}
            onToggleVoiceInput={() => void toggleVoiceInput()}
            voiceInputState={voiceInputState}
            voiceInputSupported={voiceInputSupported}
            voiceInputSupportChecking={voiceInputSupportChecking && !voiceBrowserSpeechAvailable}
            voiceWhisperSupported={voiceWhisperSupported}
            onStopAgent={() => stopAgentRun()}
            onRetryConnection={() => void retryActiveConnection()}
            onOpenConnections={showConnectionList}
          />
        )}
      </section>
      <ConnectionManagerModal
        open={connectionModalOpen}
        connections={displayConnections}
        filteredConnections={filteredDisplayConnections}
        query={connectionSearchQuery}
        selectedConnectionId={selectedConnectionId}
        connectionForm={connectionForm}
        connectionEditing={connectionEditing}
        connectionImportText={connectionImportText}
        connectionSshOptionsText={connectionSshOptionsText}
        connectionActionsText={connectionActionsText}
        connectionCommandPreview={connectionCommandPreview}
        connectionFormReady={connectionFormReady}
        connectionSaveMessage={connectionSaveMessage}
        t={t}
        formatConnectionTarget={formatConnectionTarget}
        onClose={() => setConnectionModalOpen(false)}
        onQueryChange={setConnectionSearchQuery}
        onSelectConnection={selectConnection}
        onConnect={connectFromConnectionManager}
        onConnectInSession={(connection) => {
          openConnectionInCurrentSession(connection)
          setConnectionModalOpen(false)
        }}
        onConnectInSubterminal={(connection) => {
          void openConnectionInSubterminal(connection)
          setConnectionModalOpen(false)
        }}
        onCopyConnection={(connection) => void copyConnection(connection)}
        onDuplicateConnection={duplicateConnection}
        onEditConnection={editConnection}
        onDeleteConnection={(id) => void deleteConnection(id)}
        onImportTextChange={setConnectionImportText}
        onImportConnection={importConnectionFromText}
        onFormChange={updateConnectionForm}
        onSshOptionsTextChange={setConnectionSshOptionsText}
        onActionsTextChange={setConnectionActionsText}
        onResetForm={resetConnectionForm}
        onStartEditing={() => setConnectionEditing(true)}
        onSave={(connectAfterSave) => void saveConnection(connectAfterSave)}
      />
      <CloseTabsConfirmModal
        request={closeTabsConfirmRequest}
        t={t}
        onCancel={() => setCloseTabsConfirmRequest(null)}
        onConfirm={confirmCloseTabs}
        onDontAskAgainChange={(checked) =>
          setCloseTabsConfirmRequest((current) =>
            current ? { ...current, dontAskAgain: checked } : current
          )
        }
      />
      <OnboardingModal
        open={onboardingOpen}
        t={t}
        onDismiss={closeOnboarding}
        onOpenSettings={() => {
          closeOnboarding()
          setSheetOpen(true)
        }}
        onOpenConnections={() => {
          closeOnboarding()
          showConnectionList()
        }}
        onOpenSkills={() => {
          closeOnboarding()
          setSkillOpen(true)
        }}
        onAddExampleOpenApi={addExampleOpenApiFromOnboarding}
      />
      <AppFooter shellState={shellState} activeTab={activeTab} agentMode={config.agentMode} t={t} />
    </main>
  )
}

function isApprovalTargetAlive(tabId: string | undefined, tabs: AgentTerminalTab[]): boolean {
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

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}

function isComposingInput(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  const reactEvent = event as KeyboardEvent<HTMLTextAreaElement> & { isComposing?: boolean }
  const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent & {
    isComposing?: boolean
    keyCode?: number
  }

  return Boolean(reactEvent.isComposing || nativeEvent.isComposing || nativeEvent.keyCode === 229)
}

async function resolvePastedFileReference(file: File): Promise<AgentPathReference | undefined> {
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

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return window.btoa(binary)
}

function defaultPastedFileName(mimeType: string): string {
  if (mimeType === 'image/png') return 'pasted-image.png'
  if (mimeType === 'image/jpeg') return 'pasted-image.jpg'
  if (mimeType === 'image/gif') return 'pasted-image.gif'
  if (mimeType === 'image/webp') return 'pasted-image.webp'
  return 'pasted-file'
}

async function runConnectionCommandSequence(
  commands: string[],
  tabId: string,
  appendLog: (entry: Omit<AgentLogEntry, 'id' | 'createdAt'>, tabId?: string) => void,
  t: Dictionary,
  logTabId = tabId
): Promise<boolean> {
  const [sshCommand, ...loginActions] = commands
  if (!sshCommand) return true

  const firstActionReady = loginActions.length ? waitForTerminalActionPrompt(tabId) : undefined
  window.api.terminal.pasteCommand(sshCommand, true, tabId)

  if (loginActions.length === 0) return true

  for (let index = 0; index < loginActions.length; index += 1) {
    const action = loginActions[index]
    const ready =
      index === 0
        ? await firstActionReady
        : await waitForTerminalIdle(tabId, { ignoredEcho: loginActions[index - 1] })
    if (!ready) {
      appendLog(
        {
          kind: 'error',
          text: `${t.terminal.outputSettleTimeout} (${index + 1})`
        },
        logTabId
      )
      return false
    }

    sendTerminalInput(action, tabId)
    appendLog(
      {
        kind: 'command',
        text: formatConnectionActionLog(action, index + 1, t)
      },
      logTabId
    )
  }

  return true
}

async function runConnectionLoginActionSequence(
  loginActions: string[],
  tabId: string,
  appendLog: (entry: Omit<AgentLogEntry, 'id' | 'createdAt'>, tabId?: string) => void,
  t: Dictionary,
  logTabId = tabId
): Promise<boolean> {
  if (loginActions.length === 0) return true

  const firstActionReady = waitForTerminalActionPrompt(tabId)
  for (let index = 0; index < loginActions.length; index += 1) {
    const action = loginActions[index]
    const ready =
      index === 0
        ? await firstActionReady
        : await waitForTerminalIdle(tabId, { ignoredEcho: loginActions[index - 1] })
    if (!ready) {
      appendLog(
        {
          kind: 'error',
          text: `${t.terminal.outputSettleTimeout} (${index + 1})`
        },
        logTabId
      )
      return false
    }

    sendTerminalInput(action, tabId)
    appendLog(
      {
        kind: 'command',
        text: formatConnectionActionLog(action, index + 1, t)
      },
      logTabId
    )
  }

  return true
}

function waitForTerminalIdle(
  tabId: string,
  options: { ignoredEcho?: string; idleMs?: number; timeoutMs?: number } = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    const idleMs = options.idleMs ?? 1200
    const timeoutMs = options.timeoutMs ?? 30_000
    let receivedData = false
    let settled = false
    let idleTimer: number | undefined
    let observedOutput = ''
    const timeout = window.setTimeout(() => settle(false), timeoutMs)

    const unsubscribe = window.api.terminal.onData((event) => {
      if (event.tabId !== tabId) return

      observedOutput = `${observedOutput}${event.data}`.slice(-8000)
      if (options.ignoredEcho && !hasOutputBeyondEcho(observedOutput, options.ignoredEcho)) {
        return
      }

      receivedData = true
      if (idleTimer) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => settle(true), idleMs)
    })

    function settle(value: boolean): void {
      if (settled) return

      settled = true
      window.clearTimeout(timeout)
      if (idleTimer) window.clearTimeout(idleTimer)
      unsubscribe()
      resolve(value && receivedData)
    }
  })
}

async function waitForTerminalReadyForAgent(tabId: string): Promise<boolean> {
  const deadline = Date.now() + 15_000

  while (Date.now() < deadline) {
    const context = await window.api.terminal.getContext(tabId)
    const output = context.output.slice(-8000)
    if (!hasInteractivePrompt(output)) return true

    await sleep(500)
  }

  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function waitForTerminalActionPrompt(tabId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timeoutMs = 60_000
    let settled = false
    let observedOutput = ''
    const timeout = window.setTimeout(() => settle(false), timeoutMs)

    const unsubscribe = window.api.terminal.onData((event) => {
      if (event.tabId !== tabId) return

      observedOutput = `${observedOutput}${event.data}`.slice(-8000)
      if (!hasInteractivePrompt(observedOutput)) return

      settle(true)
    })

    function settle(value: boolean): void {
      if (settled) return

      settled = true
      window.clearTimeout(timeout)
      unsubscribe()
      resolve(value)
    }
  })
}

function sendTerminalInput(value: string, tabId: string): void {
  window.api.terminal.write(`${value}\r`, tabId)
}

function getSelectedTextWithinLog(logId: number): string {
  const selection = window.getSelection()
  const selectedText = selection?.toString().trim()
  if (!selection || !selectedText) return ''

  const container = document.querySelector(`[data-agent-log-entry="${logId}"]`)
  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode
  if (!container || (!container.contains(anchorNode) && !container.contains(focusNode))) return ''

  return selectedText
}

function buildLogMarkdownFilename(entry: AgentLogEntry, scope?: 'result'): string {
  const timestamp = entry.createdAt.replace(/[:.]/g, '-').replace(/T/, '_').replace(/Z$/, '')
  return `crescent-${entry.kind}${scope ? `-${scope}` : ''}-${timestamp}.md`
}

function buildLogTraceFilename(entry: AgentLogEntry): string {
  const timestamp = entry.createdAt.replace(/[:.]/g, '-').replace(/T/, '_').replace(/Z$/, '')
  return `crescent-agent-trace-${timestamp}.json`
}

function extensionForAudioMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('wav')) return '.wav'
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return '.mp3'
  if (normalized.includes('mp4') || normalized.includes('m4a')) return '.m4a'
  if (normalized.includes('ogg')) return '.ogg'
  return '.webm'
}

export default App
