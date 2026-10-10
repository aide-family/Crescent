import {
  agentClient,
  appClient,
  connectionsClient,
  storageClient,
  terminalClient,
  updateClient,
  whaleMonitorClient
} from '@renderer/clients'
import { ChangePlanReview } from '@renderer/components/ChangePlanReview'
import { useAgentController } from '@renderer/hooks/useAgentController'
import { useCaptureController } from '@renderer/hooks/useCaptureController'
import { useHistoryController } from '@renderer/hooks/useHistoryController'
import { useOpsFeedback } from '@renderer/hooks/useOpsFeedback'
import { usePasswordPrompt } from '@renderer/hooks/usePasswordPrompt'
import { useProviderController } from '@renderer/hooks/useProviderController'
import { useSessionPersistence } from '@renderer/hooks/useSessionPersistence'
import { useSkillsController } from '@renderer/hooks/useSkillsController'
import { useWikiController } from '@renderer/hooks/useWikiController'
import { useWorkbenchLayout } from '@renderer/hooks/useWorkbenchLayout'
import {
  CONNECTION_LOGIN_TOTAL_TIMEOUT_MS,
  CONNECTION_SPAWN_TIMEOUT_MS,
  PostConnectionTask,
  ReuseAgentRun,
  buildLogMarkdownFilename,
  buildLogTraceFilename,
  buildSessionTraceFilename,
  emptyConfig,
  emptyLocalTab,
  emptyMcpServer,
  emptyProvider,
  getSelectedTextWithinLog,
  initialTerminalTab,
  isApprovalTargetAlive,
  isComposingInput,
  resolvePastedFileReference,
  resolveSubterminalTabState,
  settleAgentCancel,
  settleStopText,
  sleep,
  waitForPromptHostOrTimeout,
  waitForTerminalReadyForAgent
} from '@renderer/lib/app-controller-support'
import {
  connTrace,
  runConnectionCommandSequence,
  runConnectionLoginActionSequence
} from '@renderer/lib/connection-login-runtime'
import { deferAfterFirstPaint } from '@renderer/lib/defer-after-paint'
import { TOAST_INTERVENTION_DURATION_MS } from '@renderer/lib/toast-policy'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import {
  ArrowLeftRightIcon,
  BookOpenIcon,
  BotIcon,
  HistoryIcon,
  LanguagesIcon,
  MessageSquareIcon,
  PlugIcon,
  ServerIcon,
  SettingsIcon
} from 'lucide-react'
import {
  KeyboardEvent,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent
} from 'react'
import { flushSync } from 'react-dom'
import { Toaster, toast } from 'sonner'
import { normalizeExecutionMode } from '../../shared/execution-plan'

import { AgentPanel } from '@renderer/components/AgentPanel'
import { CloseTabsConfirmModal, type CloseTabsConfirmRequest } from '@renderer/components/AppModals'
import { CaptureDraftDialog } from '@renderer/components/CaptureDraftDialog'
import { type ComposerInputHandle } from '@renderer/components/ComposerEditor'
import { ConnectionManagerModal } from '@renderer/components/ConnectionManagerModal'
import { HandoffDialog } from '@renderer/components/HandoffDialog'
import { OnboardingModal } from '@renderer/components/OnboardingModal'
import { ProductLogo } from '@renderer/components/ProductLogo'
import { type SkillManageMessage } from '@renderer/components/StatusIndicators'
import { TerminalPane } from '@renderer/components/TerminalPane'
import { ThemeSwitcher } from '@renderer/components/ThemeSwitcher'
import { Button } from '@renderer/components/ui/button'
import { WhalePetPortrait } from '@renderer/components/WhalePetPortrait'
import { useAgentRuns } from '@renderer/hooks/useAgentRuns'
import {
  connectionToForm,
  createEmptyConnectionForm,
  formatConnectionSaveError,
  normalizeConnectionInputForSave,
  useConnections
} from '@renderer/hooks/useConnections'
import { useHandoff } from '@renderer/hooks/useHandoff'
import { useScrollFollow } from '@renderer/hooks/useScrollFollow'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTerminalOutputRing } from '@renderer/hooks/useTerminalOutputRing'
import { useTerminalSessions } from '@renderer/hooks/useTerminalSessions'
import {
  planCloseTabPromotion,
  reassignSessionRootOnClose,
  useTerminalTabs
} from '@renderer/hooks/useTerminalTabs'
import { useXtermLifecycle } from '@renderer/hooks/useXtermLifecycle'
import {
  dictionaries,
  localeOptions,
  nextLocale,
  resolveInitialLocale,
  type Locale
} from '@renderer/i18n'
import {
  buildAvailableToolRefs,
  flattenProviderModels,
  formatProviderModels,
  parseCommandWhitelist
} from '@renderer/lib/agent-config'
import { localizeAgentEventMessage } from '@renderer/lib/agent-event-formatters'
import {
  addUniquePathRef,
  addUniqueSkillRef,
  addUniqueToolRef,
  addUniqueWikiRef,
  buildPostLoginAgentInput
} from '@renderer/lib/agent-input'
import {
  AGENT_LOG_SOFT_LIMIT,
  appendElapsedFooter,
  connectionFailureMarkers,
  hydrateStoredAgentLog,
  isConnectionFailureLog,
  trimAgentLogEntries
} from '@renderer/lib/agent-log'
import { decodeUserMessageText } from '@renderer/lib/agent-message-refs'
import { buildFinishPersistText, closeStreamingOpenSteps } from '@renderer/lib/agent-run-document'
import {
  extractResultMarkdown,
  resolveFullAgentResultMarkdown
} from '@renderer/lib/agent-run-markdown'
import {
  buildTraceFromAgentLogEntry,
  buildTraceFromAgentRunView,
  formatTraceExport
} from '@renderer/lib/agent-run-trace-export'
import {
  WIKI_MIN_PREVIEW_WIDTH,
  WIKI_SHEET_SELECTED_FIXED_WIDTH,
  buildModelSelectionValue,
  isLocalConnection,
  parseModelSelectionValue,
  resolveOpsConnectionId
} from '@renderer/lib/app-runtime'
import {
  PANE_ORDER_STORAGE_KEY,
  formatPipePrompt,
  hasConfiguredModelSelection,
  revealChatFromTerminalLayout,
  type WorkbenchLayout
} from '@renderer/lib/app-shell'
import {
  captureReadyLogsForTab,
  findCaptureJob,
  hiddenCaptureReadyLogIds,
  visibleCaptureDraftPins
} from '@renderer/lib/capture-draft-ui'
import { suggestWhitelistRule } from '@renderer/lib/command-whitelist'
import {
  caretAfterProgrammaticValueChange,
  collectComposerRefIds,
  formatComposerRefToken,
  insertComposerRefTokenAt,
  removeComposerRefToken,
  stripComposerRefTokens
} from '@renderer/lib/composer-ref-tokens'
import {
  buildConnectionCommands,
  createCustomConnectionId,
  hasLiveTerminalSession,
  isPasswordEnvVarMissing,
  mergeConnectionInput,
  resolveRemainingConnectionCommands,
  shouldSkipReuseRelogin,
  stripStoredPassword,
  toConnectionClipboardPayload
} from '@renderer/lib/connection-commands'
import {
  ConnectionLoginQueue,
  ConnectionLoginQueueTimeout,
  clusterLoginQueueKey
} from '@renderer/lib/connection-login-queue'
import {
  applyConnectionNameOverwrite,
  findCustomConnectionNameConflict
} from '@renderer/lib/connection-name-conflict'
import { settleRunningToolStepsAsInterrupted } from '@renderer/lib/settle-interrupted-tool-steps'
import { findRunningPtyCommandTabId, isTerminalPaneLocked } from '@renderer/lib/terminal-lock'
import { isAgentProviderEnabled } from '../../shared/agent-providers'
import {
  appendRunStatusStep,
  classifyPipeCommand,
  recordRecoveryAttempt,
  resolveRunStopReason,
  shouldAttemptRecovery,
  type RunStopReason
} from '../../shared/connection-state'
import { findNewestPromptSignal, isPromptHostAligned } from '../../shared/terminal-prompt-host'
const SettingsSheet = lazy(() =>
  import('@renderer/components/SettingsSheet').then((module) => ({ default: module.SettingsSheet }))
)
const McpServersSheet = lazy(() =>
  import('@renderer/components/McpServersSheet').then((module) => ({
    default: module.McpServersSheet
  }))
)
const HistoryPanel = lazy(() =>
  import('@renderer/components/HistoryPanel').then((module) => ({ default: module.HistoryPanel }))
)
const SkillManager = lazy(() =>
  import('@renderer/components/SkillManager').then((module) => ({ default: module.SkillManager }))
)
const WikiSheet = lazy(() =>
  import('@renderer/components/WikiSheet').then((module) => ({ default: module.WikiSheet }))
)
const WhaleMonitor = lazy(() =>
  import('@renderer/components/WhaleMonitor').then((module) => ({ default: module.WhaleMonitor }))
)

import { mergePostLoginSupplements, resolveLoginContinuation } from '@renderer/lib/busy-supplement'
import { isComposerNewlineEnter, isComposerSubmitEnter } from '@renderer/lib/composer-newline'
import {
  beginConnectionRetry,
  canAttemptConnection,
  createIdleConnectionAttempt,
  markConnectionFailed,
  markConnectionReady,
  shouldAppendSwitchedEntry,
  type ConnectionAttemptState
} from '@renderer/lib/connection-attempt'
import {
  formatConnectionAutomationFailure,
  shouldDrainPostConnectionTasks
} from '@renderer/lib/connection-automation-policy'
import {
  formatSuggestionsForInput,
  resolveConnectionClarifyConfirm,
  type ConnectionClarifyConfirmPayload
} from '@renderer/lib/connection-route'
import { formatConnectionTarget } from '@renderer/lib/connections'
import { dismissOnboarding, shouldShowOnboarding } from '@renderer/lib/onboarding'
import {
  copyFeedback,
  copyText,
  downloadJson,
  downloadMarkdown,
  notifyOperationError
} from '@renderer/lib/operation-feedback'
import { createPendingAttentionNotifier } from '@renderer/lib/pending-attention-notify'
import { applyTerminalConvertEol, fitAndSyncPty } from '@renderer/lib/pipe-terminal'
import { isIpv4Literal } from '@renderer/lib/prompt-host-wait'
import {
  buildConnectionSlashCommand,
  buildMcpSlashCommand,
  buildSkillSlashCommand,
  buildSlashCommandOptions,
  buildStyleSlashCommands,
  buildToolSlashCommand,
  buildWikiSlashCommand,
  getSlashCommandQuery,
  isConnectionSlashQuery,
  isMcpSlashQuery,
  isStyleSlashQuery,
  isToolSlashQuery,
  isWikiSlashQuery,
  matchesConnectionSlashCommand,
  matchesMcpSlashCommand,
  matchesSkillSlashCommand,
  matchesSlashCommand,
  matchesStyleSlashCommand,
  matchesToolSlashCommand,
  matchesWikiSlashCommand,
  replaceSlashCommandInput,
  type SlashCommandOption
} from '@renderer/lib/slash-commands'
import {
  createTerminalTab,
  getNextTerminalTitle,
  getSessionChatTab,
  getSessionDisplayTitle,
  getSessionGroupId,
  getSessionTerminals,
  isReservedTerminalTabId,
  resolveConnectTargetTab,
  resolveSessionAgentStyle,
  resolveSessionChatTabId,
  toStoredSessionTabs,
  type AgentLogEntry,
  type AgentRunStep,
  type AgentRunViewState,
  type AgentTerminalTab,
  type AgentToolReference
} from '@renderer/lib/terminal-tabs'
import { runWithTimeout } from '@renderer/lib/with-timeout'
import {
  buildAgentSessionTrace,
  serializeAgentSessionTrace
} from '../../shared/agent-session-trace'
import {
  normalizeAgentStyle,
  resolveShowAgentThinking,
  type AgentStyle
} from '../../shared/agent-style'
import {
  type AgentConfig,
  type AgentConnectionIntentResult,
  type AgentModelOption,
  type AgentOpenApiProfile,
  type AgentPathReference,
  type AgentSkillOption,
  type AgentValidationResult,
  type AgentWikiReference,
  type ConnectionConfig,
  type ConnectionInput,
  type LocalInstructionDocument,
  type StoredAgentRun,
  type StoredSessionHistoryItem,
  type WikiDocumentSummary
} from '../../shared/agent-types'
import {
  collectAttentionTabIds,
  normalizeAttentionClickedPayload,
  pendingApprovalTabIdsFromRuns,
  resolveAttentionJumpTabId
} from '../../shared/attention-notify'
import {
  createEmptyOpenApiProfile,
  resolveActiveOpenApiProfile,
  updateOpenApiProfileInConfig,
  withActiveOpenApiProfile
} from '../../shared/openapi-profiles'
import { EMPTY_SESSION_TOKEN_USAGE, addSessionTokenUsage } from '../../shared/session-token-usage'
import { isSshCommandLine, resolveFinalSshTarget } from '../../shared/ssh-destination'

/** Hard timeout for PTY spawn during reconnect (configurable). */

/** Hard timeout for the whole login automation (spawn + actions + password wait). */

/** Settle copy for run stops: only a real user stop shows "manually stopped". */

/** Subterminals live under the parent tab; resolve their terminal state. */

function App({
  recoveryMode = 'none',
  initialWorkbenchLayout
}: {
  recoveryMode?: 'none' | 'pending'
  initialWorkbenchLayout?: WorkbenchLayout | null
}): React.JSX.Element {
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
  const pendingAttentionNotifierRef = useRef(
    createPendingAttentionNotifier({
      isWindowFocused: () => typeof document !== 'undefined' && document.hasFocus()
    })
  )
  const activeExecutionTabIdRef = useRef(new Map<string, string>())
  const [executionTerminalByChatId, setExecutionTerminalByChatId] = useState<
    Record<string, string>
  >({})

  const validationRequestRef = useRef(0)
  const nextLogIdRef = useRef(1)
  const agentLogRef = useRef<HTMLDivElement | null>(null)
  const agentInputRef = useRef<ComposerInputHandle | null>(null)

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
  const pendingPostLoginSupplementsRef = useRef(new Map<string, string[]>())
  const reconnectingTabsRef = useRef(new Set<string>())
  const recoveryBudgetByTabRef = useRef(
    new Map<
      string,
      { driftKey?: string; attempts: number; windowStartAt: number; inFlight: boolean }
    >()
  )
  const ptyRetryTriedRef = useRef(new Set<string>())
  const suppressTerminalReconnectRef = useRef(new Set<string>())
  const automatedLoginTabsRef = useRef(new Set<string>())
  const clusterLoginQueueRef = useRef(new ConnectionLoginQueue())
  const skipConnectionReconnectRef = useRef(new Set<string>())
  const skipStoredPasswordTabsRef = useRef(new Set<string>())
  const restoreTerminalSessionRef = useRef<((tabId: string) => Promise<boolean>) | null>(null)
  const stopAgentRunRef = useRef<
    | ((
        tabId?: string,
        options?: { reason?: RunStopReason; expectedHost?: string; observedHost?: string }
      ) => void | Promise<void>)
    | null
  >(null)

  const showConnectionListRef = useRef<() => void>(() => {})
  const openNewConnectionFormRef = useRef<() => void>(() => {})
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
          connectionRouteLabel?: string
          activeWikiIds?: string[]
          activeSkillPaths?: string[]
        }
      ) => Promise<void>)
    | null
  >(null)
  const activeAgentRunRef = useRef(new Map<string, AgentRunViewState>())
  /** Last pure-login run logId per chat tab, so a subterminal fallback success
   *  can rewrite an already-finalized (failed) login card to success. */
  const lastLoginRunLogIdRef = useRef(new Map<string, number>())

  const splitDragRef = useRef(false)
  const [config, setConfig] = useState<AgentConfig>(emptyConfig)
  const [commandWhitelistText, setCommandWhitelistText] = useState('')
  const configRef = useRef(config)
  const commandWhitelistTextRef = useRef(commandWhitelistText)

  const [providerModelsText, setProviderModelsText] = useState(
    formatProviderModels(emptyConfig.providers[0]?.models ?? [])
  )
  const [models, setModels] = useState<AgentModelOption[]>([])

  const [instructionFiles, setInstructionFiles] = useState<LocalInstructionDocument[]>([])
  const [selectedInstructionName, setSelectedInstructionName] = useState('IDENTITY.md')
  const [instructionContent, setInstructionContent] = useState('')
  const [instructionSaved, setInstructionSaved] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [whaleEnabled, setWhaleEnabled] = useState(false)

  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldShowOnboarding())
  const [mcpOpen, setMcpOpen] = useState(false)
  const [providerEditorOpen, setProviderEditorOpen] = useState(false)
  const [openApiEditorOpen, setOpenApiEditorOpen] = useState(false)
  const [instructionEditorOpen, setInstructionEditorOpen] = useState(false)

  const [loadingEarlierLogs, setLoadingEarlierLogs] = useState(false)
  const [earlierLogsError, setEarlierLogsError] = useState<string | null>(null)
  const [hasEarlierLogs, setHasEarlierLogs] = useState(false)
  const [connectionAttemptByChatTab, setConnectionAttemptByChatTab] = useState<
    Record<string, ConnectionAttemptState>
  >({})
  const [dismissedRecoveryByChatTab, setDismissedRecoveryByChatTab] = useState<
    Record<string, boolean>
  >({})
  const lastProcessedFailureEntryRef = useRef(new Map<string, number>())
  const retryInFlightRef = useRef(new Set<string>())

  const [sessionUsageBaselineByTabId, setSessionUsageBaselineByTabId] = useState<
    Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>
  >({})
  const [liveSessionUsageByTabId, setLiveSessionUsageByTabId] = useState<
    Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>
  >({})
  const [liveContextUsageByTabId, setLiveContextUsageByTabId] = useState<
    Record<string, { tokens: number | null; contextWindow: number; percent: number | null }>
  >({})
  const [contextCompactingByTabId, setContextCompactingByTabId] = useState<Record<string, boolean>>(
    {}
  )
  const liveRunUsageRef = useRef(
    new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>()
  )

  const [saved, setSaved] = useState(false)
  const [validation, setValidation] = useState<AgentValidationResult | undefined>()
  const [validating, setValidating] = useState(false)
  const [importingOpenApi, setImportingOpenApi] = useState(false)
  const [connections, setConnections] = useState<ConnectionConfig[]>([])

  const [connectionModalOpen, setConnectionModalOpen] = useState(false)
  const [connectionSearchQuery, setConnectionSearchQuery] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [connectionEditing, setConnectionEditing] = useState(false)
  const [connectionFormOpen, setConnectionFormOpen] = useState(false)
  const [connectionForm, setConnectionForm] = useState<ConnectionInput>(createEmptyConnectionForm)
  const [connectionSshOptionsText, setConnectionSshOptionsText] = useState('')
  const [connectionActionsText, setConnectionActionsText] = useState('')
  const [connectionImportText, setConnectionImportText] = useState('')
  const [connectionSaveMessage, setConnectionSaveMessage] = useState<SkillManageMessage | null>(
    null
  )
  const [connectionNameConflict, setConnectionNameConflict] = useState<{
    existingId: string
    name: string
    connectAfterSave: boolean
  } | null>(null)
  const [connectionActionBusy, setConnectionActionBusy] = useState(false)
  const connectionActionBusyRef = useRef(false)

  // First-open shows the terminal and keeps the chat area hidden; the chat can
  // be summoned from the right-edge rail or the layout toggle.

  const [terminalPage, setTerminalPage] = useState<'terminal' | 'connections'>('terminal')
  const [slashCommandOpen, setSlashCommandOpen] = useState(true)
  const [slashCommandIndex, setSlashCommandIndex] = useState(0)
  const [composerCaret, setComposerCaret] = useState(0)
  const [locale, setLocale] = useState<Locale>(() => resolveInitialLocale())

  const [closeTabsConfirmRequest, setCloseTabsConfirmRequest] =
    useState<CloseTabsConfirmRequest | null>(null)
  const [settingsProviderId, setSettingsProviderId] = useState('')
  const [settingsMcpServerId, setSettingsMcpServerId] = useState('')
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
    terminalPanePercent,
    setTerminalPanePercent,
    subterminalPanelHeight,
    setSubterminalPanelHeight,
    subterminalCollapsed,
    setSubterminalCollapsed,
    workbenchLayout,
    setWorkbenchLayout,
    persistAndSetWorkbenchLayout,
    paneOrder,
    setPaneOrder,
    closeTerminalConfirmEnabled,
    setCloseTerminalConfirmEnabled
  } = useWorkbenchLayout({ initialWorkbenchLayout })

  const {
    passwordPromptsByTabRef,
    passwordAttentionTabIds,
    setPasswordAttentionTabIds,
    passwordPromptInputRef,
    passwordPromptBuffersRef,
    passwordPromptOpenTabsRef,
    passwordPromptRequestRef,
    passwordPromptRequest,
    setPasswordPromptRequest,
    passwordPromptValue,
    setPasswordPromptValue,
    passwordPromptError,
    setPasswordPromptError,
    submitPasswordPrompt,
    cancelPasswordPrompt,
    showNextPasswordPrompt
  } = usePasswordPrompt({
    agentInputRef,
    automatedLoginTabsRef,
    tabsRef,
    connectionsRef,
    pendingAttentionNotifierRef,
    t,
    activeTabIdRef
  })

  const {
    historyOpen,
    setHistoryOpen,
    historyLoading,
    historyError,
    historyItems,
    setHistoryItems,
    historyTitleEditingId,
    historyTitleDraft,
    setHistoryTitleDraft,
    historyTitleSavingId,
    refreshSessionHistory,
    setHistorySheetOpen,
    startRenameHistorySession,
    cancelRenameHistorySession,
    saveHistorySessionTitle,
    deleteHistorySession
  } = useHistoryController({ t, setTabs })

  const {
    wikiOpen,
    wikiLoading,
    wikiDocumentLoadingId,
    wikiDocuments,
    setWikiDocuments,
    wikiDirectory,
    wikiDirectoryChanging,
    selectedWikiDocument,
    setSelectedWikiDocument,
    wikiSearchQuery,
    setWikiSearchQuery,
    wikiEditing,
    setWikiEditing,
    wikiEditContent,
    setWikiEditContent,
    wikiSaving,
    wikiDeletingId,
    wikiMessage,
    setWikiMessage,
    wikiPreviewWidth,
    setWikiPreviewWidth,
    filteredWikiDocuments,
    refreshWikiDocuments,
    chooseWikiDirectory,
    resetWikiDirectory,
    setWikiSheetOpen,
    openWikiDocument,
    saveWikiEdits,
    deleteWikiDocument
  } = useWikiController({ t })

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
    setWorkbenchLayout,
    emptyLocalTab,
    updateTab,
    localTerminalTitle: t.connections.localTerminal,
    providerId: config.providerId
  })

  const {
    skills,
    setSkills,
    localSkillSearchQuery,
    setLocalSkillSearchQuery,
    skillSearchQuery,
    setSkillSearchQuery,
    skillSearchResults,
    skillSearchLoading,
    skillDeletingPath,
    copiedSkillCommandId,
    skillManageMessage,
    skillInstallIds,
    skillInstallLogs,
    skillInstallLogNames,
    skillInstallLogStatuses,
    skillInstallLogResultId,
    setSkillInstallLogResultId,
    selectedSkillPreview,
    setSelectedSkillPreview,
    skillPreviewLoadingPath,
    copiedSkillInstallLogId,
    skillInstallCancelingIds,
    skillOpen,
    setSkillOpen,
    filteredLocalSkills,
    installedSkillNames,
    saveSkillRoot,
    refreshSkills,
    searchSkills,
    installSkill,
    cancelSkillInstall,
    deleteSkillInstallLog,
    copySkillInstallCommand,
    copySelectedSkillInstallLog,
    importSkillFromDisk,
    deleteSkill,
    previewSkill,
    previewCatalogSkill,
    removeSkillRef
  } = useSkillsController({
    saveAgentConfig,
    config,
    commandWhitelistText,
    t,
    setConfig,
    updateTab,
    sessionChatTab,
    applyComposerInput
  })

  const {
    opsFeedbackByLogId,
    setOpsFeedbackByLogId,
    opsFeedbackBusyLogId,
    submitOpsFeedbackForEntry
  } = useOpsFeedback({ activeAgentRunRef, tabsRef, activeTab, activeTabIdRef, t })

  const handoff = useHandoff({
    tabId: sessionChatTab.id,
    tabIds: tabs.map((tab) => tab.id),
    busy: sessionChatTab.agentBusy || Boolean(contextCompactingByTabId[sessionChatTab.id]),
    contextVersion: sessionChatTab.agentLog.length,
    locale,
    t,
    createDraft: createHandoffConversation
  })

  const sessionAgentStyle = resolveSessionAgentStyle(sessionChatTab, config)
  const sessionTokenUsage = addSessionTokenUsage(
    sessionUsageBaselineByTabId[sessionChatTab.id] ?? EMPTY_SESSION_TOKEN_USAGE,
    liveSessionUsageByTabId[sessionChatTab.id] ?? EMPTY_SESSION_TOKEN_USAGE
  )
  const sessionContextUsage = liveContextUsageByTabId[sessionChatTab.id]

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
        storageClient.listOpsFeedback({ connectionId, limit: 40 }),
        storageClient.listAgentRuns({ tabId: sessionChatTab.id, limit: 40 })
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
    setOpsFeedbackByLogId,
    t
  ])

  useEffect(() => {
    const tabId = sessionChatTab.id
    let cancelled = false
    void storageClient.getSessionTokenUsage(tabId).then((usage) => {
      if (cancelled) return
      setSessionUsageBaselineByTabId((current) => ({ ...current, [tabId]: usage }))
    })
    return () => {
      cancelled = true
    }
  }, [sessionChatTab.id])

  useEffect(() => {
    let cancelled = false
    const chatTabId = sessionChatTab.id
    void storageClient.countAgentLogs(chatTabId).then((count) => {
      if (cancelled) return
      setHasEarlierLogs(count > sessionChatTab.agentLog.length)
    })
    return () => {
      cancelled = true
    }
  }, [sessionChatTab.agentLog.length, sessionChatTab.id])

  async function loadEarlierAgentLogs(): Promise<void> {
    if (loadingEarlierLogs) return
    const chatTabId = sessionChatTab.id
    const oldestId = sessionChatTab.agentLog.reduce(
      (min, entry) => Math.min(min, entry.id),
      Number.POSITIVE_INFINITY
    )
    setLoadingEarlierLogs(true)
    setEarlierLogsError(null)
    try {
      const rows = await storageClient.listAgentLogs({
        tabId: chatTabId,
        beforeLogId: Number.isFinite(oldestId) ? oldestId : undefined,
        limit: 40
      })
      if (rows.length === 0) {
        setHasEarlierLogs(false)
        return
      }
      const existingIds = new Set(sessionChatTab.agentLog.map((entry) => entry.id))
      const hydrated = rows
        .map((row) => hydrateStoredAgentLog(row))
        .filter((entry) => !existingIds.has(entry.id))
      if (hydrated.length === 0) {
        setHasEarlierLogs(false)
        return
      }
      updateTab(chatTabId, (tab) => {
        const merged = trimAgentLogEntries([...hydrated, ...tab.agentLog], AGENT_LOG_SOFT_LIMIT)
        return { ...tab, agentLog: merged }
      })
      const total = await storageClient.countAgentLogs(chatTabId)
      const nextLen =
        tabsRef.current.find((tab) => tab.id === chatTabId)?.agentLog.length ??
        sessionChatTab.agentLog.length + hydrated.length
      setHasEarlierLogs(total > nextLen)
    } catch {
      setEarlierLogsError(t.input.loadEarlierLogsFailed)
    } finally {
      setLoadingEarlierLogs(false)
    }
  }

  const updateConnectionAttempt = useCallback(
    (chatTabId: string, updater: (state: ConnectionAttemptState) => ConnectionAttemptState) => {
      setConnectionAttemptByChatTab((current) => ({
        ...current,
        [chatTabId]: updater(current[chatTabId] ?? createIdleConnectionAttempt())
      }))
    },
    []
  )

  const markChatTabReady = useCallback(
    (chatTabId: string) => {
      updateConnectionAttempt(chatTabId, markConnectionReady)
    },
    [updateConnectionAttempt]
  )

  const connectionRecovery = useMemo(() => {
    const chatTabId = sessionChatTab.id
    const state = connectionAttemptByChatTab[chatTabId] ?? createIdleConnectionAttempt()
    const visible = state.phase === 'failed' || state.phase === 'connecting'
    return {
      visible,
      canRetry: state.canRetry && !state.pipeFallback,
      connecting: state.phase === 'connecting',
      pipeFallback: state.pipeFallback,
      reason: state.reason,
      dismissed: Boolean(dismissedRecoveryByChatTab[chatTabId])
    }
  }, [connectionAttemptByChatTab, dismissedRecoveryByChatTab, sessionChatTab.id])

  // Single source of truth: any NEW connection-failure error entry transitions
  // the per-chat connection attempt into failed on the same card.
  useEffect(() => {
    const chatTabId = sessionChatTab.id
    const markers = connectionFailureMarkers(t)
    const processedUpTo = lastProcessedFailureEntryRef.current.get(chatTabId) ?? -1
    let lastSeen = processedUpTo
    for (const entry of sessionChatTab.agentLog) {
      if (entry.kind !== 'error') continue
      if (entry.id <= processedUpTo) continue
      lastSeen = Math.max(lastSeen, entry.id)
      if (isConnectionFailureLog(entry.text, markers)) {
        const pipeFallback =
          /SSH requires PTY/i.test(entry.text) ||
          sessionTerminals.some((tab) => tab.terminalMode === 'pipe')
        updateConnectionAttempt(chatTabId, (state) =>
          markConnectionFailed(state, {
            reason: entry.text,
            pipeFallback,
            failureEntryId: entry.id
          })
        )
        setDismissedRecoveryByChatTab((current) => ({ ...current, [chatTabId]: false }))
      }
    }
    if (lastSeen > processedUpTo) {
      lastProcessedFailureEntryRef.current.set(chatTabId, lastSeen)
    }
  }, [sessionChatTab.agentLog, sessionChatTab.id, sessionTerminals, t, updateConnectionAttempt])
  const {
    appendLog,
    updateLogEntryText,
    updateAgentRun,
    appendAgentEvent,
    liveRunByLogId,
    pruneLiveRuns,
    attachApprovalRequest,
    applyApprovalPurpose,
    resolveApprovalStep
  } = useAgentRuns({
    activeTabIdRef,
    nextLogIdRef,
    activeAgentRunRef,
    activeRunCanceledRef,
    updateTab,
    t
  })
  const {
    savingSopLogId,
    savingHistorySkillTabId,
    captureJobs,
    captureDialogKind,
    setCaptureDialogKind,
    savingHistoryWikiTabId,
    startCaptureFromCurrentSession,
    saveAgentTurnAsWikiSop,
    saveHistorySessionToWiki,
    saveHistorySessionToSkill,
    patchDialogCaptureJob,
    refineCaptureDraft,
    commitCaptureDraft,
    openCaptureDraft
  } = useCaptureController({
    tabsRef,
    activeTabIdRef,
    locale,
    t,
    appendLog,
    liveRunByLogId,
    sessionChatTab,
    setWikiDocuments,
    setSelectedWikiDocument,
    setWikiEditContent,
    setWikiEditing,
    setWikiPreviewWidth,
    setWikiMessage,
    setSkills,
    updateTab,
    agentInputRef
  })
  const captureDialogJob =
    captureDialogKind == null
      ? undefined
      : findCaptureJob(captureJobs, {
          kind: captureDialogKind,
          tabId: sessionChatTab.id
        })
  const capturePins = visibleCaptureDraftPins({
    jobs: captureJobs,
    activeTabId: sessionChatTab.id,
    agentBusy: sessionChatTab.agentBusy
  })
  const captureReadyLogs = captureReadyLogsForTab(captureJobs, sessionChatTab.id)
  const hiddenReadyLogIds = hiddenCaptureReadyLogIds({
    jobs: captureJobs,
    activeTabId: sessionChatTab.id,
    agentBusy: sessionChatTab.agentBusy
  })
  const { modelOptions, visibleModels, settingsProvider } = useSettings({
    config,
    models,
    settingsProviderId,
    settingsMcpServerId,
    emptyProvider,
    emptyMcpServer
  })
  const enabledProviders = config.providers.filter(isAgentProviderEnabled)
  const activeTabProviderId = sessionChatTab.providerId ?? config.providerId
  const activeProviderId = enabledProviders.some((provider) => provider.id === activeTabProviderId)
    ? (activeTabProviderId ?? enabledProviders[0]?.id ?? '')
    : (visibleModels.find((model) => model.id === (sessionChatTab.model ?? config.model))
        ?.providerId ??
      enabledProviders[0]?.id ??
      '')
  const filteredModels = visibleModels.filter((model) => model.providerId === activeProviderId)
  const activeTabModelId =
    sessionChatTab.model && filteredModels.some((model) => model.id === sessionChatTab.model)
      ? sessionChatTab.model
      : (filteredModels[0]?.id ?? config.model)
  const activeModel = visibleModels.find(
    (model) => model.id === activeTabModelId && model.providerId === activeProviderId
  )
  const {
    validateConfig,
    applyDefaultModel,
    updateSettingsProvider,
    updateSettingsProviderModels,
    toggleProviderDetails,
    toggleProviderEnabled,
    createProvider,
    deleteSettingsProvider,
    updateSettingsMcpServers,
    saveMcpServers
  } = useProviderController({
    config,
    validationRequestRef,
    setValidating,
    setValidation,
    modelOptions,
    setConfig,
    saveAgentConfig,
    settingsProviderId,
    settingsProvider,
    setSettingsProviderId,
    setProviderModelsText,
    setOpenApiEditorOpen,
    setInstructionEditorOpen,
    setProviderEditorOpen,
    t,
    commandWhitelistText,
    setSaved
  })
  const {
    persistAgentConfigPatch,
    saveConfig,
    persistAgentStyle,
    persistShowAgentThinking,
    scheduleWorkspaceCwdPersist,
    flushWorkspaceCwdPersist
  } = useSessionPersistence({
    setSaved,
    configRef,
    commandWhitelistTextRef,
    setConfig,
    setValidation,
    saveAgentConfig,
    validateConfig,
    updateConfig
  })

  const activeModelSelectionValue = buildModelSelectionValue(activeProviderId, activeTabModelId)
  const availableToolRefs = useMemo(() => buildAvailableToolRefs(validation), [validation])
  const mcpToolRefs = useMemo(
    () => availableToolRefs.filter((tool) => tool.source === 'mcp'),
    [availableToolRefs]
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
  const terminalVisible = workbenchLayout !== 'chat' && terminalPage === 'terminal'
  const {
    displayConnections,
    filteredDisplayConnections,
    connectionFormReady,
    clusterHostRegexValidation,
    connectionCommandPreview
  } = useConnections({
    connections,
    query: connectionSearchQuery,
    connectionForm,
    connectionSshOptionsText,
    localTerminalLabel: t.connections.localTerminal,
    localTerminalDescription: t.connections.defaultTerminal
  })
  const slashQueryCursor =
    getSlashCommandQuery(sessionChatTab.agentInput, composerCaret) !== undefined
      ? composerCaret
      : sessionChatTab.agentInput.length
  const slashCommandQuery = getSlashCommandQuery(sessionChatTab.agentInput, slashQueryCursor)
  const slashCommandOptions = useMemo(() => {
    if (slashCommandQuery === undefined) return []

    if (isStyleSlashQuery(slashCommandQuery)) {
      return buildStyleSlashCommands(t).filter((command) =>
        matchesStyleSlashCommand(command, slashCommandQuery ?? '')
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
  const catalogLoadFailedText = t.app.catalogLoadFailed
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

  const abortPostConnectionTasks = useCallback(
    (targetTabId: string, reason: string): void => {
      const tasks = postConnectionTasksRef.current.get(targetTabId) ?? []
      postConnectionTasksRef.current.delete(targetTabId)
      const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTabId)
      // Login failed; drop supplements that were queued for a post-login task
      // that will never start.
      pendingPostLoginSupplementsRef.current.delete(chatTabId)
      if (tasks.length === 0) return

      for (const task of tasks) {
        const message = formatConnectionAutomationFailure({
          abortLabel: reason,
          originalTaskLabel: t.terminal.postLoginOriginalTask,
          originalTask: task.displayInput
        })
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
          activeRunCanceledRef.current.delete(chatTabId)
          activeRunIdRef.current.delete(chatTabId)
          activeRunInputRef.current.delete(chatTabId)
          updateTab(chatTabId, (current) => ({
            ...current,
            agentBusy: false,
            agentThinking: false,
            thinkingMessage: undefined
          }))
          pruneLiveRuns([task.reuseRun.logId])
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
    [appendLog, pruneLiveRuns, t, updateAgentRun, updateTab]
  )

  /**
   * System/status entries land INSIDE the live run timeline when a run is
   * active (monotonic order), so recovery/drift messages never render after
   * the run card they belong to. Without an active run they append as log rows.
   */
  const appendSystemToRunOrLog = useCallback(
    (chatTabId: string, text: string, detail?: string): void => {
      const active = activeAgentRunRef.current.get(chatTabId)
      if (active) {
        updateAgentRun(chatTabId, (run) => ({
          ...run,
          steps: appendRunStatusStep(run.steps ?? [], {
            id: `status-${crypto.randomUUID()}`,
            title: text,
            detail
          }) as unknown as AgentRunStep[]
        }))
        return
      }
      appendLog({ kind: 'status', text }, chatTabId)
    },
    [appendLog, updateAgentRun]
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
      appendSystemToRunOrLog(chatTabId, text)
    },
    [appendSystemToRunOrLog, updateAgentRun]
  )

  const drainPostConnectionTasks = useCallback(
    (targetTabId: string): void => {
      const tasks = postConnectionTasksRef.current.get(targetTabId) ?? []
      if (tasks.length === 0) return

      postConnectionTasksRef.current.delete(targetTabId)
      const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTabId)
      void Promise.all(
        tasks.map(async (task) => {
          // Supplements queued while the agent session was not active yet (e.g.
          // typed during login automation) must reach the follow-up task.
          const pendingSupplements = pendingPostLoginSupplementsRef.current.get(chatTabId) ?? []
          if (pendingSupplements.length > 0) {
            pendingPostLoginSupplementsRef.current.delete(chatTabId)
          }
          const taskInput = mergePostLoginSupplements(task.input, pendingSupplements)
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
            appendStatusToActiveRunOrLog(chatTabId, t.terminal.postLoginTaskStarting, task.reuseRun)
          } else {
            appendSystemToRunOrLog(chatTabId, t.terminal.postLoginTaskStarting)
          }
          await runAgentConversationRef.current?.(
            taskInput,
            targetTabId,
            task.connection.id,
            task.displayInput,
            task.appendUserLog,
            task.startedAt,
            {
              conversationContext: task.conversationContext,
              chatTabId,
              reuseRun: task.reuseRun,
              activeWikiIds: task.activeWikiIds,
              activeSkillPaths: task.activeSkillPaths
            }
          )
        })
      )
    },
    [appendLog, appendStatusToActiveRunOrLog, appendSystemToRunOrLog, t, updateAgentRun, updateTab]
  )

  /**
   * Settle a pure-login assistant run after connection automation finishes:
   * appends the login-completed step, sets the end-to-end elapsed time and the
   * structured login result/error, then tears the run down so the card stops
   * showing the busy state. No-op for normal agent runs (no loginMeta).
   */
  const finalizeLoginRun = useCallback(
    (
      chatTabId: string,
      ok: boolean,
      errorText?: string,
      options?: { targetTabId?: string; connection?: ConnectionConfig }
    ): void => {
      const active = activeAgentRunRef.current.get(chatTabId)
      if (!active?.loginMeta || !active.runId) return

      const runId = active.runId
      const startedAt = active.startedAt ?? Date.now()
      const elapsedMs = Date.now() - startedAt
      let finishedRun: AgentRunViewState = active
      connTrace('login-stage', `tab=${chatTabId}`, 'finalize-start')

      if (ok) {
        const connectionTarget = formatConnectionTarget({
          host: active.loginMeta.host,
          port: active.loginMeta.port,
          user: active.loginMeta.user,
          name: active.loginMeta.connectionName,
          source: 'custom'
        } as ConnectionConfig)
        finishedRun = {
          ...active,
          steps: appendRunStatusStep(active.steps ?? [], {
            id: `status-${crypto.randomUUID()}`,
            title: t.terminal.postLoginTaskStarting
          }) as unknown as AgentRunStep[],
          result: `${t.terminal.loginSuccess} ${active.loginMeta.connectionName} (${connectionTarget})`,
          elapsedMs
        }
        updateAgentRun(chatTabId, () => finishedRun)
        void persistAgentRun({
          runId,
          tabId: chatTabId,
          input: activeRunInputRef.current.get(chatTabId) ?? '',
          status: 'success',
          connectionId: tabsRef.current.find((tab) => tab.id === chatTabId)?.connectionId,
          startedAt: new Date(startedAt).toISOString(),
          elapsedMs,
          trace: buildTraceFromAgentRunView({
            runId,
            tabId: chatTabId,
            displayInput: activeRunInputRef.current.get(chatTabId) ?? '',
            status: 'success',
            run: finishedRun,
            startedAt
          })
        })
      } else {
        const message = errorText?.trim() || t.terminal.postLoginTaskAborted
        finishedRun = {
          ...active,
          steps: closeStreamingOpenSteps(active.steps ?? []),
          error: message,
          elapsedMs
        }
        updateAgentRun(chatTabId, () => finishedRun)
        void persistAgentRun({
          runId,
          tabId: chatTabId,
          input: activeRunInputRef.current.get(chatTabId) ?? '',
          status: 'error',
          connectionId: tabsRef.current.find((tab) => tab.id === chatTabId)?.connectionId,
          error: message,
          startedAt: new Date(startedAt).toISOString(),
          elapsedMs,
          trace: buildTraceFromAgentRunView({
            runId,
            tabId: chatTabId,
            displayInput: activeRunInputRef.current.get(chatTabId) ?? '',
            status: 'error',
            connectionId: tabsRef.current.find((tab) => tab.id === chatTabId)?.connectionId,
            run: finishedRun,
            startedAt,
            error: message
          })
        })
      }

      const finishedLogId = active.logId
      updateLogEntryText(chatTabId, finishedLogId, buildFinishPersistText(finishedRun))
      activeAgentRunRef.current.delete(chatTabId)
      activeRunCanceledRef.current.delete(chatTabId)
      activeRunIdRef.current.delete(chatTabId)
      activeRunInputRef.current.delete(chatTabId)
      if (typeof finishedLogId === 'number') pruneLiveRuns([finishedLogId])
      lastLoginRunLogIdRef.current.delete(chatTabId)
      updateTab(chatTabId, (current) => ({
        ...current,
        agentInput: '',
        agentBusy: false,
        agentThinking: false,
        thinkingMessage: undefined
      }))

      // Consume supplements that arrived during login. A pure-login run has no
      // post-connection task, so the queue would otherwise sit unread: continue
      // with the supplements as a new agent task in the logged-in terminal.
      if (ok && options?.targetTabId && options.connection) {
        const supplements = pendingPostLoginSupplementsRef.current.get(chatTabId) ?? []
        const continuationDecision = resolveLoginContinuation({ ok, supplements })
        if (continuationDecision.shouldContinue) {
          pendingPostLoginSupplementsRef.current.delete(chatTabId)
          const supplementText = supplements.join('\n')
          const continuationInput = buildPostLoginAgentInput(supplementText, options.connection, t)
          const dispatchStart = Date.now()
          connTrace(
            'login-stage',
            `tab=${chatTabId}`,
            `continuationDispatch=now`,
            `supplements=${supplements.length}`
          )
          // The supplements are already visible as user-supplement rows; do not
          // append a duplicate user bubble for the continuation.
          void runAgentConversationRef
            .current?.(
              continuationInput,
              options.targetTabId,
              options.connection.id,
              supplementText,
              false,
              Date.now(),
              { chatTabId }
            )
            ?.finally(() => {
              connTrace(
                'login-stage',
                `tab=${chatTabId}`,
                `continuationRunSettled`,
                `dispatchToSettledMs=${Date.now() - dispatchStart}`
              )
            })
        }
      }
    },
    [
      pendingPostLoginSupplementsRef,
      pruneLiveRuns,
      t,
      updateAgentRun,
      updateLogEntryText,
      updateTab
    ]
  )

  const executeConnectionAutomationNow = useCallback(
    async (
      connection: ConnectionConfig,
      targetTabId: string,
      includeSshCommand: boolean
    ): Promise<boolean> => {
      const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTabId)
      skipConnectionReconnectRef.current.delete(targetTabId)
      let resolvedConnection = connection
      try {
        const refreshed = await connectionsClient.resolve(connection.id)
        if (refreshed) {
          resolvedConnection = mergeConnectionInput(refreshed, connection)
          setConnections((current) =>
            current.map((item) => (item.id === refreshed.id ? refreshed : item))
          )
        }
      } catch {
        resolvedConnection = connection
      }

      const skipStoredPassword = skipStoredPasswordTabsRef.current.delete(resolvedConnection.id)
      const loginConnection = skipStoredPassword
        ? stripStoredPassword(resolvedConnection)
        : resolvedConnection

      const liveContext = await terminalClient.getContext(targetTabId)
      const remaining = resolveRemainingConnectionCommands(loginConnection, {
        promptHost: liveContext.promptHost,
        alignment: liveContext.alignment ?? liveContext.sessionAligned,
        output: liveContext.output,
        mode: liveContext.mode,
        preferSshCommand: includeSshCommand,
        ready: liveContext.ready,
        aliases: liveContext.aliases,
        returnToJumpHost: liveContext.returnToJumpHost
      })
      const commands = remaining.commands
      const includeSshNow = remaining.includeSshCommand
      connTrace(
        'login-remaining',
        `tab=${targetTabId}`,
        `includeSsh=${includeSshNow}`,
        `actions=${commands.length}`,
        `promptHost=${liveContext.promptHost ?? '-'}`,
        `aligned=${liveContext.alignment ?? liveContext.sessionAligned ?? '-'}`
      )

      if (!skipStoredPassword && isPasswordEnvVarMissing(resolvedConnection)) {
        const message = `${t.connections.passwordEnvVarMissing}: ${resolvedConnection.passwordEnvVar}`
        appendLog({ kind: 'error', text: message }, chatTabId)
        abortPostConnectionTasks(targetTabId, `${t.terminal.postLoginTaskAborted}\n${message}`)
        return false
      }

      if (commands.length === 0) {
        if (liveContext.promptHost && liveContext.promptHost !== 'local-shell') {
          await terminalClient.confirmLogin({
            tabId: targetTabId,
            expectedTargetHost: resolveFinalSshTarget(
              buildConnectionCommands(loginConnection),
              resolvedConnection.host
            )
          })
        }
        return true
      }

      const targetTab = tabsRef.current.find((tab) => tab.id === targetTabId)
      const subterminal = targetTab
        ? undefined
        : resolveSubterminalTabState(tabsRef.current, targetTabId)
      const terminalMode = targetTab?.terminalMode ?? subterminal?.terminalMode
      const [sshCommand] = includeSshNow ? commands : []
      if (
        terminalMode === 'pipe' &&
        sshCommand &&
        classifyPipeCommand(sshCommand) === 'interactive'
      ) {
        const message =
          'Interactive SSH login requires PTY mode. Current terminal is PIPE fallback. One-shot non-interactive ssh (BatchMode or a remote command without -t) is still allowed; restart the app after node-pty is available for interactive sessions.'
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
      const loginActionCount = includeSshNow ? Math.max(0, commands.length - 1) : commands.length
      appendStatusToActiveRunOrLog(
        chatTabId,
        loginActionCount > 0
          ? `${t.terminal.connectionStarting}: ${loginActionCount}`
          : t.terminal.connectionNoActions,
        pendingReuseRun
      )

      automatedLoginTabsRef.current.add(targetTabId)
      passwordPromptBuffersRef.current.set(targetTabId, '')
      try {
        // Bind the selected host before sending SSH. Match the 1.0.11 flow:
        // validating a saved-connection identity here must not silently stop
        // the login before the SSH command reaches the terminal.
        const targetBinding = await terminalClient.setExpectedHost({
          tabId: targetTabId,
          host: resolvedConnection.host,
          connectionId: resolvedConnection.id,
          clusterHostRegex: resolvedConnection.clusterHostRegex
        })
        connTrace(
          'expected-host-bind',
          `tab=${targetTabId}`,
          `ok=${targetBinding.ok}`,
          `error=${targetBinding.error ?? '-'}`
        )
        if (!targetBinding.ok) {
          const message = targetBinding.error ?? t.terminal.postLoginTaskAborted
          appendLog({ kind: 'error', text: message }, chatTabId)
          updateConnectionAttempt(chatTabId, (state) =>
            markConnectionFailed(state, { reason: message })
          )
          abortPostConnectionTasks(targetTabId, message)
          return false
        }

        const storedPassword = loginConnection.password || loginConnection.resolvedPassword
        const firstSecret = includeSshNow ? commands[1] : commands[0]
        const hasLeadingAutoPassword = Boolean(storedPassword && firstSecret === storedPassword)
        const ok = includeSshNow
          ? await runConnectionCommandSequence(
              commands,
              targetTabId,
              appendLog,
              (text, id) => appendSystemToRunOrLog(id, text),
              t,
              chatTabId,
              { hasLeadingAutoPassword }
            )
          : await runConnectionLoginActionSequence(
              commands,
              targetTabId,
              appendLog,
              (text, id) => appendSystemToRunOrLog(id, text),
              t,
              chatTabId,
              { hasLeadingAutoPassword }
            )
        if (!ok) {
          // Failed auth/host/login must not auto-retry the same SSH connection on exit.
          skipConnectionReconnectRef.current.add(targetTabId)
          abortPostConnectionTasks(targetTabId, t.terminal.postLoginTaskAborted)
          return false
        }
        const hasClusterHopAction = commands.some(
          (command, index) => (!includeSshNow || index > 0) && /^\s*sww\s+\S+/i.test(command)
        )
        if (hasClusterHopAction) {
          // `sww` reports “Switched to context” before it finishes opening the
          // cluster shell. Do not confirm the earlier jump-host prompt during
          // that gap; wait for a different remote prompt from the cluster.
          const hopContext = await terminalClient.getContext(targetTabId)
          const jumpPromptHost =
            hopContext.jumpPromptHost ??
            (hopContext.promptHost !== 'local-shell' ? hopContext.promptHost : undefined)
          if (jumpPromptHost) {
            const clusterPrompt = await waitForPromptHostOrTimeout(targetTabId, 30_000, {
              previousHost: jumpPromptHost,
              acceptAnyRemoteHost: true,
              clusterHostRegex: loginConnection.clusterHostRegex
            })
            connTrace(
              'cluster-login-stage',
              `tab=${targetTabId}`,
              `promptSignal=${clusterPrompt}`,
              `jump=${jumpPromptHost}`
            )
            if (clusterPrompt !== 'host') {
              const message = `Cluster login action did not leave jump host ${jumpPromptHost}.`
              appendLog({ kind: 'error', text: message }, chatTabId)
              skipConnectionReconnectRef.current.add(targetTabId)
              abortPostConnectionTasks(targetTabId, message)
              return false
            }
          }
        }
        // Wait for the remote prompt to settle, then write the verified login
        // back to the SSOT (learns the observed prompt host as an alias). The
        // transient local prompt of the fresh PTY is ignored during the window;
        // ending still at the local prompt means the ssh never established.
        const promptStart = Date.now()
        // Multi-hop login: the final `ssh <host>` action is the true target.
        // Wait for that host's prompt (not the jump box's) before confirming,
        // otherwise confirm-login anchors the wrong runtime environment.
        const lastAction = commands.length > 0 ? commands[commands.length - 1] : undefined
        const lastActionIsSsh = Boolean(lastAction && isSshCommandLine(lastAction))
        const preConfirm = await terminalClient.getContext(targetTabId)
        const fullCommands = buildConnectionCommands(loginConnection)
        const jumpPromptHost = preConfirm.jumpPromptHost ?? liveContext.jumpPromptHost
        // A configured login action may intentionally hop from the SSH jump
        // host into the selected cluster (for example `sww bjcdc` lands on a
        // cluster node). Anchor confirmation to that resulting remote prompt;
        // otherwise the jump host is confirmed first and the next prompt is
        // misclassified as drift, causing the terminal to exit and reconnect.
        const loginActionTargetHost =
          !lastActionIsSsh &&
          lastAction &&
          preConfirm.promptHost &&
          preConfirm.promptHost !== 'local-shell' &&
          (!jumpPromptHost || !isPromptHostAligned(preConfirm.promptHost, jumpPromptHost))
            ? preConfirm.promptHost
            : undefined
        const finalTargetHost =
          loginActionTargetHost ?? resolveFinalSshTarget(fullCommands, connection.host)
        const previousHost =
          lastActionIsSsh && preConfirm.promptHost && preConfirm.promptHost !== 'local-shell'
            ? preConfirm.promptHost
            : undefined
        connTrace(
          'login-target',
          `tab=${targetTabId}`,
          `target=${finalTargetHost ?? '-'}`,
          `source=${loginActionTargetHost ? 'login-action' : 'ssh-command'}`,
          `jump=${jumpPromptHost ?? '-'}`
        )
        appendSystemToRunOrLog(chatTabId, t.terminal.loginConfirming)
        const loginSignal = await waitForPromptHostOrTimeout(targetTabId, 20_000, {
          expectedHost: finalTargetHost,
          previousHost,
          acceptAnyRemoteHost: !finalTargetHost || isIpv4Literal(finalTargetHost),
          clusterHostRegex: loginConnection.clusterHostRegex
        })
        connTrace(
          'login-stage',
          `tab=${targetTabId}`,
          `promptSignal=${loginSignal}`,
          `promptAfterMs=${Date.now() - promptStart}`
        )
        if (loginSignal !== 'host') {
          abortPostConnectionTasks(targetTabId, t.terminal.postLoginTaskAborted)
          return false
        }
        const verified = await terminalClient.confirmLogin({
          tabId: targetTabId,
          expectedTargetHost: finalTargetHost,
          jumpPromptHost: previousHost
        })
        if (!verified.ok) {
          skipConnectionReconnectRef.current.add(targetTabId)
          abortPostConnectionTasks(
            targetTabId,
            verified.error ?? 'SSH did not reach the target (local prompt).'
          )
          return false
        }
        if (subterminal) {
          appendSystemToRunOrLog(
            chatTabId,
            t.terminal.terminalSubterminalLoginDone.replace('{name}', subterminal.name)
          )
        } else if ((postConnectionTasksRef.current.get(targetTabId) ?? []).length === 0) {
          appendSystemToRunOrLog(chatTabId, t.terminal.postLoginTaskStarting)
        }
        return true
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
    [
      abortPostConnectionTasks,
      appendLog,
      appendStatusToActiveRunOrLog,
      appendSystemToRunOrLog,
      passwordPromptBuffersRef,
      t,
      updateConnectionAttempt,
      updateTab
    ]
  )

  const executeConnectionAutomation = useCallback(
    async (
      connection: ConnectionConfig,
      targetTabId: string,
      includeSshCommand: boolean
    ): Promise<boolean> => {
      const key = clusterLoginQueueKey(connection)
      if (!key) return executeConnectionAutomationNow(connection, targetTabId, includeSshCommand)
      const queue = clusterLoginQueueRef.current
      const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTabId)
      if (queue.hasPending(key)) {
        appendLog({ kind: 'status', text: t.terminal.connectionLoginQueued }, chatTabId)
      }
      try {
        return await queue.run(
          key,
          async () => {
            // Closing a queued card must cancel it, not connect in a removed tab.
            const context = await terminalClient.getContext(targetTabId)
            if (context.mode === 'none') return false
            return executeConnectionAutomationNow(connection, targetTabId, includeSshCommand)
          },
          30_000
        )
      } catch (error) {
        const message =
          error instanceof ConnectionLoginQueueTimeout
            ? t.terminal.connectionLoginQueueTimeout
            : error instanceof Error
              ? error.message
              : String(error)
        appendLog({ kind: 'error', text: message }, chatTabId)
        return false
      }
    },
    [appendLog, executeConnectionAutomationNow, t]
  )

  const executeConnectionCommands = useCallback(
    async (connection: ConnectionConfig, targetTabId: string): Promise<boolean> => {
      const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTabId)
      const timeoutMessage = t.terminal.connectionLoginTimeout.replace(
        '{ms}',
        String(Math.round(CONNECTION_LOGIN_TOTAL_TIMEOUT_MS / 1000))
      )
      connTrace('automation-start', `tab=${targetTabId}`, `connection=${connection.id}`)
      const isSubterminal = Boolean(resolveSubterminalTabState(tabsRef.current, targetTabId))
      const ok = await runWithTimeout(
        executeConnectionAutomation(connection, targetTabId, true),
        CONNECTION_LOGIN_TOTAL_TIMEOUT_MS,
        () => {
          connTrace('automation-timeout', `tab=${targetTabId}`)
          appendLog({ kind: 'error', text: timeoutMessage }, chatTabId)
        }
      )
      if (!isSubterminal) {
        if (ok) {
          markChatTabReady(chatTabId)
          updateTab(targetTabId, (tab) => ({
            ...tab,
            terminalReady: true,
            terminalExited: false,
            terminalStartError: undefined
          }))
        } else if (ok === false) {
          updateConnectionAttempt(chatTabId, (state) =>
            markConnectionFailed(state, { reason: t.terminal.postLoginTaskAborted })
          )
        } else if (ok === undefined) {
          // Overall login timeout: settle the pending run (spinner) and the card
          // explicitly. The watcher also picks the error entry up, but do not
          // rely on marker coverage.
          abortPostConnectionTasks(targetTabId, timeoutMessage)
          updateConnectionAttempt(chatTabId, (state) =>
            markConnectionFailed(state, { reason: timeoutMessage })
          )
        }
      } else if (ok === undefined) {
        abortPostConnectionTasks(targetTabId, timeoutMessage)
      }
      retryInFlightRef.current.delete(chatTabId)
      if (shouldDrainPostConnectionTasks(ok === true)) drainPostConnectionTasks(targetTabId)
      if (!isSubterminal) {
        finalizeLoginRun(
          chatTabId,
          ok === true,
          ok === undefined
            ? timeoutMessage
            : ok === false
              ? t.terminal.postLoginTaskAborted
              : undefined,
          { targetTabId, connection }
        )
      }
      connTrace('automation-end', `tab=${targetTabId}`, `ok=${ok}`)
      return ok === true
    },
    [
      abortPostConnectionTasks,
      appendLog,
      drainPostConnectionTasks,
      executeConnectionAutomation,
      finalizeLoginRun,
      markChatTabReady,
      t,
      updateConnectionAttempt,
      updateTab
    ]
  )

  useEffect(() => {
    connectionsRef.current = connections
  }, [connections])

  useEffect(() => {
    restoreTerminalSessionRef.current = restoreTerminalSession
  })

  useEffect(() => {
    stopAgentRunRef.current = stopAgentRun
  })

  useEffect(() => {
    return terminalClient.onConnectionOrigin(({ tabId }) => {
      updateTab(tabId, (current) => ({
        ...current,
        connectionId: undefined,
        connectionName: undefined,
        isSsh: false
      }))
    })
  }, [updateTab])

  useEffect(() => {
    return terminalClient.onEnvironmentDrift((event) => {
      // Main only emits for true session breaks (exit-to-local / jump-box
      // fall-back). Peer hops are re-anchored in-process and never reach here.
      // Recover + re-run the interrupted agent input on the restored target.

      const chatTabId = resolveSessionChatTabId(tabsRef.current, event.tabId)
      const driftKey = event.driftKey ?? `${event.expectedHost}|${event.observedHost}`
      const budget = recoveryBudgetByTabRef.current.get(chatTabId) ?? {
        attempts: 0,
        windowStartAt: Date.now(),
        inFlight: false
      }
      if (budget.inFlight) return
      budget.inFlight = true
      recoveryBudgetByTabRef.current.set(chatTabId, budget)

      void (async () => {
        const observedLabel =
          event.observedHost === 'local-shell' ? t.terminal.localShellLabel : event.observedHost
        const message = t.terminal.terminalEnvironmentDrift
          .replace('{expected}', event.expectedHost)
          .replace('{observed}', observedLabel ?? '')
        appendSystemToRunOrLog(chatTabId, message)

        // Stop the agent run with the SYSTEM settle copy (never "manually
        // stopped") and remember the original input so recovery can continue it.
        const chatTab = tabsRef.current.find((tab) => tab.id === chatTabId)
        const runInput = activeRunInputRef.current.get(chatTabId)
        const activeRun = activeAgentRunRef.current.get(chatTabId)
        const reuseRun =
          activeRun && activeRun.runId && activeRunIdRef.current.get(chatTabId)
            ? { logId: activeRun.logId, runId: activeRun.runId }
            : undefined
        if (chatTab?.agentBusy || activeRunIdRef.current.has(chatTabId)) {
          await stopAgentRunRef.current?.(chatTabId, {
            reason: 'system-recovery',
            expectedHost: event.expectedHost,
            observedHost: event.observedHost
          })
        }

        // Recovery brakes: same drift event <= 1 attempt; 60s window <= 2.
        const decision = shouldAttemptRecovery(
          {
            alignment: 'drifted',
            ready: false,
            expectedHost: event.expectedHost,
            aliases: [],
            recovery: {
              driftKey: budget.driftKey,
              attempts: budget.attempts,
              windowStartAt: budget.windowStartAt
            }
          },
          driftKey
        )
        if (!decision.allowed) {
          budget.inFlight = false
          if (decision.reason !== 'aligned') {
            appendSystemToRunOrLog(chatTabId, t.terminal.terminalRecoveryCapReached)
            updateConnectionAttempt(chatTabId, (state) =>
              markConnectionFailed(state, { reason: t.terminal.terminalRecoveryCapReached })
            )
          }
          return
        }

        const recorded = recordRecoveryAttempt(
          {
            alignment: 'drifted',
            ready: false,
            expectedHost: event.expectedHost,
            aliases: [],
            recovery: {
              driftKey: budget.driftKey,
              attempts: budget.attempts,
              windowStartAt: budget.windowStartAt
            }
          },
          driftKey
        )
        budget.driftKey = recorded.recovery?.driftKey
        budget.attempts = recorded.recovery?.attempts ?? 1
        budget.windowStartAt = recorded.recovery?.windowStartAt ?? Date.now()

        const restored = await restoreTerminalSessionRef.current?.(event.tabId)
        budget.inFlight = false

        if (restored) {
          recoveryBudgetByTabRef.current.delete(chatTabId)
          if (runInput && reuseRun) {
            // Single continuation owner: drop stale post-login tasks and never
            // double-run when another run already took over this chat.
            postConnectionTasksRef.current.delete(event.tabId)
            const currentRunId = activeRunIdRef.current.get(chatTabId)
            if (currentRunId && currentRunId !== reuseRun.runId) return
            appendSystemToRunOrLog(
              chatTabId,
              t.terminal.terminalConnectionRecovered.replace('{input}', runInput)
            )
            const terminalTab = tabsRef.current.find((tab) => tab.id === event.tabId)
            await runAgentConversationRef.current?.(
              runInput,
              event.tabId,
              terminalTab?.connectionId,
              runInput,
              false,
              activeRun?.startedAt ?? Date.now(),
              { chatTabId, reuseRun }
            )
          } else if (runInput) {
            appendSystemToRunOrLog(
              chatTabId,
              t.terminal.terminalConnectionRecovered.replace('{input}', runInput)
            )
          }
        }
      })()
    })
  }, [appendSystemToRunOrLog, t, updateConnectionAttempt])

  useEffect(() => {
    localStorage.setItem('crescent.locale', locale)
    void appClient.setLocale(locale)
  }, [locale])

  useEffect(() => {
    return appClient.onOpenSettings(() => {
      setSheetOpen(true)
    })
  }, [])

  useEffect(() => {
    return appClient.onAttentionClicked((raw) => {
      const target = normalizeAttentionClickedPayload(raw)
      const jumpTabId = resolveAttentionJumpTabId(
        target,
        tabsRef.current.map((tab) => tab.id)
      )
      if (!jumpTabId) return

      selectSessionTab(jumpTabId)
      const chatTabId = resolveSessionChatTabId(tabsRef.current, jumpTabId)
      setActiveExecutionTerminal(chatTabId, jumpTabId)

      const passwordRequest = passwordPromptsByTabRef.current.get(jumpTabId)
      if (passwordRequest) {
        passwordPromptRequestRef.current = passwordRequest
        setPasswordPromptValue('')
        setPasswordPromptError('')
        setPasswordPromptRequest(passwordRequest)
      }
    })
  }, [
    passwordPromptRequestRef,
    passwordPromptsByTabRef,
    selectSessionTab,
    setPasswordPromptError,
    setPasswordPromptRequest,
    setPasswordPromptValue
  ])

  useEffect(() => {
    const unsubscribe = updateClient.onStatus((event) => {
      if (event.state === 'downloaded' && event.installerPath) {
        toast.success(t.app.updateSaved)
      }
    })
    if (!import.meta.env.DEV) {
      void updateClient.check()
    }
    return () => {
      unsubscribe()
    }
  }, [t.app.updateSaved])

  const syncActiveTerminalSize = useCallback((): void => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!terminal || !fitAddon) return
    fitAndSyncPty(terminal, fitAddon, activeTabIdRef.current)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(syncActiveTerminalSize, 40)
    return () => window.clearTimeout(timer)
  }, [terminalPanePercent, subterminalPanelHeight, syncActiveTerminalSize])

  useEffect(() => {
    localStorage.setItem(PANE_ORDER_STORAGE_KEY, paneOrder)
    window.requestAnimationFrame(() => syncActiveTerminalSize())
  }, [paneOrder, syncActiveTerminalSize])

  useEffect(() => {
    window.requestAnimationFrame(() => syncActiveTerminalSize())
  }, [workbenchLayout, syncActiveTerminalSize])

  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => {
    commandWhitelistTextRef.current = commandWhitelistText
  }, [commandWhitelistText])

  useEffect(() => {
    const handleConnectionShortcut = (event: globalThis.KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return

      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        showConnectionListRef.current()
        return
      }

      if (key === 't') {
        event.preventDefault()
        openNewConnectionFormRef.current()
      }
    }

    window.addEventListener('keydown', handleConnectionShortcut)

    return () => {
      window.removeEventListener('keydown', handleConnectionShortcut)
    }
  }, [])

  useEffect(() => {
    if (!tabMenu) return

    const closeMenu = (): void => setTabMenu(null)
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [tabMenu])

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
        window.requestAnimationFrame(() => syncActiveTerminalSize())
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
      window.requestAnimationFrame(() => syncActiveTerminalSize())
    }
    const handlePointerUp = (): void => {
      const resized = Boolean(
        splitDragRef.current || subterminalResizeRef.current || subterminalHeightResizeRef.current
      )
      splitDragRef.current = false
      subterminalResizeRef.current = null
      subterminalHeightResizeRef.current = null
      wikiSheetResizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (resized) window.requestAnimationFrame(() => syncActiveTerminalSize())
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    window.addEventListener('blur', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      window.removeEventListener('blur', handlePointerUp)
      handlePointerUp()
    }
  }, [
    paneOrder,
    resizeSubterminalPair,
    setSubterminalPanelHeight,
    setTerminalPanePercent,
    setWikiPreviewWidth,
    syncActiveTerminalSize
  ])

  const writeLine = useCallback((text: string): void => {
    terminalRef.current?.writeln(text.replace(/\n/g, '\r\n'))
  }, [])

  useEffect(() => {
    if (!isConnectionSlashQuery(slashCommandQuery)) return

    void connectionsClient
      .list()
      .then(setConnections)
      .catch((error) => {
        writeLine(`\x1b[31m${failedToLoadConnectionsText}: ${String(error)}\x1b[0m`)
      })
  }, [failedToLoadConnectionsText, slashCommandQuery, writeLine])

  useEffect(() => {
    if (!isWikiSlashQuery(slashCommandQuery)) return

    void agentClient
      .listWikiDocuments()
      .then(setWikiDocuments)
      .catch((error) => {
        setWikiMessage({
          type: 'error',
          text: error instanceof Error ? error.message : String(error)
        })
      })
  }, [setWikiDocuments, setWikiMessage, slashCommandQuery])

  useEffect(() => {
    document.documentElement.classList.add('dark')

    let cancelled = false

    agentClient
      .getConfig()
      .then((nextConfig) => {
        if (cancelled) return
        setConfig(nextConfig)
        setCommandWhitelistText((nextConfig.commandWhitelist ?? []).join('\n'))
        setModels(flattenProviderModels(nextConfig.providers))
        const firstProvider = nextConfig.providers[0]
        setSettingsProviderId(firstProvider?.id ?? '')
        setProviderModelsText(formatProviderModels(firstProvider?.models ?? []))
        const firstMcpServer = (nextConfig.mcpServers ?? [])[0]
        setSettingsMcpServerId(firstMcpServer?.id ?? '')
        if (!hasConfiguredModelSelection(nextConfig)) {
          setValidation(undefined)
          setValidating(false)
        }

        deferAfterFirstPaint(() => {
          if (cancelled) return

          agentClient
            .getModels()
            .then((models) => {
              if (cancelled) return
              setModels(models)

              if (!hasConfiguredModelSelection(nextConfig)) {
                setValidation(undefined)
                setValidating(false)
                return
              }

              const requestId = validationRequestRef.current + 1
              validationRequestRef.current = requestId
              setValidating(true)
              setValidation(undefined)
              void agentClient
                .validateConfig(nextConfig)
                .then((result) => {
                  if (validationRequestRef.current === requestId) setValidation(result)
                })
                .finally(() => {
                  if (validationRequestRef.current === requestId) setValidating(false)
                })
            })
            .catch((error) => {
              writeLine(`\x1b[31m${failedToLoadModelsText}: ${String(error)}\x1b[0m`)
            })

          void agentClient
            .listSkills()
            .then(setSkills)
            .catch(() => {
              setSkills([])
              toast.error(catalogLoadFailedText.replace('{resource}', 'skills'))
            })
          void agentClient
            .listInstructionFiles()
            .then((files) => {
              setInstructionFiles(files)
              setInstructionContent(
                files.find((file) => file.name === 'IDENTITY.md')?.content ?? ''
              )
            })
            .catch(() => {
              setInstructionFiles([])
              toast.error(catalogLoadFailedText.replace('{resource}', 'instruction files'))
            })
        })
      })
      .catch((error) => {
        writeLine(`\x1b[31m${failedToLoadConfigText}: ${String(error)}\x1b[0m`)
      })

    connectionsClient
      .list()
      .then((items) => {
        if (cancelled) return
        setConnections(items)
      })
      .catch((error) => {
        writeLine(`\x1b[31m${failedToLoadConnectionsText}: ${String(error)}\x1b[0m`)
      })

    return () => {
      cancelled = true
    }
  }, [
    catalogLoadFailedText,
    failedToLoadConfigText,
    failedToLoadConnectionsText,
    failedToLoadModelsText,
    setSkills,
    writeLine
  ])

  useEffect(() => {
    const unsubscribe = agentClient.onEvent((event) => {
      const eventTabId = event.tabId ?? activeTabIdRef.current
      const chatTabId = resolveSessionChatTabId(tabsRef.current, eventTabId)
      const visibleRunId =
        activeRunIdRef.current.get(chatTabId) ?? activeAgentRunRef.current.get(chatTabId)?.runId
      if (event.runId && visibleRunId && event.runId !== visibleRunId) return
      if (event.type === 'usage') {
        const hasTokenDelta =
          event.input > 0 ||
          event.output > 0 ||
          (event.cacheRead ?? 0) > 0 ||
          (event.cacheWrite ?? 0) > 0
        if (hasTokenDelta || event.contextWindow == null) {
          const usage = {
            input: event.input,
            output: event.output,
            cacheRead: event.cacheRead ?? 0,
            cacheWrite: event.cacheWrite ?? 0
          }
          if (event.runId) liveRunUsageRef.current.set(event.runId, usage)
          setLiveSessionUsageByTabId((current) => ({ ...current, [chatTabId]: usage }))
        }
        if (event.contextWindow != null) {
          setLiveContextUsageByTabId((current) => ({
            ...current,
            [chatTabId]: {
              tokens: event.contextTokens ?? null,
              contextWindow: event.contextWindow as number,
              percent: event.contextPercent ?? null
            }
          }))
        }
        return
      }
      if (event.type === 'status' && !activeAgentRunRef.current.has(chatTabId)) {
        appendSystemToRunOrLog(chatTabId, localizeAgentEventMessage(event.message, t))
        return
      }
      if (event.type === 'command' && event.phase === 'started' && event.runId && event.tabId) {
        if (!event.fromSubagent) {
          for (const [ownerTabId, runId] of activeRunIdRef.current) {
            if (runId === event.runId) {
              setActiveExecutionTerminal(ownerTabId, event.tabId)
              break
            }
          }
        }
      }
      appendAgentEvent(event, chatTabId)
    })

    return unsubscribe
  }, [appendAgentEvent, appendSystemToRunOrLog, t])

  useEffect(() => {
    return agentClient.onCommandApprovalRequest((request) => {
      const targetId = request.chatTabId ?? request.tabId
      const alive =
        isApprovalTargetAlive(request.tabId, tabsRef.current) ||
        isApprovalTargetAlive(request.chatTabId, tabsRef.current)
      if (!alive) {
        void agentClient.resolveCommandApproval({
          requestId: request.id,
          approved: false,
          rejectionReason: t.commandReview.sessionClosedRejection
        })
        return
      }

      const chatTabId = resolveSessionChatTabId(tabsRef.current, targetId ?? activeTabIdRef.current)
      attachApprovalRequest(chatTabId, request)
      pendingAttentionNotifierRef.current.notifyIfUnfocused(
        `approval:${request.id}`,
        t.notifications.approvalTitle,
        t.notifications.approvalBody,
        {
          runId: request.runId,
          tabId: request.tabId?.trim() || chatTabId,
          chatTabId
        }
      )
    })
  }, [attachApprovalRequest, t.commandReview.sessionClosedRejection, t.notifications])

  useEffect(() => {
    return agentClient.onCommandApprovalPurpose((payload) => {
      for (const [chatTabId, run] of activeAgentRunRef.current.entries()) {
        if (run.runId !== payload.runId) continue
        applyApprovalPurpose(chatTabId, payload.requestId, payload.purpose)
      }
    })
  }, [applyApprovalPurpose])

  useEffect(() => {
    return agentClient.onSubterminalOpened((payload) => {
      void (async () => {
        const chatTabId =
          payload.chatTabId?.trim() || resolveSessionChatTabId(tabsRef.current, payload.parentTabId)
        if (chatTabId && activeRunCanceledRef.current.has(chatTabId)) {
          void agentClient.ackSubterminalOpened({
            tabId: payload.tabId,
            ok: false,
            error: 'Agent run was canceled.'
          })
          return
        }

        const parentTab = tabsRef.current.find((tab) => tab.id === payload.parentTabId)
        const existing = parentTab?.subTerminals.find((item) => item.id === payload.tabId)
        const alreadyReady = Boolean(existing?.terminalReady && existing.status === 'active')

        ensureSubterminal(payload.parentTabId, {
          id: payload.tabId,
          name: payload.name,
          output: '',
          rawOutput: '',
          cwd: '',
          status: 'active',
          isSsh: payload.mode === 'ssh',
          terminalMode: payload.terminalMode,
          terminalReady: true,
          agentName: payload.agentName ?? existing?.agentName,
          agentStatus: payload.agentStatus ?? existing?.agentStatus
        })
        setSubterminalCollapsed(false)

        if (alreadyReady || payload.mode !== 'ssh' || !payload.connectionId) {
          void agentClient.ackSubterminalOpened({ tabId: payload.tabId, ok: true })
          return
        }

        try {
          if (chatTabId && activeRunCanceledRef.current.has(chatTabId)) {
            void agentClient.ackSubterminalOpened({
              tabId: payload.tabId,
              ok: false,
              error: 'Agent run was canceled.'
            })
            return
          }
          const refreshed = await connectionsClient.resolve(payload.connectionId)
          const fallback = connectionsRef.current.find((item) => item.id === payload.connectionId)
          const connection = refreshed
            ? mergeConnectionInput(refreshed, fallback ?? refreshed)
            : fallback
          if (!connection || isLocalConnection(connection)) {
            void agentClient.ackSubterminalOpened({
              tabId: payload.tabId,
              ok: false,
              error: `Connection ${payload.connectionId} not found or is local-only.`
            })
            return
          }
          const timeoutMessage = t.terminal.connectionLoginTimeout.replace(
            '{ms}',
            String(Math.round(CONNECTION_LOGIN_TOTAL_TIMEOUT_MS / 1000))
          )
          const ok = await runWithTimeout(
            executeConnectionAutomation(connection, payload.tabId, true),
            CONNECTION_LOGIN_TOTAL_TIMEOUT_MS,
            () => {
              void agentClient.ackSubterminalOpened({
                tabId: payload.tabId,
                ok: false,
                error: timeoutMessage
              })
            }
          )
          if (ok === true) {
            connTrace('subterminal-ssh-ok', `tab=${payload.tabId}`, `parent=${payload.parentTabId}`)
          }
          void agentClient.ackSubterminalOpened({
            tabId: payload.tabId,
            ok: ok === true,
            error:
              ok === true
                ? undefined
                : ok === undefined
                  ? timeoutMessage
                  : 'SSH login automation failed.'
          })
        } catch (error) {
          void agentClient.ackSubterminalOpened({
            tabId: payload.tabId,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      })()
    })
  }, [ensureSubterminal, executeConnectionAutomation, setSubterminalCollapsed, t])

  useEffect(() => {
    return agentClient.onSubagentStatus((payload) => {
      if (payload.close) {
        closeSubterminal(payload.parentTabId, payload.tabId)
        return
      }
      ensureSubterminal(payload.parentTabId, {
        id: payload.tabId,
        name: payload.name,
        agentName: payload.agentName,
        agentStatus: payload.agentStatus
      })
    })
  }, [closeSubterminal, ensureSubterminal])

  useEffect(() => {
    return agentClient.onCommandApprovalDismiss((payload) => {
      pendingAttentionNotifierRef.current.clear(`approval:${payload.requestId}`)
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
    return storageClient.onSessionSummaryUpdated((event) => {
      setHistoryItems((current) =>
        current.map((item) =>
          item.tabId === event.tabId
            ? { ...item, title: event.title, summary: event.summary, updatedAt: event.updatedAt }
            : item
        )
      )
    })
  }, [setHistoryItems])

  const activeLiveRun = useMemo(() => {
    const entries = activeTab?.agentLog ?? []
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]
      if (entry.kind === 'assistant' && liveRunByLogId[entry.id]) {
        return liveRunByLogId[entry.id]
      }
    }
    return undefined
  }, [activeTab?.agentLog, liveRunByLogId])

  const attentionTabIds = useMemo(() => {
    const clarifyTabIds = tabs
      .filter((tab) => Boolean(tab.pendingClarification) && !tab.pendingClarification?.settled)
      .map((tab) => tab.id)
    return collectAttentionTabIds({
      passwordTabIds: passwordAttentionTabIds,
      pendingApprovalTabIds: pendingApprovalTabIdsFromRuns(Object.values(liveRunByLogId)),
      clarifyTabIds
    })
  }, [liveRunByLogId, passwordAttentionTabIds, tabs])

  const newUserInputForScroll = useMemo(() => {
    const entries = activeTab?.agentLog ?? []
    const lastEntry = entries[entries.length - 1]
    return Boolean(lastEntry && (lastEntry.kind === 'user' || lastEntry.kind === 'user-supplement'))
  }, [activeTab?.agentLog])

  const { followNow: followAgentLog } = useScrollFollow(
    agentLogRef,
    [activeTab?.agentLog, activeTab?.agentThinking, activeTab?.thinkingMessage, activeLiveRun],
    { forceFollow: newUserInputForScroll }
  )

  const activeTabExists = tabs.some((tab) => tab.id === activeTabId)
  const executionTerminalId = executionTerminalByChatId[sessionChatTab.id]
  const sessionLiveRun = useMemo(() => {
    const entries = sessionChatTab.agentLog ?? []
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]
      if (entry.kind === 'assistant' && liveRunByLogId[entry.id]) {
        return liveRunByLogId[entry.id]
      }
    }
    return undefined
  }, [sessionChatTab.agentLog, liveRunByLogId])
  const runningCommandTabId = findRunningPtyCommandTabId(sessionLiveRun?.steps, executionTerminalId)
  const terminalInputLocked = isTerminalPaneLocked({
    tabId: activeTabId,
    executionTerminalId,
    agentBusy: sessionChatTab.agentBusy
  })

  useTerminalOutputRing()

  useXtermLifecycle({
    terminalVisible,
    inputLocked: terminalInputLocked,
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
    ptyRetryTriedRef,
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

  // Local tabs stay "Shell starting" if the terminal pane is hidden (xterm never mounts).
  useEffect(() => {
    const tab = tabsRef.current.find((candidate) => candidate.id === activeTabId)
    if (!tab) return
    if (tab.connectionId || tab.sessionId || tab.terminalReady || tab.terminalStartError) return
    let cancelled = false
    void (async () => {
      try {
        const session = await terminalClient.start({
          cols: 80,
          rows: 24,
          tabId: tab.id
        })
        if (cancelled) return
        updateTab(tab.id, (current) => ({
          ...current,
          sessionId: session.sessionId,
          terminalMode: session.mode,
          terminalCwd: session.cwd,
          terminalReady: true,
          terminalStartError: undefined
        }))
        if (tab.id === activeTabIdRef.current) {
          terminalSessionIdRef.current = session.sessionId
          terminalModeRef.current = session.mode
          if (terminalRef.current) applyTerminalConvertEol(terminalRef.current, session.mode)
          terminalCwdRef.current = session.cwd
          pipePromptRef.current = formatPipePrompt(session.cwd)
        }
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        updateTab(tab.id, (current) => ({
          ...current,
          sessionId: undefined,
          terminalReady: false,
          terminalStartError: message
        }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeTabId, updateTab])

  async function saveInstructionFile(): Promise<void> {
    const savedFile = await agentClient.saveInstructionFile({
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

  async function reloadApplicationRuntime(): Promise<void> {
    const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    updateTab(chatTabId, (tab) => applyComposerInput(tab, ''))
    setSlashCommandIndex(0)
    setSlashCommandOpen(false)
    const loadingToast = toast.loading(t.input.slashReload)
    try {
      const result = await agentClient.reloadRuntime({ sessionKey: chatTabId })
      const nextConfig = await agentClient.getConfig()
      setConfig(nextConfig)
      setCommandWhitelistText((nextConfig.commandWhitelist ?? []).join('\n'))
      setModels(flattenProviderModels(nextConfig.providers))
      const loadCatalog = async <T,>(
        resource: string,
        loader: () => Promise<T>,
        fallback: T
      ): Promise<T> => {
        try {
          return await loader()
        } catch {
          toast.error(catalogLoadFailedText.replace('{resource}', resource))
          return fallback
        }
      }
      const [nextSkills, nextWiki, nextFiles, nextConnections, nextModels] = await Promise.all([
        loadCatalog('skills', () => agentClient.listSkills(), [] as AgentSkillOption[]),
        loadCatalog('wiki', () => agentClient.listWikiDocuments(), [] as WikiDocumentSummary[]),
        loadCatalog(
          'instruction files',
          () => agentClient.listInstructionFiles(),
          [] as LocalInstructionDocument[]
        ),
        loadCatalog('connections', () => connectionsClient.list(), [] as ConnectionConfig[]),
        loadCatalog('models', () => agentClient.getModels(), [] as AgentModelOption[])
      ])
      setSkills(nextSkills)
      setWikiDocuments(nextWiki)
      setInstructionFiles(nextFiles)
      setConnections(nextConnections)
      if (nextModels.length) setModels(nextModels)
      if (hasConfiguredModelSelection(nextConfig)) {
        const requestId = validationRequestRef.current + 1
        validationRequestRef.current = requestId
        setValidating(true)
        void agentClient
          .validateConfig(nextConfig)
          .then((validationResult) => {
            if (validationRequestRef.current === requestId) setValidation(validationResult)
          })
          .finally(() => {
            if (validationRequestRef.current === requestId) setValidating(false)
          })
      }
      toast.dismiss(loadingToast)
      if (result.skippedBusy > 0) {
        toast.message(t.capture.reloadBusy.replace('{n}', String(result.skippedBusy)))
      } else {
        toast.success(t.capture.reloadOk)
      }
    } catch (error) {
      toast.dismiss(loadingToast)
      toast.error(
        `${t.capture.reloadFailed}: ${error instanceof Error ? error.message : String(error)}`,
        { duration: TOAST_INTERVENTION_DURATION_MS }
      )
    }
  }

  async function compactCurrentSession(instructions?: string): Promise<void> {
    const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    const tab = tabsRef.current.find((candidate) => candidate.id === chatTabId)
    if (tab?.agentBusy || contextCompactingByTabId[chatTabId]) {
      toast.error(t.input.compactBusy)
      return
    }

    setContextCompactingByTabId((current) => ({ ...current, [chatTabId]: true }))
    const loadingToast = toast.loading(t.input.slashCompact)
    try {
      const result = await agentClient.compact({
        sessionKey: chatTabId,
        tabId: chatTabId,
        instructions,
        locale
      })
      if (!result.ok) {
        const message = result.busy
          ? t.input.compactBusy
          : result.error === 'No live session to compact.'
            ? t.input.compactNoSession
            : result.error || t.input.compactFailed
        toast.error(message, { id: loadingToast })
        return
      }
      toast.success(t.input.compactSucceeded, { id: loadingToast })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error), { id: loadingToast })
    } finally {
      setContextCompactingByTabId((current) => {
        if (!current[chatTabId]) return current
        const next = { ...current }
        delete next[chatTabId]
        return next
      })
    }
  }

  async function saveAgentConfig(nextConfigInput: AgentConfig): Promise<AgentConfig> {
    const nextConfig = await agentClient.saveConfig(nextConfigInput)
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
    return nextConfig
  }

  async function toggleWhaleMonitor(): Promise<void> {
    try {
      const current = await whaleMonitorClient.getSnapshot()
      const enabled = !whaleEnabled
      await whaleMonitorClient.saveSettings({ ...current.settings, enabled })
      setWhaleEnabled(enabled)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function selectWhaleModel(modelId: string): Promise<void> {
    const provider =
      config.providers.find(
        (candidate) => candidate.id === activeProviderId && candidate.enabled
      ) ??
      config.providers.find(
        (candidate) => candidate.id === config.providerId && candidate.enabled
      ) ??
      config.providers.find((candidate) => candidate.enabled)
    if (!provider) {
      toast.error(
        locale === 'en'
          ? 'Configure an enabled model provider first.'
          : '请先配置并启用一个模型供应商。'
      )
      return
    }
    const models = provider.models.some((model) => model.id === modelId)
      ? provider.models
      : [...provider.models, { id: modelId, name: modelId, reasoning: false }]
    try {
      const nextConfig = await saveAgentConfig({
        ...config,
        providerId: provider.id,
        model: modelId,
        providers: config.providers.map((candidate) =>
          candidate.id === provider.id ? { ...candidate, models } : candidate
        )
      })
      updateTab(sessionChatTab.id, (tab) => ({
        ...tab,
        providerId: provider.id,
        model: modelId
      }))
      void validateConfig(nextConfig)
      toast.success(locale === 'en' ? `Selected ${modelId}` : `已选择模型 ${modelId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function openHistorySession(item: StoredSessionHistoryItem): Promise<void> {
    const detail = await storageClient.getSessionHistory(item.tabId)
    if (!detail) return

    const connection = detail.connectionId
      ? await findConnectionById(detail.connectionId)
      : undefined
    const restoredLogs = trimAgentLogEntries(
      detail.logs.map(hydrateStoredAgentLog),
      AGENT_LOG_SOFT_LIMIT
    )
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
      agentStyle: detail.agentStyle,
      executionMode: normalizeExecutionMode(detail.executionMode),
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
    setWorkbenchLayout((current) => revealChatFromTerminalLayout(current))

    if (connection) {
      const liveTabId = existingTab?.id ?? restoredTab.id
      const activeSession = tabsRef.current.find((tab) => tab.id === liveTabId)?.sessionId
      if (!activeSession) {
        pendingSshRef.current.set(liveTabId, connection)
      }
    }
  }

  useEffect(() => {
    if (recoveryMode !== 'pending') return
    let cancelled = false
    void (async () => {
      try {
        const items = await storageClient.listSessionHistory(1)
        if (cancelled) return
        const latest = items[0]
        if (latest) {
          await openHistorySession(latest)
        }
        toast.message(t.notifications.rendererRecoveredTitle, {
          description: t.notifications.rendererRecoveredBody
        })
      } catch (error) {
        console.error('[renderer-recovery] failed to restore session', error)
      } finally {
        if (!cancelled) {
          void appClient.clearRendererRecovery()
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // Intentionally once on mount for pending recovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryMode])

  async function findConnectionById(id: string): Promise<ConnectionConfig | undefined> {
    let candidates = connections

    try {
      candidates = await connectionsClient.list()
      setConnections(candidates)
    } catch {
      candidates = connections
    }

    return candidates.find((connection) => connection.id === id)
  }

  async function importOpenApiDocument(): Promise<void> {
    setImportingOpenApi(true)
    try {
      const result = await agentClient.importOpenApiDocument()
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

  function applyConversationStyle(style: AgentStyle): void {
    updateTab(sessionChatTab.id, (tab) => ({
      ...tab,
      agentStyle: normalizeAgentStyle(style)
    }))
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
      void settleAgentCancel(runId).finally(() => {
        if (activeRunIdRef.current.get(chatTabId) !== runId) return
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
      })
      return
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
      void agentClient.rejectApprovalsForTab(tabId)
      passwordPromptsByTabRef.current.delete(tabId)
      passwordPromptOpenTabsRef.current.delete(tabId)
    }
    if (closedTabIds.length > 0) {
      const closed = new Set(closedTabIds)
      setPasswordAttentionTabIds((current) => current.filter((id) => !closed.has(id)))
    }

    if (
      passwordPromptRequestRef.current &&
      closedTabIds.includes(passwordPromptRequestRef.current.tabId)
    ) {
      showNextPasswordPrompt()
    }
  }

  function persistAgentRun(run: StoredAgentRun): void {
    const live = liveRunUsageRef.current.get(run.runId)
    void storageClient
      .saveAgentRun({
        ...run,
        inputTokens: run.inputTokens ?? live?.input,
        outputTokens: run.outputTokens ?? live?.output,
        cacheReadTokens: run.cacheReadTokens ?? live?.cacheRead,
        cacheWriteTokens: run.cacheWriteTokens ?? live?.cacheWrite
      })
      .then(async () => {
        if (run.status === 'running') return
        const totals = await storageClient.getSessionTokenUsage(run.tabId)
        liveRunUsageRef.current.delete(run.runId)
        setSessionUsageBaselineByTabId((current) => ({ ...current, [run.tabId]: totals }))
        setLiveSessionUsageByTabId((current) => {
          if (!(run.tabId in current)) return current
          const next = { ...current }
          delete next[run.tabId]
          return next
        })
      })
      .catch(() => {
        // Persistence is best-effort; the next session load will refresh totals.
      })
  }

  function interruptAgentCommand(tabId: string): void {
    const target = tabId.trim()
    if (!target) return
    void terminalClient.interrupt(target)
  }

  function stopAgentRun(
    tabId = activeTabIdRef.current,
    options: { reason?: RunStopReason; expectedHost?: string; observedHost?: string } = {}
  ): void | Promise<void> {
    const chatTabId = resolveSessionChatTabId(tabsRef.current, tabId)
    const reason = resolveRunStopReason({
      userInitiated: !options.reason || options.reason === 'user',
      driftBlocked: options.reason === 'gate-interrupt',
      recoveryInFlight: options.reason === 'system-recovery',
      timedOut: options.reason === 'timeout'
    })
    const stopText = settleStopText(reason, t, {
      expectedHost: options.expectedHost,
      observedHost: options.observedHost
    })
    activeRunCanceledRef.current.add(chatTabId)
    const runId = activeRunIdRef.current.get(chatTabId)
    if (runId) {
      updateAgentRun(chatTabId, (run) => ({
        ...run,
        error: stopText,
        elapsedMs: Date.now() - (run.startedAt ?? Date.now()),
        steps: settleRunningToolStepsAsInterrupted(run.steps ?? [])
      }))
      const canceledRun = activeAgentRunRef.current.get(chatTabId)
      void persistAgentRun({
        runId,
        tabId: chatTabId,
        input: activeRunInputRef.current.get(chatTabId) ?? '',
        status: 'canceled',
        output: canceledRun?.result,
        error: stopText,
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
          error: stopText
        })
      })
      // Keep UI busy until Pi session abort settles so the next prompt cannot race
      // into the SDK "Agent is already processing" guard on a reused session.
      // A system stop (recovery/drift/timeout) keeps the run view alive so the
      // recovery path can reuse the same card and auto-continue the original task.
      const settle = settleAgentCancel(runId).finally(() => {
        if (activeRunIdRef.current.get(chatTabId) !== runId) return
        // A resumed run (recovery auto-continue) clears the cancel flag before
        // this settle lands; never clobber its UI state.
        if (reason !== 'user' && !activeRunCanceledRef.current.has(chatTabId)) return
        setActiveExecutionTerminal(chatTabId, null)
        updateTab(chatTabId, (tab) => ({
          ...tab,
          agentBusy: false,
          agentThinking: false,
          thinkingMessage: undefined
        }))
        if (reason === 'user') {
          activeAgentRunRef.current.delete(chatTabId)
          activeRunIdRef.current.delete(chatTabId)
          activeRunInputRef.current.delete(chatTabId)
        }
      })
      return reason === 'user' ? undefined : settle.then(() => undefined)
    }
    setActiveExecutionTerminal(chatTabId, null)
    updateTab(chatTabId, (tab) => ({
      ...tab,
      agentBusy: false,
      agentThinking: false,
      thinkingMessage: undefined
    }))
    if (reason === 'user') {
      activeAgentRunRef.current.delete(chatTabId)
      activeRunIdRef.current.delete(chatTabId)
      activeRunInputRef.current.delete(chatTabId)
    }
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
    pendingAttentionNotifierRef.current.clear(`approval:${requestId}`)
    void agentClient.resolveCommandApproval({
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
      const nextConfig = await agentClient.saveConfig({
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

  async function restoreTerminalSession(tabId: string): Promise<boolean> {
    const tab = tabsRef.current.find((current) => current.id === tabId)
    if (!tab) return false

    if (skipConnectionReconnectRef.current.delete(tabId)) {
      return restoreLocalTerminal(tabId)
    }

    // Recovery brake #1: read SSOT first. Live PTY already on target -> nothing to do.
    const context = await terminalClient.getContext(tabId)
    if (context.mode !== 'none' && context.alignment === 'aligned' && !context.restoring) {
      connTrace('restore-cancel', `tab=${tabId}`, 'already aligned')
      return true
    }

    return tab.connectionId ? restoreTerminalConnection(tabId) : restoreLocalTerminal(tabId)
  }

  async function restoreLocalTerminal(tabId: string): Promise<boolean> {
    if (reconnectingTabsRef.current.has(tabId)) return waitForTerminalRestore(tabId)

    reconnectingTabsRef.current.add(tabId)
    const chatTabId = resolveSessionChatTabId(tabsRef.current, tabId)
    appendSystemToRunOrLog(chatTabId, t.terminal.terminalReconnecting)
    if (!tabsRef.current.find((current) => current.id === tabId)?.connectionId) {
      void terminalClient.setExpectedHost({ tabId, host: null })
    }

    try {
      const dimensions =
        tabId === activeTabIdRef.current ? fitAddonRef.current?.proposeDimensions() : undefined
      const session = await terminalClient.start({
        cols: dimensions?.cols ?? 80,
        rows: dimensions?.rows ?? 24,
        tabId
      })
      updateTab(tabId, (current) => ({
        ...current,
        sessionId: session.sessionId,
        terminalMode: session.mode,
        terminalCwd: session.cwd,
        terminalReady: true,
        terminalStartError: undefined
      }))
      if (tabId === activeTabIdRef.current) {
        terminalSessionIdRef.current = session.sessionId
        terminalModeRef.current = session.mode
        if (terminalRef.current) applyTerminalConvertEol(terminalRef.current, session.mode)
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
        terminalReady: false,
        terminalStartError: message
      }))
      return false
    } finally {
      reconnectingTabsRef.current.delete(tabId)
    }
  }

  async function restoreTerminalConnection(tabId: string): Promise<boolean> {
    if (reconnectingTabsRef.current.has(tabId)) {
      return waitForTerminalRestore(tabId, { requireSshReady: true })
    }

    const tab = tabsRef.current.find((current) => current.id === tabId)
    if (!tab?.connectionId) return false

    reconnectingTabsRef.current.add(tabId)
    const chatTabId = resolveSessionChatTabId(tabsRef.current, tabId)
    appendSystemToRunOrLog(chatTabId, t.terminal.terminalReconnecting)

    try {
      const connection = await findConnectionById(tab.connectionId)
      if (!connection) {
        throw new Error(`${t.history.connectionMissing}: ${tab.connectionName ?? tab.connectionId}`)
      }

      // Reuse the same login chain as /connect and the retry card: fresh PTY
      // spawn (hard timeout) + normal login automation (overall timeout) +
      // post-login task drain. No separate reconnect path that can deadlock.
      const ok = await spawnAndLoginConnection(connection, tabId)
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
        terminalReady: false,
        terminalStartError: message
      }))
      return false
    } finally {
      reconnectingTabsRef.current.delete(tabId)
    }
  }

  async function waitForTerminalRestore(
    tabId: string,
    options?: { requireSshReady?: boolean }
  ): Promise<boolean> {
    const deadline = Date.now() + 90_000
    const requireSshReady = options?.requireSshReady === true

    while (Date.now() < deadline) {
      const context = await terminalClient.getContext(tabId)
      const live = hasLiveTerminalSession(context.mode)
      const sshReady = live && context.ready === true && !context.restoring
      if (requireSshReady ? sshReady : live) return true
      if (!reconnectingTabsRef.current.has(tabId)) {
        return requireSshReady ? sshReady : live
      }
      await sleep(500)
    }

    return false
  }

  function activateTerminalTab(tabId: string): void {
    activeTabIdRef.current = tabId
    flushSync(() => {
      setActiveTabId(tabId)
      setTerminalPage('terminal')
    })
    const chatTabId = resolveSessionChatTabId(tabsRef.current, tabId)
    setActiveExecutionTerminal(chatTabId, tabId)
  }

  async function connectToConnection(
    connection: ConnectionConfig,
    postLoginInput?: string,
    postLoginDisplayInput?: string,
    postLoginConversationContext?: string,
    postLoginAppendUserLog = true,
    postLoginStartedAt = Date.now(),
    reuseRun?: ReuseAgentRun,
    postLoginRefs?: { activeWikiIds?: string[]; activeSkillPaths?: string[] }
  ): Promise<string> {
    const currentTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
    const resolution = resolveConnectTargetTab({
      currentTab,
      connectionId: connection.id,
      tabs: tabsRef.current
    })
    connTrace('connect', `connection=${connection.id}`, `resolution=${resolution.kind}`)

    let targetTabId = currentTab?.id ?? ''
    let targetTab = currentTab
    let forceFreshLogin = false
    let statusLabel: string | undefined

    void connectionsClient.setLastUsed(connection.id).catch(() => undefined)

    if (resolution.kind === 'reuse') {
      targetTabId = resolution.tab.id
      targetTab = resolution.tab
      forceFreshLogin = resolution.forceFreshLogin
      updateTab(resolution.tab.id, (tab) => ({
        ...tab,
        connectionId: connection.id,
        connectionName: connection.name,
        isSsh: true
      }))
      statusLabel = t.terminal.switchedToConnection.replace('{name}', connection.name)
    } else if (resolution.kind === 'create-peer' && currentTab) {
      if (currentTab.sessionGroupId !== resolution.sessionGroupId) {
        updateTab(currentTab.id, (tab) => ({ ...tab, sessionGroupId: resolution.sessionGroupId }))
      }
      const nextTab = createTerminalTab({
        title: getNextTerminalTitle(connection.name, tabsRef.current),
        sessionGroupId: resolution.sessionGroupId,
        providerId: currentTab.providerId ?? config.providerId,
        model: currentTab.model,
        agentStyle: currentTab.agentStyle,
        executionMode: normalizeExecutionMode(currentTab.executionMode),
        connectionId: connection.id,
        connectionName: connection.name,
        isSsh: true
      })
      targetTabId = nextTab.id
      targetTab = nextTab
      setTabs((current) => {
        const next = [...current, nextTab]
        tabsRef.current = next
        return next
      })
      statusLabel = t.terminal.switchedToConnection.replace('{name}', connection.name)
    } else if (resolution.kind === 'create-new' || !currentTab) {
      const nextTab = createTerminalTab({
        title: getNextTerminalTitle(connection.name, tabsRef.current),
        providerId: config.providerId,
        agentStyle: config.agentStyle,
        connectionId: connection.id,
        connectionName: connection.name,
        isSsh: true
      })
      targetTabId = nextTab.id
      targetTab = nextTab
      setTabs((current) => {
        const next = [...current, nextTab]
        tabsRef.current = next
        return next
      })
      statusLabel = t.terminal.switchedToConnection.replace('{name}', connection.name)
    } else {
      // convert-current (local / non-SSH → SSH)
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
      targetTabId = currentTab.id
      targetTab = currentTab
      statusLabel = t.terminal.switchedToConnection.replace('{name}', connection.name)
    }

    activateTerminalTab(targetTabId)

    if (statusLabel) {
      const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTabId)
      const chatTab = tabsRef.current.find((tab) => tab.id === chatTabId)
      const previousStatus = [...(chatTab?.agentLog ?? [])]
        .reverse()
        .find((entry) => entry.kind === 'status')?.text
      if (shouldAppendSwitchedEntry(previousStatus, statusLabel)) {
        appendSystemToRunOrLog(chatTabId, statusLabel)
      }
    }

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
          reuseRun,
          activeWikiIds: postLoginRefs?.activeWikiIds,
          activeSkillPaths: postLoginRefs?.activeSkillPaths
        }
      ])
    }

    const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTabId)
    updateConnectionAttempt(chatTabId, (state) =>
      beginConnectionRetry(state, `conn-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    )

    if (resolution.kind === 'reuse') {
      if (reconnectingTabsRef.current.has(targetTabId)) {
        connTrace('connect-wait-restore', `tab=${targetTabId}`)
        const restored = await waitForTerminalRestore(targetTabId, { requireSshReady: true })
        if (restored) {
          markChatTabReady(chatTabId)
          finalizeLoginRun(chatTabId, true, undefined, { targetTabId, connection })
          if (postConnectionTasksRef.current.get(targetTabId)?.length) {
            drainPostConnectionTasks(targetTabId)
          }
          return targetTabId
        }
      }
      // Same-tab retry / “恢复连接”: always spawn a fresh PTY and type ssh.
      // Skip-relogin and remaining-login must not reuse a stale promptHost.
      if (forceFreshLogin) {
        connTrace('reuse-force-fresh-login', `tab=${targetTabId}`, `connection=${connection.id}`)
        reconnectingTabsRef.current.add(targetTabId)
        try {
          await spawnAndLoginConnection(connection, targetTabId)
        } finally {
          reconnectingTabsRef.current.delete(targetTabId)
        }
      } else {
        // Recovery brake #2: never reinit + re-knock ssh on an already connected
        // terminal. Read the SSOT first; skip re-login when remaining commands
        // are empty (aligned / regex / ready remote / on-target aliases).
        const context = await terminalClient.getContext(targetTabId)
        const waitingForSecret = findNewestPromptSignal(context.output)?.kind === 'waiting'
        const onRemoteHost = Boolean(context.promptHost && context.promptHost !== 'local-shell')
        const liveSession = hasLiveTerminalSession(context.mode)
        const loginEnv = {
          promptHost: context.promptHost,
          alignment: context.alignment ?? context.sessionAligned,
          output: context.output,
          mode: context.mode,
          ready: context.ready,
          aliases: context.aliases,
          returnToJumpHost: context.returnToJumpHost,
          preferSshCommand: false as const
        }
        if (liveSession && !waitingForSecret && shouldSkipReuseRelogin(connection, loginEnv)) {
          connTrace(
            'connect-reuse-skip-relogin',
            `tab=${targetTabId}`,
            `promptHost=${context.promptHost ?? '-'}`,
            `aligned=${context.alignment ?? context.sessionAligned ?? '-'}`,
            `ready=${context.ready ? 'yes' : 'no'}`
          )
          markChatTabReady(chatTabId)
          finalizeLoginRun(chatTabId, true, undefined, { targetTabId, connection })
          if (postConnectionTasksRef.current.get(targetTabId)?.length) {
            drainPostConnectionTasks(targetTabId)
          }
        } else if (liveSession && (onRemoteHost || waitingForSecret)) {
          connTrace(
            'reuse-remaining-login',
            `tab=${targetTabId}`,
            `connection=${connection.id}`,
            `promptHost=${context.promptHost ?? '-'}`,
            `waiting=${waitingForSecret}`
          )
          await executeConnectionCommands(connection, targetTabId)
        } else {
          connTrace('reuse-login', `tab=${targetTabId}`, `connection=${connection.id}`)
          // Same SSH tab re-login: stop the old PTY, spawn a fresh one inline and
          // run the normal login chain, awaited. The xterm lifecycle effect does
          // NOT re-run for the same active tab, so deferring the spawn to
          // pendingSshRef left the reconnect with no PTY, no login, no settle.
          // Mark the tab as reconnecting BEFORE stopping: the stop fires
          // terminal:exit, whose handler would otherwise start a SECOND
          // restore+login chain concurrently (two pasted ssh commands, two
          // password prompts). With the mark in place it waits for our spawn.
          reconnectingTabsRef.current.add(targetTabId)
          try {
            await spawnAndLoginConnection(connection, targetTabId)
          } finally {
            reconnectingTabsRef.current.delete(targetTabId)
          }
        }
      }
    } else if (!forceFreshLogin && targetTab?.sessionId) {
      void executeConnectionCommands(connection, targetTabId)
    } else {
      pendingSshRef.current.set(targetTabId, connection)
    }

    return targetTabId
  }

  /**
   * Shared reconnect login chain used by both the connection entry point
   * (connectToConnection reuse) and the drift/exit restore path. Spawns a fresh
   * PTY (10s hard timeout), then runs the normal login automation (90s overall
   * timeout) and drains any post-login agent task. Never throws.
   */
  async function spawnAndLoginConnection(
    connection: ConnectionConfig,
    tabId: string
  ): Promise<boolean> {
    const chatTabId = resolveSessionChatTabId(tabsRef.current, tabId)
    let ok = false
    try {
      const dimensions =
        tabId === activeTabIdRef.current ? fitAddonRef.current?.proposeDimensions() : undefined
      connTrace('teardown', `tab=${tabId}`)
      await terminalClient.teardownGracefully({ tabId })
      connTrace('spawn', `tab=${tabId}`)
      let session = await runWithTimeout(
        terminalClient.start({
          cols: dimensions?.cols ?? 80,
          rows: dimensions?.rows ?? 24,
          tabId
        }),
        CONNECTION_SPAWN_TIMEOUT_MS,
        () => {
          connTrace('spawn-timeout', `tab=${tabId}`)
          appendLog({ kind: 'error', text: t.terminal.terminalSpawnTimeout }, chatTabId)
        }
      )
      if (!session) {
        updateConnectionAttempt(chatTabId, (state) =>
          markConnectionFailed(state, { reason: t.terminal.terminalSpawnTimeout })
        )
        updateTab(tabId, (tab) => ({
          ...tab,
          sessionId: undefined,
          terminalReady: false,
          terminalStartError: t.terminal.terminalSpawnTimeout
        }))
        return false
      }

      // node-pty failure falls back to PIPE; auto-reinit once before settling
      // on the fallback so transient PTY failures self-heal.
      if (session.mode === 'pipe' && !ptyRetryTriedRef.current.has(tabId)) {
        ptyRetryTriedRef.current.add(tabId)
        session = await runWithTimeout(
          terminalClient.start({
            cols: dimensions?.cols ?? 80,
            rows: dimensions?.rows ?? 24,
            tabId
          }),
          CONNECTION_SPAWN_TIMEOUT_MS,
          () => {
            connTrace('spawn-timeout-retry', `tab=${tabId}`)
          }
        )
        if (!session) {
          updateConnectionAttempt(chatTabId, (state) =>
            markConnectionFailed(state, { reason: t.terminal.terminalSpawnTimeout })
          )
          return false
        }
      }

      updateTab(tabId, (tab) => ({
        ...tab,
        sessionId: session.sessionId,
        terminalMode: session.mode,
        terminalCwd: session.cwd,
        terminalReady: false,
        terminalExited: false,
        terminalStartError: undefined
      }))
      if (tabId === activeTabIdRef.current) {
        terminalSessionIdRef.current = session.sessionId
        terminalModeRef.current = session.mode
        if (terminalRef.current) applyTerminalConvertEol(terminalRef.current, session.mode)
        terminalCwdRef.current = session.cwd
        pipePromptRef.current = formatPipePrompt(session.cwd)
      }
      connTrace('spawned', `tab=${tabId}`, `mode=${session.mode}`, `sid=${session.sessionId}`)
      ok = await executeConnectionCommands(connection, tabId)
      return ok
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      connTrace('spawn-failed', `tab=${tabId}`, `err=${message}`)
      updateConnectionAttempt(chatTabId, (state) =>
        markConnectionFailed(state, { reason: message })
      )
      appendLog({ kind: 'error', text: message }, chatTabId)
      updateTab(tabId, (tab) => ({
        ...tab,
        sessionId: undefined,
        terminalReady: false,
        terminalStartError: message
      }))
      return false
    } finally {
      if (!ok) void terminalClient.clearRestoring(tabId)
    }
  }

  async function retryActiveConnection(): Promise<void> {
    const targetTab =
      tabsRef.current.find((tab) => tab.id === activeTabIdRef.current) ??
      tabsRef.current.find((tab) => tab.id === sessionChatTab.id)
    const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTab?.id ?? sessionChatTab.id)
    const connectionId =
      targetTab?.connectionId ||
      sessionTerminals.find((tab) => tab.connectionId)?.connectionId ||
      sessionChatTab.connectionId
    if (!connectionId) {
      showConnectionList()
      return
    }

    // Synchronous idempotency guard (before any await): one attempt per click
    // burst; an in-flight retry ignores further clicks.
    if (retryInFlightRef.current.has(chatTabId)) return
    const state = connectionAttemptByChatTab[chatTabId] ?? createIdleConnectionAttempt()
    // Feasibility gate: SSH login needs PTY; PIPE fallback retry would always fail.
    if (!canAttemptConnection({ state, terminalMode: targetTab?.terminalMode, needsPty: true })) {
      if (state.phase !== 'connecting' && targetTab?.terminalMode === 'pipe') {
        updateConnectionAttempt(chatTabId, (current) =>
          markConnectionFailed(current, {
            reason: t.input.pipeRetryUnavailable,
            pipeFallback: true
          })
        )
      }
      return
    }

    retryInFlightRef.current.add(chatTabId)

    const connection = await findConnectionById(connectionId)
    if (!connection) {
      retryInFlightRef.current.delete(chatTabId)
      updateConnectionAttempt(chatTabId, (current) =>
        markConnectionFailed(current, { reason: t.history.connectionMissing })
      )
      showConnectionList()
      return
    }

    if (targetTab?.id) {
      skipConnectionReconnectRef.current.delete(targetTab.id)
    }
    try {
      void connectToConnection(connection)
    } catch (error) {
      retryInFlightRef.current.delete(chatTabId)
      updateConnectionAttempt(chatTabId, (current) =>
        markConnectionFailed(current, {
          reason: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }

  async function reconnectActiveTerminal(): Promise<void> {
    const targetTab =
      tabsRef.current.find((tab) => tab.id === activeTabIdRef.current) ??
      tabsRef.current.find((tab) => tab.id === sessionChatTab.id)
    if (!targetTab) return

    const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTab.id)
    setDismissedRecoveryByChatTab((current) => ({ ...current, [chatTabId]: false }))
    skipConnectionReconnectRef.current.delete(targetTab.id)

    const attempt = connectionAttemptByChatTab[chatTabId] ?? createIdleConnectionAttempt()
    if (attempt.pipeFallback || targetTab.terminalMode === 'pipe') {
      await reinitActiveTerminal()
      return
    }

    if (targetTab.connectionId) {
      await retryActiveConnection()
      return
    }

    if (attempt.phase === 'connecting' || reconnectingTabsRef.current.has(targetTab.id)) return
    updateConnectionAttempt(chatTabId, (current) =>
      beginConnectionRetry(current, `local-reconnect-${Date.now()}`)
    )
    const ok = await restoreLocalTerminal(targetTab.id)
    if (ok) {
      markChatTabReady(chatTabId)
      return
    }
    const failedTab = tabsRef.current.find((tab) => tab.id === targetTab.id)
    updateConnectionAttempt(chatTabId, (current) =>
      markConnectionFailed(current, {
        reason: failedTab?.terminalStartError?.trim() || t.terminal.terminalReconnectFailed
      })
    )
  }

  async function reinitActiveTerminal(): Promise<void> {
    const targetTab =
      tabsRef.current.find((tab) => tab.id === activeTabIdRef.current) ??
      tabsRef.current.find((tab) => tab.id === sessionChatTab.id)
    if (!targetTab) return

    const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTab.id)
    const current = connectionAttemptByChatTab[chatTabId] ?? createIdleConnectionAttempt()
    // Idempotent: one reinit at a time.
    if (current.phase === 'connecting') return
    updateConnectionAttempt(chatTabId, (current) =>
      beginConnectionRetry(current, `reinit-${Date.now()}`)
    )
    appendSystemToRunOrLog(chatTabId, t.terminal.reinitializingTerminal)

    try {
      const dimensions =
        targetTab.id === activeTabIdRef.current
          ? fitAddonRef.current?.proposeDimensions()
          : undefined
      void terminalClient.stop(targetTab.id)
      const session = await terminalClient.start({
        cols: dimensions?.cols ?? 80,
        rows: dimensions?.rows ?? 24,
        tabId: targetTab.id
      })
      updateTab(targetTab.id, (tab) => ({
        ...tab,
        sessionId: session.sessionId,
        terminalMode: session.mode,
        terminalCwd: session.cwd,
        terminalReady: true,
        terminalStartError: undefined
      }))
      updateConnectionAttempt(chatTabId, (current) =>
        markConnectionFailed(current, {
          reason: t.terminal.reinitTerminalReady,
          pipeFallback: session.mode === 'pipe'
        })
      )
    } catch (error) {
      updateConnectionAttempt(chatTabId, (current) =>
        markConnectionFailed(current, {
          reason: error instanceof Error ? error.message : String(error),
          pipeFallback: true
        })
      )
    }
  }

  function dismissConnectionRecovery(chatTabId: string): void {
    setDismissedRecoveryByChatTab((current) => ({ ...current, [chatTabId]: true }))
  }

  function viewConnectionRecovery(): void {
    followAgentLog(true)
  }

  function showConnectionList(): void {
    setSelectedConnectionId('')
    setConnectionFormOpen(false)
    setConnectionEditing(false)
    setConnectionModalOpen(true)
    void connectionsClient
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

  function startNewSession(): void {
    const previousChatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    const nextTab = createTerminalTab({
      title: getNextTerminalTitle(t.connections.localTerminal, tabsRef.current),
      providerId: config.providerId,
      agentStyle: config.agentStyle,
      isSsh: false
    })
    activateNewSession(nextTab, previousChatTabId)
  }

  async function createHandoffConversation(
    sourceId: string,
    goal: string,
    draft: string
  ): Promise<void> {
    if (!tabsRef.current.some((tab) => tab.id === sourceId)) throw new Error('Source closed')
    const nextTab = createTerminalTab({
      title: `${t.handoff.prefix}${goal.trim().replace(/\s+/g, ' ').slice(0, 48)}`,
      providerId: config.providerId,
      agentStyle: config.agentStyle,
      isSsh: false,
      agentInput: draft
    })
    // Existing storage contract saves tab metadata; composer text stays in memory.
    // Do not dismiss the editor or switch tabs until creation has been acknowledged.
    const saved = await storageClient.saveTabs(toStoredSessionTabs([...tabsRef.current, nextTab]))
    if (!saved?.ok) throw new Error('Could not save conversation')
    if (!tabsRef.current.some((tab) => tab.id === sourceId)) {
      await storageClient.saveTabs(toStoredSessionTabs(tabsRef.current))
      throw new Error('Source closed')
    }
    activateNewSession(nextTab)
    requestAnimationFrame(() => agentInputRef.current?.focus())
  }

  function activateNewSession(nextTab: AgentTerminalTab, previousChatTabId?: string): void {
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
      setWorkbenchLayout((current) => revealChatFromTerminalLayout(current))
      setTerminalPage('terminal')
      setTabs(nextTabs)
      setActiveTabId(nextTab.id)
    })
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
        agentStyle: currentTab.agentStyle,
        executionMode: normalizeExecutionMode(currentTab.executionMode),
        isSsh: false
      })
      setTabs((current) => {
        const next = [...current, nextTab]
        tabsRef.current = next
        return next
      })
      activateTerminalTab(nextTab.id)
      appendLog(
        {
          kind: 'status',
          text: `${t.terminal.openedPeerTerminal}: ${t.connections.localTerminal}`
        },
        resolveSessionChatTabId(tabsRef.current, nextTab.id)
      )
      return
    }

    void connectToConnection(connection)
  }

  function openConnectionTerminal(connection: ConnectionConfig): void {
    if (isLocalConnection(connection)) {
      openLocalTerminal()
      return
    }

    // The terminal lifecycle owns PTY startup and consumes pendingSshRef.
    // A connection-manager modal can be opened from the chat-only layout, where
    // TerminalPane is otherwise unmounted and the queued login never starts.
    setWorkbenchLayout('split')
    setTerminalPage('terminal')

    const nextTab = createTerminalTab({
      title: getNextTerminalTitle(connection.name, tabsRef.current),
      providerId: config.providerId,
      agentStyle: config.agentStyle,
      connectionId: connection.id,
      connectionName: connection.name,
      isSsh: true
    })

    // Queue the connection before mounting xterm. The xterm lifecycle consumes
    // this only after terminal.start() has created the PTY, which is the
    // ordering used by the 1.0.11 connection flow.
    pendingSshRef.current.set(nextTab.id, connection)
    setTabs((current) => {
      const next = [...current, nextTab]
      tabsRef.current = next
      return next
    })
    activateTerminalTab(nextTab.id)
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
    const opened = await terminalClient.openSubterminal({
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
    const opened = await terminalClient.openSubterminal({
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
    setWorkbenchLayout((current) => revealChatFromTerminalLayout(current))
    setTerminalPage('terminal')
    appendLog(
      { kind: 'status', text: `${t.terminal.openedSubterminal}: ${connection.name}` },
      resolveSessionChatTabId(tabsRef.current, parentTab.id)
    )
    void runWithTimeout(
      executeConnectionAutomation(connection, opened.tabId, true),
      CONNECTION_LOGIN_TOTAL_TIMEOUT_MS,
      () => {
        const timeoutMessage = t.terminal.connectionLoginTimeout.replace(
          '{ms}',
          String(Math.round(CONNECTION_LOGIN_TOTAL_TIMEOUT_MS / 1000))
        )
        appendLog(
          { kind: 'error', text: timeoutMessage },
          resolveSessionChatTabId(tabsRef.current, parentTab.id)
        )
      }
    )
  }

  function connectFromConnectionManager(connection: ConnectionConfig): void {
    if (connectionActionBusyRef.current) return
    connectionActionBusyRef.current = true
    setConnectionActionBusy(true)
    const releaseBusy = (): void => {
      connectionActionBusyRef.current = false
      setConnectionActionBusy(false)
    }

    try {
      if (isLocalConnection(connection)) {
        openLocalTerminal()
        if (connectionModalOpen) setConnectionModalOpen(false)
        releaseBusy()
        return
      }

      // A connection-card click means “open a terminal for this connection”.
      // Keep each login isolated in its own tab and release the UI guard as
      // soon as that tab is queued; SSH/authentication must not lock out other
      // clusters while it waits for a prompt or recovery.
      openConnectionTerminal(connection)
      if (connectionModalOpen) setConnectionModalOpen(false)
      releaseBusy()
    } catch {
      releaseBusy()
    }
  }

  function connectFromConnectionCard(connection: ConnectionConfig): void {
    setConnectionSearchQuery('')
    connectFromConnectionManager(connection)
  }

  function openNewConnectionForm(): void {
    resetConnectionForm()
    setConnectionModalOpen(true)
  }

  showConnectionListRef.current = showConnectionList
  openNewConnectionFormRef.current = openNewConnectionForm

  async function saveConnection(
    connectAfterSave = false,
    options?: { overwriteExistingId?: string }
  ): Promise<void> {
    if (connectionActionBusyRef.current) return

    try {
      const normalizedInput = normalizeConnectionInputForSave(
        connectionForm,
        connectionActionsText,
        connectionSshOptionsText
      )
      if (!normalizedInput.ok) {
        setConnectionSaveMessage({
          type: 'error',
          text: formatConnectionSaveError(normalizedInput, t)
        })
        return
      }

      const input = normalizedInput.value.id
        ? normalizedInput.value
        : { ...normalizedInput.value, id: createCustomConnectionId() }

      const conflict = findCustomConnectionNameConflict(connections, input)
      if (conflict && options?.overwriteExistingId !== conflict.id) {
        setConnectionNameConflict({
          existingId: conflict.id,
          name: conflict.name.trim(),
          connectAfterSave
        })
        setConnectionEditing(true)
        setConnectionSaveMessage({
          type: 'error',
          text: t.connections.nameConflict.replace('{name}', conflict.name.trim())
        })
        return
      }

      const overwrite = conflict
        ? applyConnectionNameOverwrite(input, conflict.id)
        : { input, deleteId: undefined }

      connectionActionBusyRef.current = true
      setConnectionActionBusy(true)
      setConnectionSaveMessage(null)

      try {
        let nextConnections = await connectionsClient.save(overwrite.input)
        if (overwrite.deleteId) {
          nextConnections = await connectionsClient.delete(overwrite.deleteId)
        }
        setConnections(nextConnections)
        setConnectionNameConflict(null)
        const fallbackConnection: ConnectionConfig = {
          ...overwrite.input,
          id: overwrite.input.id ?? '',
          source: 'custom'
        }
        const savedConnection = mergeConnectionInput(
          nextConnections.find((connection) => connection.id === overwrite.input.id),
          fallbackConnection
        )

        setConnectionSaveMessage({
          type: 'success',
          text: connectAfterSave
            ? t.connections.saveAndConnectSucceeded
            : t.connections.saveSucceeded
        })

        if (savedConnection?.id) {
          await syncClusterHostRegexToLiveTabs(savedConnection.id, savedConnection.clusterHostRegex)
        }

        if (connectAfterSave && savedConnection) {
          if (isLocalConnection(savedConnection)) {
            openLocalTerminal()
          } else {
            await openConnectionTerminal(savedConnection)
          }
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
      } finally {
        connectionActionBusyRef.current = false
        setConnectionActionBusy(false)
      }
    } catch (error) {
      setConnectionSaveMessage({
        type: 'error',
        text: `${t.connections.saveFailed}: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }

  async function syncClusterHostRegexToLiveTabs(
    connectionId: string,
    clusterHostRegex: string | undefined
  ): Promise<void> {
    const tabIds = new Set<string>()
    for (const tab of tabsRef.current) {
      if (tab.connectionId === connectionId) tabIds.add(tab.id)
      for (const sub of tab.subTerminals) {
        if (sub.connectionId === connectionId) tabIds.add(sub.id)
      }
    }
    await Promise.all(
      [...tabIds].map((tabId) =>
        terminalClient
          .patchClusterHostRegex({
            tabId,
            clusterHostRegex: clusterHostRegex ?? null
          })
          .catch(() => undefined)
      )
    )
  }

  async function deleteConnection(id: string): Promise<void> {
    if (!window.confirm(t.confirm.deleteConnection)) return

    const nextConnections = await connectionsClient.delete(id)
    setConnections(nextConnections)
    if (connectionForm.id === id) closeConnectionForm()
  }

  async function toggleConnectionFavorite(id: string): Promise<void> {
    try {
      const nextConnections = await connectionsClient.toggleFavorite(id)
      setConnections(nextConnections)
    } catch (error) {
      setConnectionSaveMessage({
        type: 'error',
        text: `${t.connections.saveFailed}: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }

  async function reorderConnectionList(
    id: string,
    action: 'up' | 'down' | 'top' | 'bottom'
  ): Promise<void> {
    try {
      const nextConnections = await connectionsClient.reorder({ id, action })
      setConnections(nextConnections)
    } catch (error) {
      setConnectionSaveMessage({
        type: 'error',
        text: `${t.connections.saveFailed}: ${error instanceof Error ? error.message : String(error)}`
      })
    }
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
      candidates = await connectionsClient.list()
      setConnections(candidates)
    } catch {
      candidates = connections
    }

    try {
      const analysis = await agentClient.resolveConnectionIntent({
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
  const { submitAgent, submitAgentMessage, runAgentConversation } = useAgentController({
    activeTabIdRef,
    tabsRef,
    startNewSession,
    reloadApplicationRuntime,
    updateTab,
    applyComposerInput,
    compactCurrentSession,
    startCaptureFromCurrentSession,
    t,
    activeRunIdRef,
    appendLog,
    pendingPostLoginSupplementsRef,
    updateAgentRun,
    updateConnectionAttempt,
    connections,
    resolveConnectionIntentForInput,
    setActiveExecutionTerminal,
    appendStatusToActiveRunOrLog,
    pendingAttentionNotifierRef,
    activeRunCanceledRef,
    activeRunInputRef,
    activeAgentRunRef,
    persistAgentRun,
    skipStoredPasswordTabsRef,
    connectToConnection,
    lastLoginRunLogIdRef,
    fitAddonRef,
    terminalSessionIdRef,
    terminalModeRef,
    terminalCwdRef,
    pipePromptRef,
    config,
    visibleModels,
    activeExecutionTabIdRef,
    locale,
    sessionAgentStyle,
    updateLogEntryText,
    pruneLiveRuns
  })

  function slashReplacementCursor(input: string): number {
    return getSlashCommandQuery(input, composerCaret) !== undefined ? composerCaret : input.length
  }

  runAgentConversationRef.current = runAgentConversation

  function applyComposerInput(
    tab: AgentTerminalTab,
    value: string,
    extras: Partial<AgentTerminalTab> = {}
  ): AgentTerminalTab {
    const merged = { ...tab, ...extras, agentInput: value }
    const ids = collectComposerRefIds(value)
    return {
      ...merged,
      skillRefs: merged.skillRefs.filter((item) => ids.skill.has(item.id)),
      wikiRefs: merged.wikiRefs.filter((item) => ids.wiki.has(item.id)),
      toolRefs: merged.toolRefs.filter((item) => ids.tool.has(item.id)),
      pathRefs: merged.pathRefs.filter((item) => ids.path.has(item.id)),
      activeWikiIds: (merged.activeWikiIds ?? []).filter((id) => ids.wiki.has(id))
    }
  }
  function applyComposerSlashReplacement(
    tab: AgentTerminalTab,
    replacement: string,
    extras: Partial<AgentTerminalTab> = {}
  ): AgentTerminalTab {
    const next = replaceSlashCommandInput(
      tab.agentInput,
      replacement,
      slashReplacementCursor(tab.agentInput)
    )
    setComposerCaret(caretAfterProgrammaticValueChange(tab.agentInput, next))
    return applyComposerInput(tab, next, extras)
  }

  function handleAgentInputKeyDown(event: KeyboardEvent<HTMLElement>): void {
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

      if (isComposerSubmitEnter(event)) {
        event.preventDefault()
        insertSlashCommand(slashCommandOptions[selectedSlashCommandIndex])
        return
      }
    }

    if (isComposerNewlineEnter(event)) return
    if (!isComposerSubmitEnter(event)) return

    event.preventDefault()
    event.currentTarget.closest('form')?.requestSubmit()
  }

  async function handleAgentInputPaste(event: ReactClipboardEvent<HTMLElement>): Promise<void> {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return

    event.preventDefault()
    const references = await Promise.all(files.map(resolvePastedFileReference))
    const validReferences = references.filter((reference): reference is AgentPathReference =>
      Boolean(reference)
    )
    if (validReferences.length === 0) return

    updateTab(resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current), (tab) => {
      let nextInput = tab.agentInput
      let cursor = slashReplacementCursor(nextInput)
      let pathRefs = tab.pathRefs
      for (const reference of validReferences) {
        nextInput = insertComposerRefTokenAt(nextInput, cursor, 'path', reference.id)
        const token = formatComposerRefToken('path', reference.id)
        cursor = nextInput.indexOf(token, Math.max(0, cursor - 1)) + token.length
        pathRefs = addUniquePathRef(pathRefs, reference)
      }
      return applyComposerInput(tab, nextInput, { pathRefs })
    })
  }

  function insertSlashCommand(command: SlashCommandOption): void {
    const shouldOpenStyleList = command.id === 'style'
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

    if (command.id === 'reload') {
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      void reloadApplicationRuntime()
      return
    }

    if (command.id === 'create-skill' || command.id === 'create-sop') {
      updateTab(sessionChatTab.id, (tab) => applyComposerSlashReplacement(tab, ''))
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      void startCaptureFromCurrentSession(
        command.id === 'create-skill' ? 'skill' : 'sop',
        'session'
      )
      return
    }

    if (command.pathReferenceKind) {
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      void pickPathReference(command.pathReferenceKind)
      return
    }

    if (command.toolRef) {
      const toolRef = command.toolRef as AgentToolReference
      updateTab(sessionChatTab.id, (tab) =>
        applyComposerSlashReplacement(tab, formatComposerRefToken('tool', toolRef.id), {
          toolRefs: addUniqueToolRef(tab.toolRefs, toolRef)
        })
      )
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
      const wikiRef = command.wikiRef as AgentWikiReference
      updateTab(sessionChatTab.id, (tab) => {
        const ids = tab.activeWikiIds ?? []
        return applyComposerSlashReplacement(tab, formatComposerRefToken('wiki', wikiRef.id), {
          activeWikiIds: ids.includes(wikiRef.id) ? ids : [...ids, wikiRef.id],
          wikiRefs: addUniqueWikiRef(tab.wikiRefs, {
            id: wikiRef.id,
            title: wikiRef.title,
            path: wikiRef.path,
            content: ''
          })
        })
      })
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      return
    }

    if (command.agentStyle) {
      applyConversationStyle(command.agentStyle)
      updateTab(sessionChatTab.id, (tab) => applyComposerSlashReplacement(tab, ''))
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      return
    }

    if (command.connection) {
      updateTab(sessionChatTab.id, (tab) => applyComposerSlashReplacement(tab, ''))
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      void connectToConnection(command.connection)
      return
    }

    updateTab(sessionChatTab.id, (tab) => {
      const replacement = command.skill
        ? formatComposerRefToken('skill', command.skill.id)
        : (command.templateInput ?? command.value)
      return applyComposerSlashReplacement(
        tab,
        replacement,
        command.skill ? { skillRefs: addUniqueSkillRef(tab.skillRefs, command.skill) } : {}
      )
    })
    setSlashCommandIndex(0)
    setSlashCommandOpen(
      shouldOpenStyleList ||
        shouldOpenSkillList ||
        shouldOpenConnectionList ||
        shouldOpenToolList ||
        shouldOpenMcpList ||
        shouldOpenWikiList
    )
  }

  function removeToolRef(toolId: string): void {
    updateTab(sessionChatTab.id, (tab) =>
      applyComposerInput(tab, removeComposerRefToken(tab.agentInput, 'tool', toolId))
    )
  }

  function removeWikiRef(wikiId: string): void {
    updateTab(sessionChatTab.id, (tab) =>
      applyComposerInput(tab, removeComposerRefToken(tab.agentInput, 'wiki', wikiId))
    )
  }

  async function addWikiReference(document: WikiDocumentSummary): Promise<void> {
    updateTab(sessionChatTab.id, (tab) => {
      const ids = tab.activeWikiIds ?? []
      return applyComposerSlashReplacement(tab, formatComposerRefToken('wiki', document.id), {
        activeWikiIds: ids.includes(document.id) ? ids : [...ids, document.id],
        wikiRefs: addUniqueWikiRef(tab.wikiRefs, {
          id: document.id,
          title: document.title,
          path: document.path,
          content: ''
        })
      })
    })
  }

  async function pickPathReference(kind: AgentPathReference['kind']): Promise<void> {
    const reference = await agentClient.pickPathReference(kind)
    if (!reference) return

    updateTab(sessionChatTab.id, (tab) => {
      const cursor = slashReplacementCursor(tab.agentInput)
      const nextInput =
        getSlashCommandQuery(tab.agentInput, cursor) !== undefined
          ? replaceSlashCommandInput(
              tab.agentInput,
              formatComposerRefToken('path', reference.id),
              cursor
            )
          : insertComposerRefTokenAt(tab.agentInput, cursor, 'path', reference.id)
      setComposerCaret(caretAfterProgrammaticValueChange(tab.agentInput, nextInput))
      return applyComposerInput(tab, nextInput, {
        pathRefs: addUniquePathRef(tab.pathRefs, reference)
      })
    })
  }

  function removePathRef(pathRefId: string): void {
    updateTab(sessionChatTab.id, (tab) =>
      applyComposerInput(tab, removeComposerRefToken(tab.agentInput, 'path', pathRefId))
    )
  }

  function updateConfig<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]): void {
    setConfig((current) => ({ ...current, [key]: value }))
    setValidation(undefined)
  }

  function updateConnectionForm<K extends keyof ConnectionInput>(
    key: K,
    value: ConnectionInput[K]
  ): void {
    if (key === 'name') setConnectionNameConflict(null)
    setConnectionForm((current) => ({ ...current, [key]: value }))
  }

  function resetConnectionForm(): void {
    setConnectionForm(createEmptyConnectionForm())
    setConnectionSshOptionsText('')
    setConnectionActionsText('')
    setConnectionImportText('')
    setConnectionSaveMessage(null)
    setConnectionNameConflict(null)
    setSelectedConnectionId('')
    setConnectionEditing(true)
    setConnectionFormOpen(true)
  }

  function closeConnectionForm(): void {
    setConnectionForm(createEmptyConnectionForm())
    setConnectionSshOptionsText('')
    setConnectionActionsText('')
    setConnectionImportText('')
    setConnectionSaveMessage(null)
    setConnectionNameConflict(null)
    setSelectedConnectionId('')
    setConnectionEditing(false)
    setConnectionFormOpen(false)
  }

  function loadConnectionIntoForm(connection: ConnectionConfig, editing: boolean): void {
    setConnectionForm(connectionToForm(connection))
    setConnectionSshOptionsText(connection.sshOptions?.join('\n') ?? '')
    setConnectionActionsText(connection.actions?.join('\n') ?? '')
    setSelectedConnectionId(connection.id)
    setConnectionEditing(editing)
    setConnectionFormOpen(true)
    setConnectionNameConflict(null)
  }

  function selectConnection(connection: ConnectionConfig): void {
    if (selectedConnectionId === connection.id && connectionFormOpen) {
      setSelectedConnectionId('')
      setConnectionFormOpen(false)
      setConnectionEditing(false)
      return
    }
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
    setConnectionFormOpen(true)
  }

  async function copyConnection(connection: ConnectionConfig): Promise<void> {
    await copyText(
      JSON.stringify(toConnectionClipboardPayload(connection), null, 2),
      copyFeedback(t)
    )
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
        rootPassword: parsed.rootPassword,
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
      setConnectionFormOpen(true)
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
    terminalClient.stop(tabId)
    closingTab?.subTerminals.forEach((subterminal) => {
      suppressTerminalReconnectRef.current.add(subterminal.id)
      terminalClient.stop(subterminal.id)
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
        } else if (next.length === 0) {
          // Closing the last tab must not strand the chat input on the
          // module-level emptyLocalTab (its id is absent from `tabs`, so the
          // controlled agentInput could never update). Keep one real local tab.
          const localTab = createTerminalTab({ title: 'Terminal' })
          next = [localTab]
          activeTabIdRef.current = localTab.id
          setActiveTabId(localTab.id)
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
        terminalClient.stop(tab.id)
        tab.subTerminals.forEach((subterminal) => {
          suppressTerminalReconnectRef.current.add(subterminal.id)
          terminalClient.stop(subterminal.id)
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
      terminalClient.stop(tab.id)
      tab.subTerminals.forEach((subterminal) => {
        suppressTerminalReconnectRef.current.add(subterminal.id)
        terminalClient.stop(subterminal.id)
      })
      pendingSshRef.current.delete(tab.id)
    }

    cancelAgentRunsOutsideTabs([])
    rejectApprovalsForClosedTabs(closedTabIds)

    // Keep one real local tab so the chat input always has a live host tab;
    // an empty tab list would strand the input on the module-level
    // emptyLocalTab where controlled updates silently no-op.
    const localTab = createTerminalTab({ title: 'Terminal' })
    setTabs([localTab])
    activeTabIdRef.current = localTab.id
    setActiveTabId(localTab.id)
    setTerminalPage('terminal')
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
    await copyText(
      getSelectedTextWithinLog(entry.id) ||
        stripComposerRefTokens(decodeUserMessageText(entry.text).text),
      copyFeedback(t)
    )
    updateTab(tabId, (tab) => ({ ...tab, copiedLogId: entry.id }))
    window.setTimeout(() => {
      updateTab(tabId, (tab) => ({
        ...tab,
        copiedLogId: tab.copiedLogId === entry.id ? null : tab.copiedLogId
      }))
    }, 1200)
  }

  async function resolveLogEntryResultMarkdown(entry: AgentLogEntry): Promise<string> {
    const extracted = extractResultMarkdown(entry.text, t) || entry.text
    const tabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    try {
      const runs = await storageClient.listAgentRuns({ tabId, limit: 40 })
      const storedRun =
        runs.find(
          (run) =>
            run.output?.trim() &&
            extracted.trim() &&
            (run.output.trim() === extracted.trim() ||
              run.output.trim().startsWith(extracted.trim().slice(0, 256)))
        ) ??
        runs.find(
          (run) =>
            Math.abs(Date.parse(run.startedAt ?? '') - Date.parse(entry.createdAt)) < 5 * 60_000
        )
      return resolveFullAgentResultMarkdown(
        extracted,
        storedRun?.output?.trim() || storedRun?.error?.trim()
      )
    } catch {
      return extracted
    }
  }

  async function copyLogEntryResult(entry: AgentLogEntry): Promise<void> {
    const tabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    await copyText(await resolveLogEntryResultMarkdown(entry), copyFeedback(t))
    updateTab(tabId, (tab) => ({ ...tab, copiedLogId: entry.id }))
    window.setTimeout(() => {
      updateTab(tabId, (tab) => ({
        ...tab,
        copiedLogId: tab.copiedLogId === entry.id ? null : tab.copiedLogId
      }))
    }, 1200)
  }

  function exportLogEntryResultMarkdown(entry: AgentLogEntry): void {
    void (async () => {
      await downloadMarkdown(
        await resolveLogEntryResultMarkdown(entry),
        buildLogMarkdownFilename(entry, 'result'),
        t
      )
    })()
  }

  function exportLogEntryFullMarkdown(entry: AgentLogEntry): void {
    void downloadMarkdown(entry.text, buildLogMarkdownFilename(entry), t)
  }

  async function exportLogEntryTrace(entry: AgentLogEntry): Promise<void> {
    const tabId = activeTabIdRef.current
    const runs = await storageClient.listAgentRuns({ tabId, limit: 40 })
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

  async function exportSessionTrace(): Promise<void> {
    const tabId = sessionChatTab.id
    const title = getSessionDisplayTitle(sessionChatTab, tabs, activeTab.id)
    const [runs, storedUsage] = await Promise.all([
      storageClient.listAllAgentRuns(tabId),
      storageClient.getSessionTokenUsage(tabId)
    ])
    const bundle = buildAgentSessionTrace({
      tabId,
      title,
      runs,
      usage: addSessionTokenUsage(
        storedUsage,
        liveSessionUsageByTabId[tabId] ?? EMPTY_SESSION_TOKEN_USAGE
      )
    })
    await downloadJson(serializeAgentSessionTrace(bundle), buildSessionTraceFilename(), t)
  }

  const skillSheet = (
    <SkillManager
      open={skillOpen}
      onOpenChange={setSkillOpen}
      t={t}
      skillRoot={config.skillRoot}
      loadGlobalAgentSkills={config.loadGlobalAgentSkills}
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
      onLoadGlobalAgentSkillsChange={(checked) => {
        void persistAgentConfigPatch({ loadGlobalAgentSkills: checked }).then(async () => {
          setSkills(await agentClient.listSkills())
        })
      }}
      onLocalSkillSearchQueryChange={setLocalSkillSearchQuery}
      onSkillSearchQueryChange={setSkillSearchQuery}
      onRefreshSkills={() => void refreshSkills()}
      onImportSkills={() => void importSkillFromDisk()}
      onSearchSkills={() => void searchSkills()}
      onInstallSkill={(result) => void installSkill(result)}
      onCancelSkillInstall={(resultId) => void cancelSkillInstall(resultId)}
      onCopySkillInstallCommand={(result) => void copySkillInstallCommand(result)}
      onCopySelectedSkillInstallLog={() => void copySelectedSkillInstallLog()}
      onDeleteSkill={(skill) => void deleteSkill(skill)}
      onPreviewSkill={(skill) => void previewSkill(skill)}
      onPreviewCatalogSkill={(result) => void previewCatalogSkill(result)}
      onDeleteSkillInstallLog={deleteSkillInstallLog}
      onSelectedSkillPreviewChange={setSelectedSkillPreview}
      onSkillInstallLogResultIdChange={setSkillInstallLogResultId}
    />
  )

  const mcpSheet = (
    <McpServersSheet
      open={mcpOpen}
      onOpenChange={setMcpOpen}
      t={t}
      servers={config.mcpServers}
      selectedServerId={settingsMcpServerId}
      validation={validation}
      validating={validating}
      saved={saved}
      onServersChange={updateSettingsMcpServers}
      onSelectedServerIdChange={setSettingsMcpServerId}
      onSave={saveMcpServers}
    />
  )

  const historySheet = (
    <HistoryPanel
      open={historyOpen}
      onOpenChange={setHistorySheetOpen}
      t={t}
      loading={historyLoading}
      error={historyError}
      items={historyItems}
      titleEditingId={historyTitleEditingId}
      titleDraft={historyTitleDraft}
      titleSavingId={historyTitleSavingId}
      savingWikiTabId={savingHistoryWikiTabId}
      savingSkillTabId={savingHistorySkillTabId}
      onTitleDraftChange={setHistoryTitleDraft}
      onRefresh={() => void refreshSessionHistory()}
      onOpenSession={(item) => void openHistorySession(item)}
      onStartRename={startRenameHistorySession}
      onCancelRename={cancelRenameHistorySession}
      onSaveTitle={(item) => void saveHistorySessionTitle(item)}
      onSaveToWiki={(item) => void saveHistorySessionToWiki(item)}
      onSaveToSkill={(item) => void saveHistorySessionToSkill(item)}
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
      wikiDirectory={wikiDirectory}
      wikiDirectoryChanging={wikiDirectoryChanging}
      onRefresh={() => void refreshWikiDocuments()}
      onChooseDirectory={() => void chooseWikiDirectory()}
      onResetDirectory={() => void resetWikiDirectory()}
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
      <Toaster
        theme="dark"
        closeButton
        position="top-right"
        offset={56}
        gap={8}
        toastOptions={{
          classNames: {
            toast: 'border border-border bg-card text-foreground shadow-lg shadow-black/20',
            title: 'text-foreground',
            description: 'text-muted-foreground',
            closeButton: 'border-border bg-card text-muted-foreground'
          }
        }}
      />
      <header className="app-titlebar flex h-12 shrink-0 items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ProductLogo />
          <span className="text-sm font-semibold tracking-tight text-pretty">Crescent</span>
        </div>
        <div className="app-commandbar flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t.connections.manageConnections}
            title={t.connections.manageConnections}
            onClick={showConnectionList}
          >
            <ServerIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t.settings.mcpServers}
            title={t.settings.mcpServers}
            onClick={() => setMcpOpen(true)}
          >
            <PlugIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t.settings.skillsManagement}
            title={t.settings.skillsManagement}
            onClick={() => setSkillOpen(true)}
          >
            <BotIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t.history.title}
            title={t.history.title}
            onClick={() => setHistorySheetOpen(true)}
          >
            <HistoryIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t.wiki.title}
            title={t.wiki.title}
            onClick={() => setWikiSheetOpen(true)}
          >
            <BookOpenIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
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
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="w-auto min-w-8 gap-1 px-1.5"
            aria-label={`${t.app.language}: ${localeOptions.find((option) => option.value === locale)?.label ?? locale}`}
            title={localeOptions.find((option) => option.value === nextLocale(locale))?.label}
            onClick={() => setLocale(nextLocale(locale))}
          >
            <LanguagesIcon aria-hidden="true" />
            <span className="text-[10px] font-medium tracking-wide text-muted-foreground">
              {localeOptions.find((option) => option.value === locale)?.shortLabel}
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={
              whaleEnabled
                ? locale === 'en'
                  ? 'Hide whale pet'
                  : '隐藏桌宠'
                : locale === 'en'
                  ? 'Show whale pet'
                  : '显示桌宠'
            }
            title={
              whaleEnabled
                ? locale === 'en'
                  ? 'Hide whale pet'
                  : '隐藏桌宠'
                : locale === 'en'
                  ? 'Show whale pet'
                  : '显示桌宠'
            }
            onClick={() => void toggleWhaleMonitor()}
          >
            <WhalePetPortrait />
          </Button>
          <ThemeSwitcher t={t} />
          <Button
            id="settings-trigger"
            variant="ghost"
            size="icon"
            aria-label={t.settings.title}
            title={t.settings.title}
            onClick={() => setSheetOpen(true)}
          >
            <SettingsIcon className="size-4" />
          </Button>
          {sheetOpen && (
            <Suspense fallback={null}>
              <SettingsSheet
                open={sheetOpen}
                onOpenChange={(open) => {
                  setSheetOpen(open)
                  if (!open) {
                    flushWorkspaceCwdPersist()
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
                saved={saved}
                importingOpenApi={importingOpenApi}
                closeTerminalConfirmEnabled={closeTerminalConfirmEnabled}
                workbenchLayout={workbenchLayout}
                onWorkbenchLayoutChange={persistAndSetWorkbenchLayout}
                onCreateProvider={createProvider}
                onToggleProviderDetails={toggleProviderDetails}
                onToggleProviderEnabled={toggleProviderEnabled}
                onDeleteProvider={deleteSettingsProvider}
                onApplyDefaultModel={applyDefaultModel}
                onCloseTerminalConfirmChange={setCloseTerminalConfirmEnabled}
                onAgentStyleChange={persistAgentStyle}
                onThinkingLevelChange={(level) =>
                  void persistAgentConfigPatch({ thinkingLevel: level })
                }
                onLogLevelChange={(level) => void persistAgentConfigPatch({ logLevel: level })}
                onShowAgentThinkingChange={persistShowAgentThinking}
                onWorkspaceCwdChange={scheduleWorkspaceCwdPersist}
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
              />
            </Suspense>
          )}
        </div>
      </header>
      {skillOpen && <Suspense fallback={null}>{skillSheet}</Suspense>}
      {mcpOpen && <Suspense fallback={null}>{mcpSheet}</Suspense>}
      {historyOpen && <Suspense fallback={null}>{historySheet}</Suspense>}
      {wikiOpen && <Suspense fallback={null}>{wikiSheet}</Suspense>}
      <CaptureDraftDialog
        open={Boolean(captureDialogJob)}
        kind={captureDialogJob?.kind ?? captureDialogKind ?? 'sop'}
        t={t}
        title={captureDialogJob?.title ?? ''}
        content={captureDialogJob?.content ?? ''}
        skillName={captureDialogJob?.skillName ?? ''}
        notes={captureDialogJob?.notes ?? ''}
        overwrite={captureDialogJob?.overwrite ?? false}
        generating={captureDialogJob?.generating ?? false}
        refining={captureDialogJob?.refining ?? false}
        committing={captureDialogJob?.committing ?? false}
        error={captureDialogJob?.error ?? null}
        conflict={captureDialogJob?.conflict ?? false}
        onOpenChange={(open) => {
          if (!open) setCaptureDialogKind(null)
        }}
        onFlush={(fields) => patchDialogCaptureJob(fields)}
        onOverwriteChange={(overwrite) => patchDialogCaptureJob({ overwrite })}
        onRefine={(fields) => void refineCaptureDraft(fields)}
        onCommit={(fields) => void commitCaptureDraft(fields)}
      />
      <section
        className={`app-frame relative flex min-h-0 flex-1 ${terminalPaneFirst ? 'flex-row' : 'flex-row-reverse'}`}
      >
        {workbenchLayout === 'terminal' && (
          <button
            type="button"
            className="chat-pane-rail group absolute inset-y-0 right-2 z-20 my-auto flex h-28 w-8 items-center justify-center rounded-lg border border-border/70 bg-background shadow-sm transition-[width,border-color,background-color] duration-200 hover:w-9 hover:border-primary/40 hover:bg-accent"
            aria-label={t.app.showChat}
            title={t.app.showChat}
            onClick={() => persistAndSetWorkbenchLayout('split')}
          >
            <span className="flex flex-col items-center gap-2 text-muted-foreground transition-colors group-hover:text-foreground">
              <MessageSquareIcon className="h-4 w-4" aria-hidden="true" />
              <span className="text-[10px] font-medium tracking-[0.18em] [writing-mode:vertical-rl]">
                {t.app.chat}
              </span>
            </span>
          </button>
        )}
        {workbenchLayout !== 'chat' && (
          <TerminalPane
            widthPercent={terminalPanePercent}
            fillWidth={workbenchLayout === 'terminal'}
            terminalTabs={terminalTabs}
            labelTabs={tabs}
            terminalPage={terminalPage}
            activeTabId={activeTabId}
            executionTerminalId={executionTerminalByChatId[sessionChatTab.id]}
            agentPending={activeAgentPending}
            attentionTabIds={attentionTabIds}
            activeTab={activeTab}
            tabMenu={tabMenu}
            displayConnections={displayConnections}
            filteredDisplayConnections={filteredDisplayConnections}
            connectionSearchQuery={connectionSearchQuery}
            connectionActionBusy={connectionActionBusy}
            terminalHostRef={terminalHostRef}
            subterminalCollapsed={subterminalCollapsed}
            subterminalPanelHeight={subterminalPanelHeight}
            subterminalResizeRef={subterminalResizeRef}
            subterminalHeightResizeRef={subterminalHeightResizeRef}
            connectionRecovery={connectionRecovery}
            reconnecting={connectionRecovery.connecting}
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
            onConnect={connectFromConnectionCard}
            onSubterminalCollapsedChange={setSubterminalCollapsed}
            onCloseSubterminal={closeSubterminal}
            onCloseAllSubterminals={closeAllSubterminals}
            onOpenLocalSubterminal={() => void openLocalSubterminal()}
            onResizeSubterminalHeight={setSubterminalPanelHeight}
            onResizeSubterminalPair={resizeSubterminalPair}
            onInterruptCommand={interruptAgentCommand}
            commandRunning={Boolean(runningCommandTabId)}
            agentBusy={sessionChatTab.agentBusy}
            onReconnect={() => void reconnectActiveTerminal()}
            onViewRecovery={viewConnectionRecovery}
            onDismissRecovery={
              connectionRecovery.visible
                ? () => dismissConnectionRecovery(sessionChatTab.id)
                : undefined
            }
          />
        )}
        {workbenchLayout === 'split' && (
          <div
            className="app-pane-resizer w-1.5 shrink-0 cursor-col-resize outline-none focus-visible:ring-0"
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize terminal and chat panes"
            onPointerDown={(event) => {
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              splitDragRef.current = true
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
            }}
            onKeyDown={(event) => {
              const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
              if (!direction) return
              event.preventDefault()
              setTerminalPanePercent((current) =>
                Math.max(
                  35,
                  Math.min(
                    78,
                    current + (paneOrder === 'terminal-chat' ? direction : -direction) * 2
                  )
                )
              )
              window.requestAnimationFrame(() => syncActiveTerminalSize())
            }}
          />
        )}
        <ChangePlanReview tabId={sessionChatTab.id} t={t} />
        <HandoffDialog
          key={sessionChatTab.id}
          editor={handoff.editor}
          title={getSessionDisplayTitle(sessionChatTab, tabs)}
          cwd={handoff.status?.cwd}
          model={config.model}
          t={t}
          onGoal={handoff.setGoal}
          onDraft={handoff.setDraft}
          onGenerate={() => void handoff.generate()}
          onClose={handoff.close}
          onConfirm={() => void handoff.confirm()}
        />
        {workbenchLayout !== 'terminal' && (
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
            terminalHidden={workbenchLayout === 'chat'}
            terminalStartError={
              workbenchLayout === 'chat' ? activeTab?.terminalStartError?.trim() : undefined
            }
            activeModel={activeModel}
            activeModelSelectionValue={activeModelSelectionValue}
            activeTabModelId={activeTabModelId}
            visibleModels={visibleModels}
            aiState={aiState}
            aiStatusText={aiStatusText}
            modelValidationError={modelValidationError}
            executionMode={normalizeExecutionMode(sessionChatTab.executionMode)}
            onExecutionModeChange={(mode) =>
              updateTab(sessionChatTab.id, (tab) => ({ ...tab, executionMode: mode }))
            }
            agentStyle={sessionAgentStyle}
            onAgentStyleChange={applyConversationStyle}
            thinkingCollapsedByDefault={
              !resolveShowAgentThinking(sessionAgentStyle, config.showAgentThinking)
            }
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
            onExportSessionTrace={() => void exportSessionTrace()}
            onCompactContext={() => void compactCurrentSession()}
            onHandoff={handoff.open}
            handoffDisabledReason={handoff.disabledReason}
            compactDisabled={
              sessionChatTab.agentBusy || Boolean(contextCompactingByTabId[sessionChatTab.id])
            }
            sessionInputTokens={sessionTokenUsage.input}
            sessionOutputTokens={sessionTokenUsage.output}
            sessionCacheReadTokens={sessionTokenUsage.cacheRead}
            sessionCacheWriteTokens={sessionTokenUsage.cacheWrite}
            contextPercent={sessionContextUsage?.percent}
            contextPending={sessionContextUsage != null && sessionContextUsage.tokens == null}
            onOpsFeedback={(entry, rating) => void submitOpsFeedbackForEntry(entry, rating)}
            feedbackByLogId={opsFeedbackByLogId}
            feedbackBusyLogId={opsFeedbackBusyLogId}
            savingSopLogId={savingSopLogId}
            liveRunByLogId={liveRunByLogId}
            onResolveApproval={resolveInlineCommandApproval}
            onAddCommandToWhitelist={(command) => void addCommandToWhitelist(command)}
            onOpenModelSettings={() => {
              setSheetOpen(true)
            }}
            onSaveAsSop={(entry) => {
              void saveAgentTurnAsWikiSop(entry)
            }}
            captureReadyLogs={captureReadyLogs}
            hiddenCaptureReadyLogIds={hiddenReadyLogIds}
            captureDraftPins={capturePins}
            onOpenCaptureDraft={openCaptureDraft}
            hasEarlierLogs={hasEarlierLogs}
            loadingEarlier={loadingEarlierLogs}
            earlierLogsError={earlierLogsError}
            onLoadEarlier={() => void loadEarlierAgentLogs()}
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
            onClarifyConfirm={(payload: ConnectionClarifyConfirmPayload) => {
              const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
              const clarification = tabsRef.current.find(
                (tab) => tab.id === chatTabId
              )?.pendingClarification
              if (!clarification || clarification.kind !== 'connection-intent') return
              pendingAttentionNotifierRef.current.clear(`clarify:${chatTabId}`)

              const action = resolveConnectionClarifyConfirm({
                clarification,
                payload,
                connections,
                formatTarget: formatConnectionTarget
              })

              if (action.kind === 'noop') {
                if (action.reason === 'unmatched') {
                  console.warn('[connection-clarify] confirm payload unmatched', payload)
                }
                return
              }

              if (action.kind === 'open-connections') {
                updateTab(chatTabId, (current) => ({
                  ...current,
                  pendingClarification: undefined
                }))
                showConnectionList()
                return
              }

              if (action.kind === 'manual-continue') {
                const executionTabId =
                  activeExecutionTabIdRef.current.get(chatTabId) ?? activeTabIdRef.current
                updateTab(executionTabId, (current) => ({
                  ...current,
                  terminalReady: true
                }))
                updateTab(chatTabId, (current) => ({
                  ...current,
                  pendingClarification: {
                    ...clarification,
                    settled: { status: 'confirmed', label: payload.target.label }
                  }
                }))
                void submitAgentMessage(action.originalInput, { skipUserLog: true })
                return
              }

              // connect — settle card then resume original task with forced connectionId
              // (no synthetic user bubble /「用户补充说明」resubmit)
              updateTab(chatTabId, (current) => ({
                ...current,
                pendingClarification: {
                  ...clarification,
                  settled: { status: 'confirmed', label: action.label }
                }
              }))
              void submitAgentMessage(action.originalInput, {
                forcedConnectionId: action.connectionId,
                skipUserLog: true
              })
            }}
            onClarifyDismiss={() => {
              const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
              const clarification = tabsRef.current.find(
                (tab) => tab.id === chatTabId
              )?.pendingClarification
              pendingAttentionNotifierRef.current.clear(`clarify:${chatTabId}`)
              if (!clarification || clarification.settled) return
              updateTab(chatTabId, (current) => ({
                ...current,
                pendingClarification: {
                  ...clarification,
                  settled: { status: 'cancelled' }
                }
              }))
            }}
            passwordPromptRequest={passwordPromptRequest}
            passwordPromptValue={passwordPromptValue}
            passwordPromptError={passwordPromptError}
            passwordPromptInputRef={passwordPromptInputRef}
            onPasswordPromptChange={setPasswordPromptValue}
            onPasswordPromptCancel={cancelPasswordPrompt}
            onPasswordPromptSubmit={submitPasswordPrompt}
            workbenchLayout={workbenchLayout}
            onWorkbenchLayoutChange={persistAndSetWorkbenchLayout}
            onInterruptCommand={interruptAgentCommand}
            runningCommandTabId={runningCommandTabId}
            onSelectSession={(groupId) => {
              const focusTab =
                getSessionTerminals(tabsRef.current, groupId).find(
                  (tab) => tab.id === activeTabIdRef.current
                ) ??
                getSessionChatTab(tabsRef.current, groupId) ??
                tabsRef.current.find((tab) => getSessionGroupId(tab) === groupId)
              if (focusTab) {
                selectSessionTab(focusTab.id)
                setActiveExecutionTerminal(
                  resolveSessionChatTabId(tabsRef.current, focusTab.id),
                  focusTab.id
                )
              }
            }}
            onSelectTerminal={(tabId) => {
              selectSessionTab(tabId)
              setActiveExecutionTerminal(resolveSessionChatTabId(tabsRef.current, tabId), tabId)
            }}
            onFocusTerminal={(tabId) => {
              const subterminal = resolveSubterminalTabState(tabsRef.current, tabId)
              if (subterminal) {
                selectSessionTab(subterminal.parentTabId)
                setSubterminalCollapsed(false)
                if (workbenchLayout === 'chat') persistAndSetWorkbenchLayout('split')
                window.setTimeout(() => {
                  document
                    .querySelector<HTMLElement>(`[data-subterminal-id="${CSS.escape(tabId)}"]`)
                    ?.querySelector<HTMLElement>('.xterm-helper-textarea')
                    ?.focus()
                }, 0)
                return
              }
              selectSessionTab(tabId)
              if (workbenchLayout === 'chat') persistAndSetWorkbenchLayout('split')
              window.setTimeout(() => {
                document
                  .querySelector<HTMLElement>('.terminal-canvas .xterm-helper-textarea')
                  ?.focus()
              }, 0)
            }}
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
              updateTab(sessionChatTab.id, (tab) => applyComposerInput(tab, value))
            }}
            onComposerCaretChange={setComposerCaret}
            onAgentInputKeyDown={handleAgentInputKeyDown}
            onAgentInputPaste={(event) => void handleAgentInputPaste(event)}
            onRemoveSkill={removeSkillRef}
            onRemovePath={removePathRef}
            onRemoveTool={removeToolRef}
            onRemoveWiki={removeWikiRef}
            onPickPathReference={(kind) => void pickPathReference(kind)}
            onStopAgent={() => stopAgentRun()}
            onRetryConnection={() => void retryActiveConnection()}
            onReinitTerminal={() => void reinitActiveTerminal()}
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
        connectionFormOpen={connectionFormOpen}
        connectionImportText={connectionImportText}
        connectionSshOptionsText={connectionSshOptionsText}
        connectionActionsText={connectionActionsText}
        connectionCommandPreview={connectionCommandPreview}
        connectionFormReady={connectionFormReady}
        clusterHostRegexValidation={clusterHostRegexValidation}
        connectionSaveMessage={connectionSaveMessage}
        connectionNameConflict={connectionNameConflict}
        connectionActionBusy={connectionActionBusy}
        t={t}
        formatConnectionTarget={formatConnectionTarget}
        onClose={() => setConnectionModalOpen(false)}
        onQueryChange={setConnectionSearchQuery}
        onSelectConnection={selectConnection}
        onConnect={connectFromConnectionCard}
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
        onToggleFavorite={(id) => void toggleConnectionFavorite(id)}
        onReorderConnection={(id, action) => void reorderConnectionList(id, action)}
        onImportTextChange={setConnectionImportText}
        onImportConnection={importConnectionFromText}
        onFormChange={updateConnectionForm}
        onSshOptionsTextChange={setConnectionSshOptionsText}
        onActionsTextChange={setConnectionActionsText}
        onResetForm={resetConnectionForm}
        onStartEditing={() => setConnectionEditing(true)}
        onSave={(connectAfterSave) => void saveConnection(connectAfterSave)}
        onRenameNameConflict={() => {
          setConnectionNameConflict(null)
          setConnectionSaveMessage(null)
          setConnectionEditing(true)
          requestAnimationFrame(() => {
            const field = document.getElementById('connection-name')
            if (field instanceof HTMLInputElement) {
              field.focus()
              field.select()
            }
          })
        }}
        onOverwriteNameConflict={() => {
          if (!connectionNameConflict) return
          void saveConnection(connectionNameConflict.connectAfterSave, {
            overwriteExistingId: connectionNameConflict.existingId
          })
        }}
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
      />
      {whaleEnabled && (
        <Suspense fallback={null}>
          <WhaleMonitor
            locale={locale}
            agentBusy={
              sessionChatTab.agentBusy || Boolean(contextCompactingByTabId[sessionChatTab.id])
            }
            selectedModel={activeTabModelId}
            onEnabledChange={setWhaleEnabled}
            onSelectModel={selectWhaleModel}
          />
        </Suspense>
      )}
    </main>
  )
}

/**
 * Wait until the terminal shell has produced an interactive prompt (local or
 * remote host style). A freshly spawned PTY is ready only after the shell
 * finishes its startup files; pasting earlier loses the command in zsh.
 */

/**
 * Poll SSOT for the REMOTE prompt during the login window. A transient local
 * prompt (fresh PTY before ssh connects) must NOT abort confirmation; only
 * when the whole window expires with the shell still at the local prompt does
 * the login count as failed.
 */

export default App
