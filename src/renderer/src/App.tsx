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
  HistoryIcon,
  LanguagesIcon,
  MessageSquareIcon,
  PlugIcon,
  PuzzleIcon,
  ServerIcon
} from 'lucide-react'
import { toast, Toaster } from 'sonner'
import { TOAST_INTERVENTION_DURATION_MS } from '@renderer/lib/toast-policy'

import { AgentPanel } from '@renderer/components/AgentPanel'
import { type ComposerInputHandle } from '@renderer/components/ComposerEditor'
import { AppFooter } from '@renderer/components/AppFooter'
import {
  CloseTabsConfirmModal,
  type CloseTabsConfirmRequest,
  type PasswordPromptRequest
} from '@renderer/components/AppModals'
import { ConnectionManagerModal } from '@renderer/components/ConnectionManagerModal'
import { extractResultMarkdown } from '@renderer/lib/agent-run-markdown'
import { localizeAgentEventMessage } from '@renderer/lib/agent-event-formatters'
import { SettingsSheet } from '@renderer/components/SettingsSheet'
import { McpServersSheet } from '@renderer/components/McpServersSheet'
import { ProductLogo } from '@renderer/components/ProductLogo'
import {
  type SkillInstallLogStatus,
  type SkillManageMessage
} from '@renderer/components/StatusIndicators'
import { TerminalPane } from '@renderer/components/TerminalPane'
import { HistoryPanel } from '@renderer/components/HistoryPanel'
import { OnboardingModal } from '@renderer/components/OnboardingModal'
import { SkillManager, type SkillPreviewState } from '@renderer/components/SkillManager'
import { ExtensionManager } from '@renderer/components/ExtensionManager'
import { ExtensionUiDialog } from '@renderer/components/ExtensionUiDialog'
import { WikiSheet } from '@renderer/components/WikiSheet'
import { Button } from '@renderer/components/ui/button'
import {
  dictionaries,
  localeOptions,
  nextLocale,
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
  AGENT_LOG_SOFT_LIMIT,
  AGENT_RUN_STREAM_MAX_CHARS,
  appendElapsedFooter,
  clampAgentText,
  connectionFailureMarkers,
  formatAgentRunMarkdown,
  hydrateStoredAgentLog,
  isConnectionFailureLog,
  trimAgentLogEntries
} from '@renderer/lib/agent-log'
import { resolveSuccessfulAgentResult } from '@renderer/lib/agent-run-finalize'
import { buildFinishPersistText, closeStreamingOpenSteps } from '@renderer/lib/agent-run-document'
import { settleRunningToolStepsAsInterrupted } from '@renderer/lib/settle-interrupted-tool-steps'
import { suggestWhitelistRule } from '@renderer/lib/command-whitelist'
import {
  buildTraceFromAgentLogEntry,
  buildTraceFromAgentRunView,
  formatTraceExport
} from '@renderer/lib/agent-run-trace-export'
import {
  buildAvailableToolRefs,
  flattenProviderModels,
  formatProviderModels,
  parseCommandWhitelist,
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
  appendRunStatusStep,
  classifyPipeCommand,
  recordRecoveryAttempt,
  resolveRunStopReason,
  shouldAttemptRecovery,
  type RunStopReason
} from '../../shared/connection-state'
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
import { decodeUserMessageText, snapshotMessageReferences } from '@renderer/lib/agent-message-refs'
import {
  collectComposerRefIds,
  formatComposerRefToken,
  hasComposerRefTokens,
  insertComposerRefTokenAt,
  removeComposerRefToken,
  stripComposerRefTokens
} from '@renderer/lib/composer-ref-tokens'
import { buildFallbackSopSeed, buildSopGenerationSummary } from '@renderer/lib/sop-summary'
import { hasExplicitLocalWorkIntent } from '../../shared/agent-local-intent'
import { findNewestPromptSignal } from '../../shared/terminal-prompt-host'
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
import {
  formatSuggestionsForInput,
  isActiveLoggedInTerminal,
  prioritizeClarifyOptions,
  routeConnection,
  formatConnectionClarifyOptions,
  resolveConnectionClarifyConfirm,
  routeForcedConnection,
  type ConnectionClarifyConfirmPayload
} from '@renderer/lib/connection-route'
import {
  beginConnectionRetry,
  canAttemptConnection,
  createIdleConnectionAttempt,
  markConnectionFailed,
  markConnectionReady,
  shouldAppendSwitchedEntry,
  type ConnectionAttemptState
} from '@renderer/lib/connection-attempt'
import { runWithTimeout } from '@renderer/lib/with-timeout'
import { isIpv4Literal, waitForRemotePrompt } from '@renderer/lib/prompt-host-wait'
import { ensureLocalTerminalStarted } from '@renderer/lib/ensure-local-terminal'
import {
  buildBusySupplementArtifacts,
  mergePostLoginSupplements,
  resolveLoginContinuation
} from '@renderer/lib/busy-supplement'
import { wrapSteerSupplementPayload } from '../../shared/runtime-supplement'
import {
  buildTerminalNotReadyClarifyOptions,
  CLARIFY_MANUAL_CONTINUE_ID,
  isRemoteExecutionTab,
  isTerminalSnapshotReadyForAgent,
  resolveTerminalReadyGateOutcome,
  TERMINAL_READY_WAIT_MS
} from '@renderer/lib/terminal-ready-gate'
import {
  createPendingAttentionNotifier,
  summarizeNotificationBody
} from '@renderer/lib/pending-attention-notify'
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
  catalogSkillPageUrl,
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
  getSessionDisplayTitle,
  getSessionGroupId,
  getSessionTerminals,
  isReservedTerminalTabId,
  resolveConnectTargetTab,
  resolveSessionChatTabId,
  resolveSessionAgentStyle,
  resolveTabModelSelection,
  retainSettledClarification,
  type AgentLogEntry,
  type AgentLogEntryInput,
  type AgentRunStep,
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
  buildExtSlashCommand,
  buildMcpSlashCommand,
  buildSkillSlashCommand,
  buildSlashCommandOptions,
  buildStyleSlashCommands,
  buildToolSlashCommand,
  buildWikiSlashCommand,
  getSlashCommandQuery,
  isConnectionSlashQuery,
  isExtSlashQuery,
  isMcpSlashQuery,
  isStyleSlashQuery,
  isToolSlashQuery,
  isWikiSlashQuery,
  matchesConnectionSlashCommand,
  matchesExtSlashCommand,
  matchesMcpSlashCommand,
  matchesSkillSlashCommand,
  matchesSlashCommand,
  matchesStyleSlashCommand,
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
  AgentExtensionOption,
  AgentPiPackageSearchResult,
  AgentWikiReference,
  ExtensionUiRequest,
  AgentConnectionIntentResult,
  ConnectionConfig,
  ConnectionInput,
  LocalInstructionDocument,
  StoredAgentRun,
  StoredSessionHistoryItem,
  WikiDocument,
  WikiDocumentSummary
} from '../../shared/agent-types'
import { addSessionTokenUsage, EMPTY_SESSION_TOKEN_USAGE } from '../../shared/session-token-usage'
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
import type { AppUpdateStatusEvent } from '../../shared/update-types'

const emptyConfig: AgentConfig = {
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
  skillRoot: '~/.agents/skills',
  disabledExtensions: [],
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
  activeWikiIds?: string[]
  activeSkillPaths?: string[]
}

const initialTerminalTab = createTerminalTab({ title: 'Terminal' })
const emptyLocalTab = createTerminalTab({ title: 'Terminal' })

/** Hard timeout for PTY spawn during reconnect (configurable). */
const CONNECTION_SPAWN_TIMEOUT_MS = 10_000
/** Hard timeout for the whole login automation (spawn + actions + password wait). */
const CONNECTION_LOGIN_TOTAL_TIMEOUT_MS = 90_000

/** CRESCENT_DEBUG_CONN=1 enables [conn-trace] logs in the renderer too. */
function connTrace(...parts: unknown[]): void {
  // Renderer has no Node globals under context isolation; typeof guard keeps
  // this safe in both dev server and packaged app.
  if (typeof process === 'undefined' || process.env?.CRESCENT_DEBUG_CONN !== '1') return
  console.info('[conn-trace]', ...parts)
}

/** Settle copy for run stops: only a real user stop shows "manually stopped". */
function settleStopText(
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

/** Subterminals live under the parent tab; resolve their terminal state. */
function resolveSubterminalTabState(
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

function App({ recoveryMode = 'none' }: { recoveryMode?: 'none' | 'pending' }): React.JSX.Element {
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
  const passwordPromptsByTabRef = useRef(new Map<string, PasswordPromptRequest>())
  const validationRequestRef = useRef(0)
  const nextLogIdRef = useRef(1)
  const agentLogRef = useRef<HTMLDivElement | null>(null)
  const agentInputRef = useRef<ComposerInputHandle | null>(null)
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
  const skipConnectionReconnectRef = useRef(new Set<string>())
  const restoreTerminalSessionRef = useRef<((tabId: string) => Promise<boolean>) | null>(null)
  const stopAgentRunRef = useRef<
    | ((
        tabId?: string,
        options?: { reason?: RunStopReason; expectedHost?: string; observedHost?: string }
      ) => void | Promise<void>)
    | null
  >(null)
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
  const [extensions, setExtensions] = useState<AgentExtensionOption[]>([])
  const [extensionCommands, setExtensionCommands] = useState<
    Array<{ name: string; description: string }>
  >([])
  const [extensionSearchQuery, setExtensionSearchQuery] = useState('')
  const [extensionCatalogQuery, setExtensionCatalogQuery] = useState('')
  const [extensionCatalogResults, setExtensionCatalogResults] = useState<
    AgentPiPackageSearchResult[]
  >([])
  const [extensionCatalogLoading, setExtensionCatalogLoading] = useState(false)
  const [extensionInstallingSource, setExtensionInstallingSource] = useState<string | null>(null)
  const [extensionManageMessage, setExtensionManageMessage] = useState<SkillManageMessage | null>(
    null
  )
  const [extensionDeletingPath, setExtensionDeletingPath] = useState<string | null>(null)
  const [selectedExtensionPreview, setSelectedExtensionPreview] = useState<{
    extension: AgentExtensionOption
    content: string
  } | null>(null)
  const [extensionPreviewLoadingPath, setExtensionPreviewLoadingPath] = useState<string | null>(
    null
  )
  const [extensionUiRequest, setExtensionUiRequest] = useState<ExtensionUiRequest | null>(null)
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
  const [selectedSkillPreview, setSelectedSkillPreview] = useState<SkillPreviewState | null>(null)
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
  const [extensionOpen, setExtensionOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldShowOnboarding())
  const [mcpOpen, setMcpOpen] = useState(false)
  const [providerEditorOpen, setProviderEditorOpen] = useState(false)
  const [openApiEditorOpen, setOpenApiEditorOpen] = useState(false)
  const [instructionEditorOpen, setInstructionEditorOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [loadingEarlierLogs, setLoadingEarlierLogs] = useState(false)
  const [hasEarlierLogs, setHasEarlierLogs] = useState(false)
  const [connectionAttemptByChatTab, setConnectionAttemptByChatTab] = useState<
    Record<string, ConnectionAttemptState>
  >({})
  const [dismissedRecoveryByChatTab, setDismissedRecoveryByChatTab] = useState<
    Record<string, boolean>
  >({})
  const lastProcessedFailureEntryRef = useRef(new Map<string, number>())
  const retryInFlightRef = useRef(new Set<string>())
  const [opsFeedbackByLogId, setOpsFeedbackByLogId] = useState<Record<number, 'like' | 'dislike'>>(
    {}
  )
  const [opsFeedbackBusyLogId, setOpsFeedbackBusyLogId] = useState<number | null>(null)
  const [savingSopLogId, setSavingSopLogId] = useState<number | null>(null)
  const [sessionUsageBaselineByTabId, setSessionUsageBaselineByTabId] = useState<
    Record<string, { input: number; output: number }>
  >({})
  const [liveSessionUsageByTabId, setLiveSessionUsageByTabId] = useState<
    Record<string, { input: number; output: number }>
  >({})
  const liveRunUsageRef = useRef(new Map<string, { input: number; output: number }>())
  const [appVersion, setAppVersion] = useState('')
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatusEvent | { state: 'idle' }>({
    state: 'idle'
  })
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
  // First-open shows the terminal and keeps the chat area hidden; the chat can
  // be summoned from the right-edge rail or the header toggle.
  const [hiddenPane, setHiddenPane] = useState<'terminal' | 'chat' | null>('chat')
  const [paneOrder, setPaneOrder] = useState<PaneOrder>(() => resolveInitialPaneOrder())
  const [terminalPage, setTerminalPage] = useState<'terminal' | 'connections'>('terminal')
  const [slashCommandOpen, setSlashCommandOpen] = useState(true)
  const [slashCommandIndex, setSlashCommandIndex] = useState(0)
  const [composerCaret, setComposerCaret] = useState(0)
  const [locale, setLocale] = useState<Locale>(() => resolveInitialLocale())
  const [closeTerminalConfirmEnabled, setCloseTerminalConfirmEnabled] = useState(
    () => localStorage.getItem(CLOSE_TERMINAL_CONFIRM_STORAGE_KEY) !== 'false'
  )
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
  const sessionAgentStyle = resolveSessionAgentStyle(sessionChatTab, config)
  const sessionTokenUsage = addSessionTokenUsage(
    sessionUsageBaselineByTabId[sessionChatTab.id] ?? EMPTY_SESSION_TOKEN_USAGE,
    liveSessionUsageByTabId[sessionChatTab.id] ?? EMPTY_SESSION_TOKEN_USAGE
  )

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

  useEffect(() => {
    const tabId = sessionChatTab.id
    let cancelled = false
    void window.api.storage.getSessionTokenUsage(tabId).then((usage) => {
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
    void window.api.storage.countAgentLogs(chatTabId).then((count) => {
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
    try {
      const rows = await window.api.storage.listAgentLogs({
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
      const total = await window.api.storage.countAgentLogs(chatTabId)
      const nextLen =
        tabsRef.current.find((tab) => tab.id === chatTabId)?.agentLog.length ??
        sessionChatTab.agentLog.length + hydrated.length
      setHasEarlierLogs(total > nextLen)
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
  const { modelOptions, visibleModels, settingsProvider } = useSettings({
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
    if (isExtSlashQuery(slashCommandQuery)) {
      return extensionCommands
        .map((command) => buildExtSlashCommand(command, t))
        .filter((command) => matchesExtSlashCommand(command, slashCommandQuery ?? ''))
    }
    if (isConnectionSlashQuery(slashCommandQuery)) {
      return connections
        .map((connection) => buildConnectionSlashCommand(connection, t))
        .filter((command) => matchesConnectionSlashCommand(command, slashCommandQuery ?? ''))
    }

    return buildSlashCommandOptions(t).filter((command) =>
      matchesSlashCommand(command, slashCommandQuery)
    )
  }, [
    availableToolRefs,
    connections,
    extensionCommands,
    mcpToolRefs,
    skills,
    slashCommandQuery,
    t,
    wikiDocuments
  ])
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

  useEffect(() => {
    if (!isExtSlashQuery(slashCommandQuery)) return
    void window.api.agent
      .listExtensionCommands(sessionChatTab.id)
      .then(setExtensionCommands)
      .catch(() => setExtensionCommands([]))
  }, [sessionChatTab.id, slashCommandQuery])

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

  /**
   * Subterminal fallback success ≡ overall login success. When the main login
   * run was already finalized (typically as a failure/timeout), rewrite that
   * card to the success state so the badge, steps and title agree with the
   * terminal reality instead of showing a contradictory "登录失败".
   */
  const correctLoginCardToSuccess = useCallback(
    (chatTabId: string, connection: ConnectionConfig, targetTabId: string): void => {
      const logId = lastLoginRunLogIdRef.current.get(chatTabId)
      if (logId === undefined) return

      const connectionTarget = formatConnectionTarget(connection)
      const finishedSteps: AgentRunStep[] = [
        {
          id: `status-${crypto.randomUUID()}`,
          kind: 'status',
          title: t.terminal.postLoginTaskStarting
        }
      ]
      const finishedRun: AgentRunViewState = {
        logId,
        runId: `run-${crypto.randomUUID()}`,
        actions: [],
        steps: finishedSteps,
        startedAt: Date.now() - 1,
        result: `${t.terminal.loginSuccess} ${connection.name} (${connectionTarget})`,
        elapsedMs: 0,
        loginMeta: {
          connectionName: connection.name,
          host: connection.host,
          port: connection.port,
          user: connection.user,
          actionCount: buildConnectionLoginActions(connection).length
        }
      }
      updateLogEntryText(chatTabId, logId, buildFinishPersistText(finishedRun))
      lastLoginRunLogIdRef.current.delete(chatTabId)

      // Consume any supplements queued during the login attempt and continue.
      const supplements = pendingPostLoginSupplementsRef.current.get(chatTabId) ?? []
      const decision = resolveLoginContinuation({ ok: true, supplements })
      if (decision.shouldContinue) {
        pendingPostLoginSupplementsRef.current.delete(chatTabId)
        const supplementText = supplements.join('\n')
        const continuationInput = buildPostLoginAgentInput(supplementText, connection, t)
        void runAgentConversationRef.current?.(
          continuationInput,
          targetTabId,
          connection.id,
          supplementText,
          false,
          Date.now(),
          { chatTabId }
        )
      }
    },
    [pendingPostLoginSupplementsRef, t, updateLogEntryText]
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
      const subterminal = targetTab
        ? undefined
        : resolveSubterminalTabState(tabsRef.current, targetTabId)
      const terminalMode = targetTab?.terminalMode ?? subterminal?.terminalMode
      const [sshCommand] = includeSshCommand ? commands : []
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
      const loginActionCount = buildConnectionLoginActions(resolvedConnection).length
      appendStatusToActiveRunOrLog(
        chatTabId,
        loginActionCount > 0
          ? `${t.terminal.connectionStarting}: ${loginActionCount}`
          : t.terminal.connectionNoActions,
        pendingReuseRun
      )

      automatedLoginTabsRef.current.add(targetTabId)
      passwordPromptBuffersRef.current.set(targetTabId, '')
      void window.api.terminal.setExpectedHost({
        tabId: targetTabId,
        host: resolvedConnection.host
      })
      try {
        const ok = includeSshCommand
          ? await runConnectionCommandSequence(
              commands,
              targetTabId,
              appendLog,
              (text, id) => appendSystemToRunOrLog(id, text),
              t,
              chatTabId
            )
          : await runConnectionLoginActionSequence(
              commands,
              targetTabId,
              appendLog,
              (text, id) => appendSystemToRunOrLog(id, text),
              t,
              chatTabId
            )
        if (!ok) {
          // Failed auth/host/login must not auto-retry the same SSH connection on exit.
          skipConnectionReconnectRef.current.add(targetTabId)
          abortPostConnectionTasks(targetTabId, t.terminal.postLoginTaskAborted)
          void window.api.terminal.setExpectedHost({ tabId: targetTabId, host: null })
          return false
        }
        // Wait for the remote prompt to settle, then write the verified login
        // back to the SSOT (learns the observed prompt host as an alias). The
        // transient local prompt of the fresh PTY is ignored during the window;
        // ending still at the local prompt means the ssh never established.
        const promptStart = Date.now()
        // Multi-hop login: the final `ssh <host>` action is the true target.
        // Wait for that host's prompt (not the jump box's) before confirming,
        // otherwise confirm-login anchors the wrong runtime environment.
        const finalTargetHost = resolveFinalSshTarget(commands, connection)
        const lastAction = commands.length > 1 ? commands[commands.length - 1] : undefined
        const lastActionIsSsh = Boolean(lastAction && /^\s*ssh\b/i.test(lastAction))
        const preConfirm = await window.api.terminal.getContext(targetTabId)
        const previousHost =
          lastActionIsSsh && preConfirm.promptHost && preConfirm.promptHost !== 'local-shell'
            ? preConfirm.promptHost
            : undefined
        appendSystemToRunOrLog(chatTabId, t.terminal.loginConfirming)
        const loginSignal = await waitForPromptHostOrTimeout(targetTabId, 20_000, {
          expectedHost: finalTargetHost,
          previousHost,
          acceptAnyRemoteHost: !finalTargetHost || isIpv4Literal(finalTargetHost)
        })
        connTrace(
          'login-stage',
          `tab=${targetTabId}`,
          `promptSignal=${loginSignal}`,
          `promptAfterMs=${Date.now() - promptStart}`
        )
        const verified = sshCommand
          ? await window.api.terminal.confirmLogin({
              tabId: subterminal ? subterminal.parentTabId : targetTabId,
              sourceTabId: subterminal ? targetTabId : undefined,
              expectedTargetHost: finalTargetHost
            })
          : undefined
        if (verified && !verified.ok && loginSignal === 'local') {
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
          // Subterminal fallback success === overall login success: settle any
          // pending login run, or rewrite an already-finalized (failed) login
          // card so the badge stops spinning / showing "登录失败".
          finalizeLoginRun(chatTabId, true, undefined, {
            targetTabId,
            connection: resolvedConnection
          })
          correctLoginCardToSuccess(chatTabId, resolvedConnection, targetTabId)
        } else if ((postConnectionTasksRef.current.get(targetTabId) ?? []).length === 0) {
          appendSystemToRunOrLog(chatTabId, t.terminal.postLoginTaskStarting)
        }
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        skipConnectionReconnectRef.current.add(targetTabId)
        appendLog({ kind: 'error', text: message }, chatTabId)
        abortPostConnectionTasks(targetTabId, `${t.terminal.postLoginTaskAborted}\n${message}`)
        void window.api.terminal.setExpectedHost({ tabId: targetTabId, host: null })
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
      correctLoginCardToSuccess,
      finalizeLoginRun,
      t,
      updateTab
    ]
  )

  const executeConnectionCommands = useCallback(
    async (connection: ConnectionConfig, targetTabId: string): Promise<void> => {
      const chatTabId = resolveSessionChatTabId(tabsRef.current, targetTabId)
      const timeoutMessage = t.terminal.connectionLoginTimeout.replace(
        '{ms}',
        String(Math.round(CONNECTION_LOGIN_TOTAL_TIMEOUT_MS / 1000))
      )
      connTrace('automation-start', `tab=${targetTabId}`, `connection=${connection.id}`)
      const ok = await runWithTimeout(
        executeConnectionAutomation(connection, targetTabId, true),
        CONNECTION_LOGIN_TOTAL_TIMEOUT_MS,
        () => {
          connTrace('automation-timeout', `tab=${targetTabId}`)
          appendLog({ kind: 'error', text: timeoutMessage }, chatTabId)
        }
      )
      if (ok) {
        markChatTabReady(chatTabId)
      } else if (ok === undefined) {
        // Overall login timeout: settle the pending run (spinner) and the card
        // explicitly. The watcher also picks the error entry up, but do not
        // rely on marker coverage.
        abortPostConnectionTasks(targetTabId, timeoutMessage)
        updateConnectionAttempt(chatTabId, (state) =>
          markConnectionFailed(state, { reason: timeoutMessage })
        )
      }
      retryInFlightRef.current.delete(chatTabId)
      if (shouldDrainPostConnectionTasks(ok === true)) drainPostConnectionTasks(targetTabId)
      finalizeLoginRun(
        chatTabId,
        ok === true,
        ok === false
          ? t.terminal.connectionLoginTimeout.replace(
              '{ms}',
              String(Math.round(CONNECTION_LOGIN_TOTAL_TIMEOUT_MS / 1000))
            )
          : undefined,
        { targetTabId, connection }
      )
      connTrace('automation-end', `tab=${targetTabId}`, `ok=${ok}`)
    },
    [
      abortPostConnectionTasks,
      appendLog,
      drainPostConnectionTasks,
      executeConnectionAutomation,
      finalizeLoginRun,
      markChatTabReady,
      t,
      updateConnectionAttempt
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
    return window.api.terminal.onEnvironmentDrift((event) => {
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
    if (!passwordPromptRequest) return

    passwordPromptRequestRef.current = passwordPromptRequest
    window.requestAnimationFrame(() => passwordPromptInputRef.current?.focus())
  }, [passwordPromptRequest])

  useEffect(() => {
    localStorage.setItem('crescent.locale', locale)
    void window.api.app.setLocale(locale)
  }, [locale])

  useEffect(() => {
    return window.api.app.onOpenSettings(() => {
      setSheetOpen(true)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.update.getVersion().then((result) => {
      if (!cancelled) setAppVersion(result.version)
    })
    const unsubscribe = window.api.update.onStatus((event) => {
      setAppUpdateStatus(event)
      if (event.state === 'downloaded' && event.installerPath) {
        toast.success(t.app.updateSaved)
      }
    })
    void window.api.update.check()
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [t.app.updateSaved])

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

  const maybeRequestTerminalPassword = useCallback(
    (tabId: string, data: string): void => {
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
        pendingAttentionNotifierRef.current.notifyIfUnfocused(
          `password:${tabId}`,
          t.notifications.passwordTitle,
          t.notifications.passwordBody
        )
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
    },
    [t]
  )

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
      .listExtensions()
      .then(setExtensions)
      .catch(() => setExtensions([]))
    window.api.agent
      .listExtensionCommands()
      .then(setExtensionCommands)
      .catch(() => setExtensionCommands([]))
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
      if (event.type === 'usage') {
        const usage = { input: event.input, output: event.output }
        if (event.runId) liveRunUsageRef.current.set(event.runId, usage)
        setLiveSessionUsageByTabId((current) => ({ ...current, [chatTabId]: usage }))
        return
      }
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
    return window.api.agent.onExtensionUiRequest((request) => {
      if (request.method === 'notify') {
        if (request.notifyType === 'error') toast.error(request.message)
        else if (request.notifyType === 'warning') toast.warning(request.message)
        else toast.message(request.message)
        return
      }
      setExtensionUiRequest(request)
    })
  }, [])

  useEffect(() => {
    return window.api.agent.onExtensionUiDismiss((payload) => {
      setExtensionUiRequest((current) => (current?.id === payload.requestId ? null : current))
    })
  }, [])

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
      pendingAttentionNotifierRef.current.notifyIfUnfocused(
        `approval:${request.id}`,
        t.notifications.approvalTitle,
        t.notifications.approvalBody,
        { runId: request.runId }
      )
    })
  }, [attachApprovalRequest, t.commandReview.sessionClosedRejection, t.notifications])

  useEffect(() => {
    return window.api.agent.onCommandApprovalPurpose((payload) => {
      for (const [chatTabId, run] of activeAgentRunRef.current.entries()) {
        if (run.runId !== payload.runId) continue
        applyApprovalPurpose(chatTabId, payload.requestId, payload.purpose)
      }
    })
  }, [applyApprovalPurpose])

  useEffect(() => {
    return window.api.agent.onSubterminalOpened((payload) => {
      void (async () => {
        ensureSubterminal(payload.parentTabId, {
          id: payload.tabId,
          name: payload.name,
          output: '',
          rawOutput: '',
          cwd: '',
          status: 'active',
          isSsh: payload.mode === 'ssh',
          terminalMode: payload.terminalMode,
          terminalReady: true
        })
        setSubterminalCollapsed(false)

        if (payload.mode !== 'ssh' || !payload.connectionId) {
          const parentTab = tabsRef.current.find((tab) => tab.id === payload.parentTabId)
          if (parentTab?.connectionId) {
            markChatTabReady(resolveSessionChatTabId(tabsRef.current, payload.parentTabId))
          }
          void window.api.agent.ackSubterminalOpened({ tabId: payload.tabId, ok: true })
          return
        }

        try {
          const refreshed = await window.api.connections.resolve(payload.connectionId)
          const fallback = connectionsRef.current.find((item) => item.id === payload.connectionId)
          const connection = refreshed
            ? mergeConnectionInput(refreshed, fallback ?? refreshed)
            : fallback
          if (!connection || isLocalConnection(connection)) {
            void window.api.agent.ackSubterminalOpened({
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
              void window.api.agent.ackSubterminalOpened({
                tabId: payload.tabId,
                ok: false,
                error: timeoutMessage
              })
            }
          )
          if (ok === true) {
            // Subterminal SSH success writes back to the parent tab SSOT
            // (confirm-login promotion inside executeConnectionAutomation):
            // clear the recovery card and mark the chat ready.
            const chatTabId = resolveSessionChatTabId(tabsRef.current, payload.parentTabId)
            markChatTabReady(chatTabId)
            recoveryBudgetByTabRef.current.delete(chatTabId)
            skipConnectionReconnectRef.current.delete(payload.parentTabId)
          }
          void window.api.agent.ackSubterminalOpened({
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
          void window.api.agent.ackSubterminalOpened({
            tabId: payload.tabId,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      })()
    })
  }, [ensureSubterminal, executeConnectionAutomation, markChatTabReady, t])

  useEffect(() => {
    return window.api.agent.onCommandApprovalDismiss((payload) => {
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

  const userScrollingRef = useRef(false)
  const userScrollIdleTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const el = agentLogRef.current
    if (!el) return

    const followLatest = (force: boolean): void => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      // New user input always returns to the latest; otherwise follow unless
      // the user is actively scrolling (idle timeout below resumes tracking).
      if (force || nearBottom || !userScrollingRef.current) {
        el.scrollTo({ top: el.scrollHeight })
      }
    }

    const handleScroll = (): void => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      if (nearBottom) {
        userScrollingRef.current = false
        if (userScrollIdleTimerRef.current != null) {
          window.clearTimeout(userScrollIdleTimerRef.current)
          userScrollIdleTimerRef.current = null
        }
        return
      }
      userScrollingRef.current = true
      if (userScrollIdleTimerRef.current != null) {
        window.clearTimeout(userScrollIdleTimerRef.current)
      }
      userScrollIdleTimerRef.current = window.setTimeout(() => {
        // User stopped scrolling: resume tracking so the next update follows.
        userScrollingRef.current = false
        userScrollIdleTimerRef.current = null
      }, 1500)
    }

    const entries = activeTab?.agentLog ?? []
    const lastEntry = entries[entries.length - 1]
    const newUserInput = Boolean(
      lastEntry && (lastEntry.kind === 'user' || lastEntry.kind === 'user-supplement')
    )
    followLatest(newUserInput)

    el.addEventListener('scroll', handleScroll, { passive: true })
    const observer = new ResizeObserver(() => followLatest(false))
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', handleScroll)
      observer.disconnect()
    }
  }, [activeTab?.agentLog, activeTab?.agentThinking, activeTab?.thinkingMessage, activeLiveRun])

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
        const session = await window.api.terminal.start({
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

  async function refreshExtensions(): Promise<void> {
    try {
      setExtensions(await window.api.agent.listExtensions())
      setExtensionCommands(await window.api.agent.listExtensionCommands(sessionChatTab.id))
      setExtensionManageMessage({ type: 'success', text: t.settings.extensionsRefreshed })
    } catch (error) {
      setExtensionManageMessage({ type: 'error', text: String(error) })
    }
  }

  async function importExtension(): Promise<void> {
    try {
      const result = await window.api.agent.importExtension()
      if (result.canceled) return
      if (!result.ok) {
        setExtensionManageMessage({
          type: 'error',
          text: result.error || t.settings.extensionCommandFailed
        })
        return
      }
      setExtensions(result.extensions ?? (await window.api.agent.listExtensions()))
      setExtensionManageMessage({ type: 'success', text: t.settings.extensionImported })
    } catch (error) {
      setExtensionManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async function deleteExtension(extension: AgentExtensionOption): Promise<void> {
    setExtensionDeletingPath(extension.path)
    try {
      setExtensions(await window.api.agent.deleteExtension(extension.path))
      if (selectedExtensionPreview?.extension.path === extension.path) {
        setSelectedExtensionPreview(null)
      }
      setExtensionManageMessage({
        type: 'success',
        text: `${t.settings.extensionDeleted}: ${extension.name}`
      })
    } catch (error) {
      setExtensionManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setExtensionDeletingPath(null)
    }
  }

  async function toggleExtensionEnabled(
    extension: AgentExtensionOption,
    enabled: boolean
  ): Promise<void> {
    try {
      setExtensions(await window.api.agent.setExtensionEnabled({ id: extension.id, enabled }))
      setConfig((current) => ({
        ...current,
        disabledExtensions: enabled
          ? current.disabledExtensions.filter((id) => id !== extension.id)
          : [...new Set([...current.disabledExtensions, extension.id])]
      }))
    } catch (error) {
      setExtensionManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async function previewExtension(extension: AgentExtensionOption): Promise<void> {
    setExtensionPreviewLoadingPath(extension.path)
    try {
      const content = await window.api.agent.getExtensionContent(extension.path)
      setSelectedExtensionPreview({ extension, content })
    } catch (error) {
      setExtensionManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setExtensionPreviewLoadingPath((current) => (current === extension.path ? null : current))
    }
  }

  async function searchExtensionCatalog(): Promise<void> {
    setExtensionCatalogLoading(true)
    setExtensionManageMessage({ type: 'info', text: t.settings.extensionsSearching })
    try {
      const results = await window.api.agent.searchExtensionPackages(extensionCatalogQuery)
      setExtensionCatalogResults(results)
      setExtensionManageMessage(
        results.length
          ? { type: 'success', text: t.settings.extensionsSearchComplete }
          : { type: 'info', text: t.settings.noExtensionCatalogResults }
      )
    } catch (error) {
      setExtensionManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setExtensionCatalogLoading(false)
    }
  }

  async function installExtensionPackage(result: AgentPiPackageSearchResult): Promise<void> {
    setExtensionInstallingSource(result.source)
    setExtensionManageMessage({
      type: 'info',
      text: `${t.settings.extensionInstalling}: ${result.name}`
    })
    try {
      setExtensions(await window.api.agent.installExtensionPackage(result.source))
      setExtensionManageMessage({
        type: 'success',
        text: `${t.settings.extensionInstalledPackage}: ${result.name}`
      })
    } catch (error) {
      setExtensionManageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setExtensionInstallingSource(null)
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

  async function previewCatalogSkill(result: AgentSkillSearchResult): Promise<void> {
    const skill: AgentSkillOption = {
      id: result.id,
      name: result.name,
      description: result.description,
      path: catalogSkillPageUrl(result),
      source: result.source,
      removable: true
    }
    setSkillPreviewLoadingPath(result.id)
    setSkillManageMessage(null)
    setSkillInstallLogResultId(null)
    setSelectedSkillPreview({ skill, content: '', catalogResultId: result.id })
    try {
      const content = await window.api.agent.getCatalogSkillContent({
        installSource: result.installSource,
        installSkill: result.installSkill,
        name: result.name
      })
      setSelectedSkillPreview((current) =>
        current?.catalogResultId === result.id
          ? { skill, content, catalogResultId: result.id }
          : current
      )
    } catch (error) {
      setSelectedSkillPreview((current) =>
        current?.catalogResultId === result.id
          ? {
              skill,
              content: `${t.settings.skillCatalogPreviewFailed}\n\n${
                error instanceof Error ? error.message : String(error)
              }`,
              catalogResultId: result.id
            }
          : current
      )
    } finally {
      setSkillPreviewLoadingPath((current) => (current === result.id ? null : current))
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
    return nextConfig
  }

  async function openHistorySession(item: StoredSessionHistoryItem): Promise<void> {
    const detail = await window.api.storage.getSessionHistory(item.tabId)
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

  useEffect(() => {
    if (recoveryMode !== 'pending') return
    let cancelled = false
    void (async () => {
      try {
        const items = await window.api.storage.listSessionHistory(1)
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
          void window.api.app.clearRendererRecovery()
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // Intentionally once on mount for pending recovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryMode])

  async function saveAgentTurnAsWikiSop(entry: AgentLogEntry): Promise<void> {
    if (savingSopLogId === entry.id) return
    const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    const log = tabsRef.current.find((tab) => tab.id === chatTabId)?.agentLog ?? []
    const entryIndex = log.findIndex((item) => item.id === entry.id)
    let userText = ''
    for (let i = entryIndex - 1; i >= 0; i--) {
      const item = log[i]
      if (item?.kind === 'user') {
        userText = item.text
        break
      }
    }
    const seed = userText.trim()
    if (!seed) {
      toast.error(t.wiki.saveFailed, { duration: TOAST_INTERVENTION_DURATION_MS })
      return
    }

    setSavingSopLogId(entry.id)
    setWikiMessage(null)
    const savingToast = toast.loading(t.common.saveAsSopSaving)
    try {
      const summary = buildSopGenerationSummary({
        log,
        entry,
        liveRun: liveRunByLogId[entry.id],
        t
      })
      const fallback = buildFallbackSopSeed(seed)
      const generated = await window.api.agent.generateSop({
        summary,
        locale,
        fallbackTitle: fallback.title,
        fallbackContent: fallback.content
      })
      toast.dismiss(savingToast)
      if (!generated.ok || !generated.document) {
        throw new Error(generated.error || t.wiki.saveFailed)
      }
      const document = generated.document
      setWikiDocuments((current) => upsertWikiSummary(current, document))
      setSelectedWikiDocument(document)
      setWikiEditContent(document.content)
      setWikiEditing(true)
      setWikiPreviewWidth(getDefaultWikiPreviewWidth())
      setWikiMessage({ type: 'success', text: `${t.wiki.saved}: ${document.title}` })
      toast.success(`${t.common.saveAsSopSaved}: ${document.title}`)
      setWikiOpen(true)
    } catch (error) {
      toast.dismiss(savingToast)
      setWikiMessage({
        type: 'error',
        text: `${t.wiki.saveFailed}: ${error instanceof Error ? error.message : String(error)}`
      })
      toast.error(
        `${t.wiki.saveFailed}: ${error instanceof Error ? error.message : String(error)}`,
        { duration: TOAST_INTERVENTION_DURATION_MS }
      )
    } finally {
      setSavingSopLogId(null)
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

  function persistAgentRun(run: StoredAgentRun): void {
    const live = liveRunUsageRef.current.get(run.runId)
    void window.api.storage
      .saveAgentRun({
        ...run,
        inputTokens: run.inputTokens ?? live?.input,
        outputTokens: run.outputTokens ?? live?.output
      })
      .then(async () => {
        if (run.status === 'running') return
        const totals = await window.api.storage.getSessionTokenUsage(run.tabId)
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
    pendingAttentionNotifierRef.current.clear(`password:${passwordPromptRequest.tabId}`)
    setPasswordPromptValue('')
    setPasswordPromptError('')
    showNextPasswordPrompt(passwordPromptRequest.tabId)
  }

  function cancelPasswordPrompt(): void {
    if (passwordPromptRequest) {
      passwordPromptBuffersRef.current.set(passwordPromptRequest.tabId, '')
      passwordPromptOpenTabsRef.current.delete(passwordPromptRequest.tabId)
      passwordPromptsByTabRef.current.delete(passwordPromptRequest.tabId)
      pendingAttentionNotifierRef.current.clear(`password:${passwordPromptRequest.tabId}`)
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
    pendingAttentionNotifierRef.current.clear(`approval:${requestId}`)
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

    // Recovery brake #1: read SSOT first. Already on target -> nothing to do.
    const context = await window.api.terminal.getContext(tabId)
    if (context.alignment === 'aligned') {
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
    void window.api.terminal.setExpectedHost({ tabId, host: null })

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
        terminalReady: true,
        terminalStartError: undefined
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
        terminalReady: false,
        terminalStartError: message
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

    void window.api.connections.setLastUsed(connection.id).catch(() => undefined)

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
      // Recovery brake #2: never reinit + re-knock ssh on an already connected
      // terminal. Read the SSOT first; aligned means reuse as-is.
      const context = await window.api.terminal.getContext(targetTabId)
      // A session that is already sitting on a REMOTE prompt host is usable
      // even when the SSOT alignment says "drifted" (e.g. the configured host
      // is an IP while the remote prompt shows a hostname). Re-learn the
      // observed host as an alias instead of killing a working login.
      const onRemoteHost = Boolean(context.promptHost && context.promptHost !== 'local-shell')
      if (context.alignment === 'aligned' || onRemoteHost) {
        connTrace('connect-reuse-aligned', `tab=${targetTabId}`, 'skipping re-login')
        if (onRemoteHost && context.alignment !== 'aligned') {
          const verified = await window.api.terminal.confirmLogin({ tabId: targetTabId })
          connTrace('reuse-reconfirm', `tab=${targetTabId}`, `ok=${verified?.ok}`)
        }
        markChatTabReady(chatTabId)
        finalizeLoginRun(chatTabId, true, undefined, { targetTabId, connection })
        if (postConnectionTasksRef.current.get(targetTabId)?.length) {
          drainPostConnectionTasks(targetTabId)
        }
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
        void window.api.terminal.stop(targetTabId)
        try {
          await spawnAndLoginConnection(connection, targetTabId)
        } finally {
          reconnectingTabsRef.current.delete(targetTabId)
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
    try {
      const dimensions =
        tabId === activeTabIdRef.current ? fitAddonRef.current?.proposeDimensions() : undefined
      connTrace('spawn', `tab=${tabId}`)
      let session = await runWithTimeout(
        window.api.terminal.start({
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
        window.api.terminal.stop(tabId)
        session = await runWithTimeout(
          window.api.terminal.start({
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
        terminalReady: true,
        terminalStartError: undefined
      }))
      if (tabId === activeTabIdRef.current) {
        terminalSessionIdRef.current = session.sessionId
        terminalModeRef.current = session.mode
        terminalCwdRef.current = session.cwd
        pipePromptRef.current = formatPipePrompt(session.cwd)
      }
      connTrace('spawned', `tab=${tabId}`, `mode=${session.mode}`, `sid=${session.sessionId}`)
      await executeConnectionCommands(connection, tabId)
      return Boolean(tabsRef.current.find((tab) => tab.id === tabId)?.sessionId)
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
      void window.api.terminal.stop(targetTab.id)
      const session = await window.api.terminal.start({
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
    agentLogRef.current?.scrollTo({ top: agentLogRef.current.scrollHeight })
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
      agentStyle: config.agentStyle,
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

    const nextTab = createTerminalTab({
      title: getNextTerminalTitle(connection.name, tabsRef.current),
      providerId: config.providerId,
      agentStyle: config.agentStyle,
      connectionId: connection.id,
      connectionName: connection.name,
      isSsh: true
    })

    pendingSshRef.current.set(nextTab.id, connection)
    setTabs((current) => {
      const next = [...current, nextTab]
      tabsRef.current = next
      return next
    })
    activateTerminalTab(nextTab.id)
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

    void connectToConnection(connection)
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

  async function submitAgentMessage(
    overrideInput?: string,
    options?: { forcedConnectionId?: string; skipUserLog?: boolean }
  ): Promise<void> {
    const terminalTabId = activeTabIdRef.current
    const chatTabId = resolveSessionChatTabId(tabsRef.current, terminalTabId)
    const tab = tabsRef.current.find((candidate) => candidate.id === chatTabId)
    const terminalTab = tabsRef.current.find((candidate) => candidate.id === terminalTabId)
    const rawInput = (overrideInput ?? tab?.agentInput ?? '').trim()
    const displayInput = stripComposerRefTokens(rawInput).trim()
    if (!displayInput && !hasComposerRefTokens(rawInput)) return

    if (/^\/new$/i.test(displayInput)) {
      startNewSession()
      return
    }

    const skillRefs = tab?.skillRefs ?? []
    const pathRefs = tab?.pathRefs ?? []
    const toolRefs = tab?.toolRefs ?? []
    const wikiRefs = tab?.wikiRefs ?? []
    const wikiIds = [...(tab?.activeWikiIds ?? [])]
    const skillPaths = skillRefs.map((skill) => skill.path).filter(Boolean)
    const messageRefs = snapshotMessageReferences({
      skillRefs,
      wikiRefs,
      toolRefs,
      pathRefs
    })
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
        wikiRefs: [],
        activeWikiIds: []
      }))
      const runId = activeRunIdRef.current.get(chatTabId)
      if (runId) {
        const artifacts = buildBusySupplementArtifacts({
          displayInput: rawInput,
          runId,
          createdAt: new Date().toISOString(),
          stepId: `supplement-${Date.now()}`,
          references: messageRefs
        })
        appendLog(artifacts.logEntry, chatTabId)
        const ok = await window.api.agent
          .supplement({ runId, input: wrapSteerSupplementPayload(input) })
          .then((result) => result?.ok === true)
          .catch(() => false)
        if (!ok) {
          // The agent session may not be active yet (e.g. still logging in via
          // post-connection automation). Queue the supplement so it is merged
          // into the post-login task input instead of being silently dropped.
          const pending = pendingPostLoginSupplementsRef.current.get(chatTabId) ?? []
          pendingPostLoginSupplementsRef.current.set(chatTabId, [...pending, displayInput])
        }
        updateAgentRun(chatTabId, (run) => ({
          ...run,
          steps: [...(run.steps ?? []), artifacts.step]
        }))
      }
      return
    }

    updateTab(chatTabId, (current) => ({
      ...current,
      agentInput: '',
      skillRefs: [],
      pathRefs: [],
      toolRefs: [],
      wikiRefs: [],
      activeWikiIds: []
    }))
    // Clarify-card confirm resumes with skipUserLog — selection lives on the settled card
    // and assistant match steps, never as a second user bubble.
    if (!options?.skipUserLog) {
      appendLog(
        {
          kind: 'user',
          text: rawInput,
          references: messageRefs
        },
        chatTabId
      )
    }
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
    connTrace(
      'getContext',
      `tab=${terminalTabId}`,
      `aligned=${terminalContext.sessionAligned ?? 'n/a'}`,
      `expected=${terminalContext.expectedHost ?? '-'}`,
      `tail=${terminalContext.output.slice(-160).replace(/\n/g, '\\n')}`
    )
    if (terminalContext.sessionAligned === 'drifted') {
      // Remote side closed the SSH session while the outer PTY stayed alive.
      // Mark the tab not-ready and surface the reconnect state before routing.
      const driftedChatTabId = resolveSessionChatTabId(tabsRef.current, terminalTabId)
      updateConnectionAttempt(driftedChatTabId, (state) =>
        markConnectionFailed(state, { reason: t.terminal.connectionDriftedReconnecting })
      )
      updateTab(terminalTabId, (tab) => ({ ...tab, terminalReady: false }))
    }
    const pendingClarification = tab?.pendingClarification
    const activePending =
      !options?.forcedConnectionId &&
      pendingClarification?.kind === 'connection-intent' &&
      !pendingClarification.settled
    const intentSourceInput = activePending
      ? `${pendingClarification.originalInput}\n\n${t.terminal.connectionClarifyReplyPrefix}\n${displayInput}`
      : displayInput
    if (activePending) {
      updateTab(chatTabId, (current) => ({ ...current, pendingClarification: undefined }))
    } else if (pendingClarification?.settled && !options?.forcedConnectionId) {
      // Cancelled/stale settled card: drop on next typed submit.
      updateTab(chatTabId, (current) => ({ ...current, pendingClarification: undefined }))
    }

    const explicitNonTerminalRequest = isExplicitNonTerminalAgentRequest(displayInput, toolRefs)
    const explicitLocalFileRequest = hasExplicitLocalWorkIntent(intentSourceInput)
    const sessionTabs = getSessionTerminals(
      tabsRef.current,
      getSessionGroupId(tab ?? terminalTab ?? { id: terminalTabId, sessionGroupId: terminalTabId })
    )
    const lastUsedConnectionId =
      (await window.api.connections.getLastUsed().catch(() => null)) ?? undefined
    let route = routeConnection({
      message: intentSourceInput,
      activeTabId: terminalTabId,
      activeTab: terminalTab,
      sessionTabs,
      connections,
      resumeRequested,
      explicitNonTerminal: explicitNonTerminalRequest,
      explicitLocalFile: explicitLocalFileRequest,
      sessionAligned: terminalContext.sessionAligned
    })
    connTrace(
      'route',
      `action=${route.action}`,
      `reason=${route.reason ?? '-'}`,
      `target=${route.targetTabId}`,
      `aligned=${terminalContext.sessionAligned ?? 'n/a'}`
    )

    const forcedConnectionId = options?.forcedConnectionId?.trim()
    if (forcedConnectionId) {
      const forcedConnection = connections.find((candidate) => candidate.id === forcedConnectionId)
      if (!forcedConnection) {
        console.warn('[connection-clarify] forcedConnectionId not found', forcedConnectionId)
      } else {
        route = routeForcedConnection({
          connection: forcedConnection,
          message: intentSourceInput,
          activeTabId: terminalTabId,
          activeTab: terminalTab,
          sessionTabs
        })
      }
    }

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
    const activeLoggedIn = isActiveLoggedInTerminal(terminalTab)
    try {
      if (route.action === 'llm-fallback' && activeLoggedIn) {
        // Never let LLM / lastUsed steal an already logged-in active terminal.
        if (route.label) {
          setThinking(t.input.routingTo.replace('{label}', route.label))
        }
        connectionIntent = undefined
      } else if (route.action === 'llm-fallback') {
        setThinking(t.input.thinkingResolvingConnection)
        connectionIntent = await resolveConnectionIntentForInput(intentSourceInput, {
          conversationContext,
          currentConnectionId: terminalTab?.connectionId,
          currentConnectionName: terminalTab?.connectionName,
          terminalSummary
        })
        // User asked to log in but the model did not pick a target — ask, do not
        // guess lastUsed / the only configured host.
        if (
          isExplicitConnectionRequest(intentSourceInput) &&
          connectionIntent.analysis &&
          !connectionIntent.analysis.needsClarification &&
          !connectionIntent.analysis.shouldConnect
        ) {
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
                        prioritizeClarifyOptions(
                          connections.map((c) => ({ id: c.id, label: c.name })),
                          terminalTab?.connectionId,
                          t.terminal.clarifyCurrentBadge
                        )
                      )
                    )
                  : t.terminal.connectionNoneConfigured,
              reason: 'llm-no-connect-login'
            }
          }
        }
      } else if (route.action === 'clarify') {
        const clarifyOptions = prioritizeClarifyOptions(
          route.clarifyOptions && route.clarifyOptions.length > 0
            ? route.clarifyOptions
            : connections.map((c) => ({ id: c.id, label: c.name })),
          terminalTab?.connectionId,
          t.terminal.clarifyCurrentBadge
        )
        const optionsText = formatConnectionClarifyOptions(clarifyOptions)
        const clarificationQuestion =
          route.reason === 'remote-no-connections'
            ? t.terminal.connectionNoneConfigured
            : optionsText
              ? t.terminal.connectionClarifyPickOne.replace('{options}', optionsText)
              : t.terminal.connectionClarifyFallback
        route = { ...route, clarifyOptions }
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
      } else if ((route.action === 'connect' || route.action === 'switch') && route.connection) {
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
        if (route.reason === 'active-logged-in' && route.label) {
          appendStatusToActiveRunOrLog(
            chatTabId,
            t.terminal.usingCurrentConnection.replace('{name}', route.label)
          )
        }
      }
    } finally {
      // Keep thinking visible until the next concrete UI phase replaces it.
    }

    if (connectionIntent?.analysis?.needsClarification) {
      clearThinking()
      const question =
        connectionIntent.analysis.clarificationQuestion?.trim() ||
        t.terminal.connectionClarifyFallback
      const clarifyOptions = prioritizeClarifyOptions(
        route.clarifyOptions && route.clarifyOptions.length > 0
          ? route.clarifyOptions
          : connections.map((c) => ({ id: c.id, label: c.name })),
        terminalTab?.connectionId,
        t.terminal.clarifyCurrentBadge
      )
      const defaultOptionId =
        (terminalTab?.connectionId &&
        clarifyOptions.some((option) => option.id === terminalTab.connectionId)
          ? terminalTab.connectionId
          : undefined) ||
        (lastUsedConnectionId && clarifyOptions.some((option) => option.id === lastUsedConnectionId)
          ? lastUsedConnectionId
          : undefined)
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
          routeId: `clarify-${crypto.randomUUID()}`,
          originalInput: pendingClarification?.originalInput || displayInput,
          question,
          options: clarifyOptions.length > 0 ? clarifyOptions : undefined,
          defaultOptionId
        }
      }))
      pendingAttentionNotifierRef.current.notifyIfUnfocused(
        `clarify:${chatTabId}`,
        t.notifications.clarifyTitle,
        t.notifications.clarifyBody
      )
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

    // Explicit login without a resolved target must not fall through to the main
    // model (it would otherwise invent a login method). Non-login work proceeds.
    if (
      !activeLoggedIn &&
      !connectionIntent?.analysis?.shouldConnect &&
      isExplicitConnectionRequest(intentSourceInput) &&
      connections.length > 0 &&
      !(
        tabsRef.current.find((candidate) => candidate.id === executionTerminalId)?.connectionId ||
        terminalTab?.connectionId ||
        terminalTab?.isSsh
      )
    ) {
      clearThinking()
      const clarifyOptions = prioritizeClarifyOptions(
        connections.map((c) => ({ id: c.id, label: c.name })),
        terminalTab?.connectionId,
        t.terminal.clarifyCurrentBadge
      )
      const optionsText = formatConnectionClarifyOptions(clarifyOptions)
      const question = t.terminal.connectionClarifyPickOne.replace('{options}', optionsText)
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
          routeId: `clarify-${crypto.randomUUID()}`,
          originalInput: pendingClarification?.originalInput || displayInput,
          question,
          options: clarifyOptions.length > 0 ? clarifyOptions : undefined,
          defaultOptionId
        }
      }))
      pendingAttentionNotifierRef.current.notifyIfUnfocused(
        `clarify:${chatTabId}`,
        t.notifications.clarifyTitle,
        t.notifications.clarifyBody
      )
      return
    }

    if (
      activeLoggedIn &&
      connectionIntent?.analysis?.shouldConnect &&
      connectionIntent.connection?.id &&
      connectionIntent.connection.id !== terminalTab?.connectionId &&
      !options?.forcedConnectionId &&
      route.action !== 'connect' &&
      route.action !== 'switch'
    ) {
      // LLM / lastUsed must not steal a logged-in active terminal; explicit route actions may.
      connectionIntent = undefined
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
          thinkingMessage: undefined,
          pendingClarification: retainSettledClarification(current.pendingClarification)
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
        void persistAgentRun({
          runId,
          tabId: chatTabId,
          input: displayInput,
          status: 'running',
          connectionId: matchedConnection.id
        })

        const targetTabId = await connectToConnection(
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
          { logId: runLogId, runId },
          { activeWikiIds: wikiIds, activeSkillPaths: skillPaths }
        )
        setActiveExecutionTerminal(chatTabId, targetTabId)
        return
      }

      // Pure login (no follow-up task) still gets an assistant-run card so the
      // connection flow steps land inside it instead of scattered system rows.
      const loginRunId = `run-${crypto.randomUUID()}`
      updateTab(chatTabId, (current) => ({
        ...current,
        agentInput: '',
        agentBusy: true,
        agentThinking: false,
        thinkingMessage: undefined,
        pendingClarification: retainSettledClarification(current.pendingClarification)
      }))
      activeRunCanceledRef.current.delete(chatTabId)
      activeRunIdRef.current.set(chatTabId, loginRunId)
      activeRunInputRef.current.set(chatTabId, displayInput)
      const loginMatchStep = {
        id: 'match',
        kind: 'status' as const,
        title: t.terminal.connectionMatched,
        detail: matchDetail
      }
      const loginRunLogId = appendLog(
        {
          kind: 'assistant',
          text: formatAgentRunMarkdown(
            {
              logId: -1,
              actions: [],
              steps: [loginMatchStep],
              startedAt
            },
            t
          )
        },
        chatTabId
      )
      activeAgentRunRef.current.set(chatTabId, {
        logId: loginRunLogId,
        runId: loginRunId,
        actions: [],
        steps: [loginMatchStep],
        startedAt,
        loginMeta: {
          connectionName: matchedConnection.name,
          host: matchedConnection.host,
          port: matchedConnection.port,
          user: matchedConnection.user,
          actionCount: buildConnectionLoginActions(matchedConnection).length
        }
      })
      lastLoginRunLogIdRef.current.set(chatTabId, loginRunLogId)
      updateAgentRun(chatTabId, (run) => run)
      void persistAgentRun({
        runId: loginRunId,
        tabId: chatTabId,
        input: displayInput,
        status: 'running',
        connectionId: matchedConnection.id
      })

      void connectToConnection(matchedConnection)
      updateTab(chatTabId, (current) => ({
        ...current,
        pendingClarification: retainSettledClarification(current.pendingClarification)
      }))
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

    // Gate: ensure local PTY exists even when the terminal pane is hidden (xterm never mounted).
    const ensureResult = await ensureLocalTerminalStarted({
      tab: executionTab ?? createTerminalTab({ id: executionTerminalId, title: 'Terminal' }),
      getContext: async () => window.api.terminal.getContext(executionTerminalId),
      start: async () => {
        const dimensions =
          executionTerminalId === activeTabIdRef.current
            ? fitAddonRef.current?.proposeDimensions()
            : undefined
        return window.api.terminal.start({
          cols: dimensions?.cols ?? 80,
          rows: dimensions?.rows ?? 24,
          tabId: executionTerminalId
        })
      }
    })
    updateTab(executionTerminalId, () => ensureResult.tab)
    if (executionTerminalId === activeTabIdRef.current && ensureResult.ok) {
      terminalSessionIdRef.current = ensureResult.tab.sessionId ?? null
      terminalModeRef.current = ensureResult.tab.terminalMode
      terminalCwdRef.current = ensureResult.tab.terminalCwd
      pipePromptRef.current = formatPipePrompt(ensureResult.tab.terminalCwd)
    }

    const executionTabAfterEnsure =
      tabsRef.current.find((candidate) => candidate.id === executionTerminalId) ?? ensureResult.tab
    const isRemote = isRemoteExecutionTab(executionTabAfterEnsure)
    // Local non-SSH: skip long SSH wait — snapshot ready check only.
    const waitedOk = isRemote
      ? await waitForTerminalReadyForAgent(executionTerminalId, {
          getTab: () => tabsRef.current.find((candidate) => candidate.id === executionTerminalId)
        })
      : true
    const executionContext = await window.api.terminal.getContext(executionTerminalId)
    const readyTab = tabsRef.current.find((candidate) => candidate.id === executionTerminalId)
    const gate = resolveTerminalReadyGateOutcome({
      ensureOk: ensureResult.ok,
      ensureError: ensureResult.error,
      tab: readyTab,
      terminalMode: executionContext.mode,
      waitedOk:
        waitedOk &&
        isTerminalSnapshotReadyForAgent({
          tab: readyTab,
          terminalMode: executionContext.mode,
          output: executionContext.output
        }),
      failedToStartShellNotReady: t.terminal.failedToStartShellNotReady
    })
    if (gate.kind !== 'ready') {
      clearThinking()
      if (gate.kind === 'clarify') {
        const clarifyOptions = buildTerminalNotReadyClarifyOptions({
          connections: connections.map((c) => ({ id: c.id, label: c.name })),
          manualContinueLabel: t.terminal.clarifyManualContinue,
          openConnectionsLabel: t.terminal.clarifyOpenConnections
        })
        const question = t.terminal.connectionNotReadyClarify
        appendLog(
          {
            kind: 'assistant',
            text: formatAgentRunMarkdown(
              {
                logId: -1,
                actions: [],
                steps: [
                  {
                    id: 'terminal-not-ready-clarify',
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
            routeId: `clarify-${crypto.randomUUID()}`,
            originalInput: displayInput,
            question,
            options: clarifyOptions,
            defaultOptionId: CLARIFY_MANUAL_CONTINUE_ID
          }
        }))
        pendingAttentionNotifierRef.current.notifyIfUnfocused(
          `clarify:${chatTabId}`,
          t.notifications.clarifyTitle,
          t.notifications.clarifyBody
        )
        return
      }

      const reason = gate.reason
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
                  detail: reason
                }
              ],
              error: t.terminal.failedToStartShellReason.replace('{reason}', reason),
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
      readyTab?.connectionId || terminalTab?.connectionId || undefined,
      displayInput,
      false,
      startedAt,
      {
        conversationContext,
        chatTabId,
        connectionRouteLabel: route.label,
        activeWikiIds: wikiIds,
        activeSkillPaths: skillPaths
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
      activeWikiIds?: string[]
      activeSkillPaths?: string[]
    } = {}
  ): Promise<void> {
    const chatTabId = options.chatTabId ?? resolveSessionChatTabId(tabsRef.current, terminalTabId)
    // Merge supplements that were queued while no agent session was active
    // (e.g. typed during connection login) into the task that starts now.
    const pendingSupplements = pendingPostLoginSupplementsRef.current.get(chatTabId) ?? []
    if (pendingSupplements.length > 0) {
      pendingPostLoginSupplementsRef.current.delete(chatTabId)
      input = mergePostLoginSupplements(input, pendingSupplements)
    }
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
      thinkingMessage: undefined,
      pendingClarification: retainSettledClarification(current.pendingClarification)
    }))
    activeRunCanceledRef.current.delete(chatTabId)
    const runId = existingReuse?.runId ?? reuseRun?.runId ?? `run-${crypto.randomUUID()}`
    activeRunIdRef.current.set(chatTabId, runId)
    activeRunInputRef.current.set(chatTabId, displayInput)
    setActiveExecutionTerminal(chatTabId, terminalTabId)
    void persistAgentRun({
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
        startedAt: existingReuse.startedAt ?? startedAt,
        error: undefined,
        elapsedMs: undefined
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
        const executionTab =
          tabsRef.current.find((candidate) => candidate.id === executionTabId) ?? runTab
        const executionConnection = connections.find(
          (candidate) => candidate.id === executionTab?.connectionId
        )
        const loggedIn = isActiveLoggedInTerminal(executionTab)
        const routeLine = options.connectionRouteLabel?.trim()
          ? `当前终端/连接：${options.connectionRouteLabel.trim()}`
          : ''
        terminalContext = [
          routeLine,
          `tabId: ${executionTabId}`,
          executionTab?.connectionId ? `connectionId: ${executionTab.connectionId}` : '',
          executionTab?.connectionName ? `connectionName: ${executionTab.connectionName}` : '',
          executionConnection?.host ? `host: ${executionConnection.host}` : '',
          `loggedIn: ${loggedIn ? 'yes' : 'no'}`,
          `alignment: ${context.alignment ?? 'unknown'}`,
          `ready: ${context.ready ? 'yes' : 'no'}`,
          `promptHost: ${context.promptHost ?? '-'}`,
          `aliases: ${(context.aliases ?? []).join(',') || '-'}`,
          `terminalReady: ${executionTab?.terminalReady ? 'yes' : 'no'}`,
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
        locale,
        agentStyle: normalizeAgentStyle(sessionAgentStyle),
        activeWikiIds: options.activeWikiIds ?? chatTab?.activeWikiIds ?? [],
        activeSkillPaths:
          options.activeSkillPaths ??
          (chatTab?.skillRefs ?? []).map((skill) => skill.path).filter(Boolean)
      })

      if (activeRunCanceledRef.current.has(chatTabId)) return

      const notifyRunOutcome = (outcome: 'success' | 'error', summaryText: string): void => {
        if (activeRunCanceledRef.current.has(chatTabId)) return
        const title =
          outcome === 'success' ? t.notifications.runCompleteTitle : t.notifications.runFailedTitle
        const body =
          summarizeNotificationBody(summaryText) ||
          (outcome === 'success' ? t.input.done : t.input.failed)
        pendingAttentionNotifierRef.current.notifyRunComplete(runId, title, body)
      }

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
          void persistAgentRun({
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
          notifyRunOutcome('error', resolved.error)
        } else {
          updateAgentRun(chatTabId, (run) => ({
            ...run,
            steps: closeStreamingOpenSteps(run.steps ?? []),
            result: clampAgentText(resolved.text ?? '', AGENT_RUN_STREAM_MAX_CHARS),
            elapsedMs
          }))
          void persistAgentRun({
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
          notifyRunOutcome('success', resolved.text)
        }
      } else {
        const elapsedMs = Date.now() - startedAt
        const humanError = localizeAgentEventMessage(result.error || t.input.failed, t)
        updateAgentRun(chatTabId, (run) => ({
          ...run,
          steps: closeStreamingOpenSteps(run.steps ?? []),
          error: humanError,
          elapsedMs
        }))
        void persistAgentRun({
          runId,
          tabId: chatTabId,
          input: displayInput,
          status: 'error',
          connectionId,
          error: humanError,
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
            error: humanError
          })
        })
        notifyRunOutcome('error', humanError)
      }
    } catch (error) {
      if (activeRunCanceledRef.current.has(chatTabId)) return

      const rawMessage = error instanceof Error ? error.message : String(error)
      const message = localizeAgentEventMessage(rawMessage, t)
      const elapsedMs = Date.now() - startedAt
      updateAgentRun(chatTabId, (run) => ({
        ...run,
        steps: closeStreamingOpenSteps(run.steps ?? []),
        error: message,
        elapsedMs
      }))
      void persistAgentRun({
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
      pendingAttentionNotifierRef.current.notifyRunComplete(
        runId,
        t.notifications.runFailedTitle,
        summarizeNotificationBody(message) || t.input.failed
      )
    } finally {
      // Only tear down if this run is still the active one (stop→resubmit race).
      if (activeRunIdRef.current.get(chatTabId) === runId) {
        const finishedRun = activeAgentRunRef.current.get(chatTabId)
        const finishedLogId = finishedRun?.logId
        // Persist the full compact document to SQLite; updateLogEntryText
        // structure-clamps only the in-memory agentLog copy for OOM safety.
        if (finishedRun && typeof finishedLogId === 'number') {
          try {
            updateLogEntryText(chatTabId, finishedLogId, buildFinishPersistText(finishedRun))
          } catch (error) {
            console.warn('[crescent] finish snapshot write failed; continuing teardown', error)
          }
        }
        activeAgentRunRef.current.delete(chatTabId)
        activeRunCanceledRef.current.delete(chatTabId)
        activeRunIdRef.current.delete(chatTabId)
        activeRunInputRef.current.delete(chatTabId)
        if (typeof finishedLogId === 'number') pruneLiveRuns([finishedLogId])
        updateTab(chatTabId, (current) => ({
          ...current,
          agentInput: '',
          agentBusy: false,
          agentThinking: false,
          thinkingMessage: undefined
        }))
      }
    }
  }

  function slashReplacementCursor(input: string): number {
    return getSlashCommandQuery(input, composerCaret) !== undefined ? composerCaret : input.length
  }

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

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        insertSlashCommand(slashCommandOptions[selectedSlashCommandIndex])
        return
      }
    }

    if (event.key !== 'Enter' || event.shiftKey) return

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
    const shouldOpenExtList = command.id === 'ext'
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
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      void pickPathReference(command.pathReferenceKind)
      return
    }

    if (command.toolRef) {
      const toolRef = command.toolRef as AgentToolReference
      updateTab(sessionChatTab.id, (tab) =>
        applyComposerInput(
          tab,
          replaceSlashCommandInput(
            tab.agentInput,
            formatComposerRefToken('tool', toolRef.id),
            slashReplacementCursor(tab.agentInput)
          ),
          { toolRefs: addUniqueToolRef(tab.toolRefs, toolRef) }
        )
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
        return applyComposerInput(
          tab,
          replaceSlashCommandInput(
            tab.agentInput,
            formatComposerRefToken('wiki', wikiRef.id),
            slashReplacementCursor(tab.agentInput)
          ),
          {
            activeWikiIds: ids.includes(wikiRef.id) ? ids : [...ids, wikiRef.id],
            wikiRefs: addUniqueWikiRef(tab.wikiRefs, {
              id: wikiRef.id,
              title: wikiRef.title,
              path: wikiRef.path,
              content: ''
            })
          }
        )
      })
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      return
    }

    if (command.agentStyle) {
      applyConversationStyle(command.agentStyle)
      updateTab(sessionChatTab.id, (tab) =>
        applyComposerInput(
          tab,
          replaceSlashCommandInput(tab.agentInput, '', slashReplacementCursor(tab.agentInput))
        )
      )
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      return
    }

    if (command.connection) {
      updateTab(sessionChatTab.id, (tab) =>
        applyComposerInput(
          tab,
          replaceSlashCommandInput(tab.agentInput, '', slashReplacementCursor(tab.agentInput))
        )
      )
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      void connectToConnection(command.connection)
      return
    }

    if (command.extensionCommand) {
      const extensionCommand = command.extensionCommand
      updateTab(sessionChatTab.id, (tab) =>
        applyComposerInput(
          tab,
          replaceSlashCommandInput(tab.agentInput, '', slashReplacementCursor(tab.agentInput))
        )
      )
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      void window.api.agent
        .runExtensionCommand({
          name: extensionCommand.name,
          tabId: sessionChatTab.id
        })
        .then((result) => {
          if (result.busy) {
            toast.message(t.settings.extensionCommandBusy)
            return
          }
          if (!result.ok) {
            toast.error(result.error || t.settings.extensionCommandFailed)
          }
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : t.settings.extensionCommandFailed)
        })
      return
    }

    updateTab(sessionChatTab.id, (tab) => {
      const replacement = command.skill
        ? formatComposerRefToken('skill', command.skill.id)
        : (command.templateInput ?? command.value)
      return applyComposerInput(
        tab,
        replaceSlashCommandInput(
          tab.agentInput,
          replacement,
          slashReplacementCursor(tab.agentInput)
        ),
        command.skill ? { skillRefs: addUniqueSkillRef(tab.skillRefs, command.skill) } : {}
      )
    })
    setSlashCommandIndex(0)
    setSlashCommandOpen(
      shouldOpenStyleList ||
        shouldOpenSkillList ||
        shouldOpenExtList ||
        shouldOpenConnectionList ||
        shouldOpenToolList ||
        shouldOpenMcpList ||
        shouldOpenWikiList
    )
  }

  function removeSkillRef(skillId: string): void {
    updateTab(sessionChatTab.id, (tab) =>
      applyComposerInput(tab, removeComposerRefToken(tab.agentInput, 'skill', skillId))
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
      return applyComposerInput(
        tab,
        replaceSlashCommandInput(
          tab.agentInput,
          formatComposerRefToken('wiki', document.id),
          slashReplacementCursor(tab.agentInput)
        ),
        {
          activeWikiIds: ids.includes(document.id) ? ids : [...ids, document.id],
          wikiRefs: addUniqueWikiRef(tab.wikiRefs, {
            id: document.id,
            title: document.title,
            path: document.path,
            content: ''
          })
        }
      )
    })
  }

  async function pickPathReference(kind: AgentPathReference['kind']): Promise<void> {
    const reference = await window.api.agent.pickPathReference(kind)
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

  function updateSettingsMcpServers(nextServers: AgentMcpServerConfig[]): void {
    setConfig((current) => ({ ...current, mcpServers: nextServers }))
    setValidation(undefined)
  }

  async function saveMcpServers(nextServers: AgentMcpServerConfig[]): Promise<void> {
    const nextConfig = await saveAgentConfig({
      ...config,
      mcpServers: nextServers,
      commandWhitelist: parseCommandWhitelist(commandWhitelistText)
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
    void validateConfig(nextConfig)
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

  async function exportSessionTrace(): Promise<void> {
    const tabId = sessionChatTab.id
    const title = getSessionDisplayTitle(sessionChatTab, tabs, activeTab.id)
    const [runs, storedUsage] = await Promise.all([
      window.api.storage.listAllAgentRuns(tabId),
      window.api.storage.getSessionTokenUsage(tabId)
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
      toast.error(t.common.opsFeedbackAlreadyRated, {
        duration: TOAST_INTERVENTION_DURATION_MS
      })
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
      toast.error(t.common.opsFeedbackFailed, { duration: TOAST_INTERVENTION_DURATION_MS })
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
        toast.error(result.error || t.common.opsFeedbackFailed, {
          duration: TOAST_INTERVENTION_DURATION_MS
        })
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
      onPreviewCatalogSkill={(result) => void previewCatalogSkill(result)}
      onDeleteSkillInstallLog={deleteSkillInstallLog}
      onSelectedSkillPreviewChange={setSelectedSkillPreview}
      onSkillInstallLogResultIdChange={setSkillInstallLogResultId}
    />
  )

  const extensionSheet = (
    <ExtensionManager
      open={extensionOpen}
      onOpenChange={setExtensionOpen}
      t={t}
      extensions={extensions}
      searchQuery={extensionSearchQuery}
      catalogQuery={extensionCatalogQuery}
      catalogResults={extensionCatalogResults}
      catalogLoading={extensionCatalogLoading}
      installingSource={extensionInstallingSource}
      manageMessage={extensionManageMessage}
      deletingPath={extensionDeletingPath}
      preview={selectedExtensionPreview}
      previewLoadingPath={extensionPreviewLoadingPath}
      onSearchQueryChange={setExtensionSearchQuery}
      onCatalogQueryChange={setExtensionCatalogQuery}
      onRefresh={() => void refreshExtensions()}
      onImport={() => void importExtension()}
      onSearchCatalog={() => void searchExtensionCatalog()}
      onInstallPackage={(result) => void installExtensionPackage(result)}
      onDelete={(extension) => void deleteExtension(extension)}
      onToggleEnabled={(extension, enabled) => void toggleExtensionEnabled(extension, enabled)}
      onPreview={(extension) => void previewExtension(extension)}
      onPreviewChange={setSelectedExtensionPreview}
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
            aria-label={t.settings.extensionsManagement}
            title={t.settings.extensionsManagement}
            onClick={() => setExtensionOpen(true)}
          >
            <PuzzleIcon aria-hidden="true" />
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
            saved={saved}
            importingOpenApi={importingOpenApi}
            closeTerminalConfirmEnabled={closeTerminalConfirmEnabled}
            onCreateProvider={createProvider}
            onToggleProviderDetails={toggleProviderDetails}
            onDeleteProvider={deleteSettingsProvider}
            onApplyDefaultModel={applyDefaultModel}
            onCloseTerminalConfirmChange={setCloseTerminalConfirmEnabled}
            onAgentStyleChange={(style) => updateConfig('agentStyle', style)}
            onShowAgentThinkingChange={(value) => updateConfig('showAgentThinking', value)}
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
            onSaveConfig={saveConfig}
          />
        </div>
      </header>
      {skillSheet}
      {extensionSheet}
      {mcpSheet}
      {historySheet}
      {wikiSheet}
      <section
        className={`app-frame relative flex min-h-0 flex-1 ${terminalPaneFirst ? 'flex-row' : 'flex-row-reverse'}`}
      >
        {hiddenPane === 'chat' && (
          <button
            type="button"
            className="chat-pane-rail group absolute inset-y-0 right-2 z-20 my-auto flex h-28 w-8 items-center justify-center rounded-lg border border-border/70 bg-card/90 shadow-md transition-[width,border-color,background-color] duration-200 hover:w-9 hover:border-primary/40 hover:bg-card"
            aria-label={t.app.showChat}
            title={t.app.showChat}
            onClick={() => setHiddenPane(null)}
          >
            <span className="flex flex-col items-center gap-2 text-muted-foreground transition-colors group-hover:text-foreground">
              <MessageSquareIcon className="h-4 w-4" aria-hidden="true" />
              <span className="text-[10px] font-medium tracking-[0.18em] [writing-mode:vertical-rl]">
                {t.app.chat}
              </span>
            </span>
          </button>
        )}
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
            onViewRecovery={viewConnectionRecovery}
            onDismissRecovery={() => dismissConnectionRecovery(sessionChatTab.id)}
          />
        )}
        {!hiddenPane && (
          <div
            className="app-pane-resizer w-1.5 shrink-0 cursor-col-resize outline-none focus-visible:ring-0"
            role="separator"
            tabIndex={0}
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
            sessionInputTokens={sessionTokenUsage.input}
            sessionOutputTokens={sessionTokenUsage.output}
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
            hasEarlierLogs={hasEarlierLogs}
            loadingEarlier={loadingEarlierLogs}
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
            onToggleTerminalPane={() => {
              setHiddenPane((current) => (current === 'terminal' ? null : 'terminal'))
            }}
            onHideChatPane={() => setHiddenPane('chat')}
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
      <ExtensionUiDialog
        key={extensionUiRequest?.id ?? 'extension-ui-idle'}
        request={extensionUiRequest}
        t={t}
        onResolve={(input) => {
          const request = extensionUiRequest
          if (!request) return
          setExtensionUiRequest(null)
          void window.api.agent.resolveExtensionUi({
            requestId: request.id,
            cancelled: input.cancelled,
            confirmed: input.confirmed,
            value: input.value
          })
        }}
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
      <AppFooter
        version={appVersion}
        updateStatus={appUpdateStatus}
        agentStyle={sessionAgentStyle}
        t={t}
        onDownloadUpdate={() => {
          if (appUpdateStatus.state === 'downloading') return
          setAppUpdateStatus({
            state: 'downloading',
            percent: 0,
            bytesPerSecond: 0,
            transferred: 0,
            total: 0
          })
          void window.api.update.downloadInstaller().then((result) => {
            if (!result.ok) {
              toast.error(result.error || t.settings.updateDownloadFailed)
              setAppUpdateStatus({
                state: 'error',
                message: result.error || t.settings.updateDownloadFailed
              })
            }
          })
        }}
      />
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

function isComposingInput(event: KeyboardEvent<HTMLElement>): boolean {
  const reactEvent = event as KeyboardEvent<HTMLElement> & { isComposing?: boolean }
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
  appendLog: (entry: AgentLogEntryInput, tabId?: string) => void,
  appendSystem: (text: string, tabId: string) => void,
  t: Dictionary,
  logTabId = tabId
): Promise<boolean> {
  const [sshCommand, ...loginActions] = commands
  if (!sshCommand) return true

  // Paste into a shell that is still sourcing startup files can drop the
  // command: zsh's line editor discards input typed before the first prompt
  // (the PTY still echoes it, which is why the terminal shows the line). Wait
  // for the shell to be interactive before pasting, then proceed regardless on
  // timeout so a slow/headless prompt never blocks the login forever.
  const shellInteractive = await waitForShellInteractive(tabId)
  connTrace('login-stage', `tab=${tabId}`, `shellInteractive=${shellInteractive}`)

  const firstActionReady = loginActions.length ? waitForTerminalActionPrompt(tabId) : undefined
  window.api.terminal.pasteCommand(sshCommand, true, tabId)

  if (loginActions.length === 0) return true

  for (let index = 0; index < loginActions.length; index += 1) {
    const action = loginActions[index]
    const actionStart = Date.now()
    const ready =
      index === 0
        ? await firstActionReady
        : await waitForTerminalIdle(tabId, { ignoredEcho: loginActions[index - 1] })
    connTrace(
      'login-stage',
      `tab=${tabId}`,
      `action=${index + 1}`,
      `ready=${ready}`,
      `readyAfterMs=${Date.now() - actionStart}`
    )
    if (!ready) {
      // The interactive-prompt event can be missed by the renderer data
      // subscription (coalescing/backpressure). Re-check the live context; if
      // the terminal is actually at a password prompt now, send the action
      // anyway instead of aborting the whole login.
      const context = await window.api.terminal.getContext(tabId)
      if (hasInteractivePrompt(context.output)) {
        connTrace('login-stage', `tab=${tabId}`, `action=${index + 1}`, 'prompt-recheck=hit')
        sendTerminalInput(action, tabId)
        appendSystem(formatConnectionActionLog(action, index + 1, t), logTabId)
        continue
      }
      // Still not ready: the login may have completed without an interactive
      // prompt (key-based auth) or the terminal may be waiting on the user.
      // Do NOT abort here — waitForPromptHostOrTimeout is the authoritative
      // completion check and runs right after this sequence.
      appendLog(
        {
          kind: 'status',
          text: `${t.terminal.outputSettleTimeout} (${index + 1})`
        },
        logTabId
      )
      break
    }

    sendTerminalInput(action, tabId)
    appendSystem(formatConnectionActionLog(action, index + 1, t), logTabId)
  }

  return true
}

async function runConnectionLoginActionSequence(
  loginActions: string[],
  tabId: string,
  appendLog: (entry: AgentLogEntryInput, tabId?: string) => void,
  appendSystem: (text: string, tabId: string) => void,
  t: Dictionary,
  logTabId = tabId
): Promise<boolean> {
  if (loginActions.length === 0) return true

  const firstActionReady = waitForTerminalActionPrompt(tabId)
  for (let index = 0; index < loginActions.length; index += 1) {
    const action = loginActions[index]
    const actionStart = Date.now()
    const ready =
      index === 0
        ? await firstActionReady
        : await waitForTerminalIdle(tabId, { ignoredEcho: loginActions[index - 1] })
    connTrace(
      'login-stage',
      `tab=${tabId}`,
      `action=${index + 1}`,
      `ready=${ready}`,
      `readyAfterMs=${Date.now() - actionStart}`
    )
    if (!ready) {
      const context = await window.api.terminal.getContext(tabId)
      if (hasInteractivePrompt(context.output)) {
        connTrace('login-stage', `tab=${tabId}`, `action=${index + 1}`, 'prompt-recheck=hit')
        sendTerminalInput(action, tabId)
        appendSystem(formatConnectionActionLog(action, index + 1, t), logTabId)
        continue
      }
      appendLog(
        {
          kind: 'status',
          text: `${t.terminal.outputSettleTimeout} (${index + 1})`
        },
        logTabId
      )
      break
    }

    sendTerminalInput(action, tabId)
    appendSystem(formatConnectionActionLog(action, index + 1, t), logTabId)
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

async function waitForTerminalReadyForAgent(
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

async function settleAgentCancel(runId: string): Promise<void> {
  try {
    await window.api.agent.cancel(runId)
  } catch {
    // Ignore cancel transport errors; UI still clears after settle.
  }
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

/**
 * Wait until the terminal shell has produced an interactive prompt (local or
 * remote host style). A freshly spawned PTY is ready only after the shell
 * finishes its startup files; pasting earlier loses the command in zsh.
 */
async function waitForShellInteractive(tabId: string, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const context = await window.api.terminal.getContext(tabId)
    const signal = findNewestPromptSignal(context.output)
    if (signal?.kind === 'local' || signal?.kind === 'host') return true
    await sleep(200)
  }

  return false
}

/**
 * Poll SSOT for the REMOTE prompt during the login window. A transient local
 * prompt (fresh PTY before ssh connects) must NOT abort confirmation; only
 * when the whole window expires with the shell still at the local prompt does
 * the login count as failed.
 */
async function waitForPromptHostOrTimeout(
  tabId: string,
  timeoutMs = 20_000,
  options?: {
    expectedHost?: string
    previousHost?: string
    acceptAnyRemoteHost?: boolean
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
      acceptAnyRemoteHost: options?.acceptAnyRemoteHost
    }
  )
}

function sendTerminalInput(value: string, tabId: string): void {
  window.api.terminal.write(`${value}\r`, tabId)
}

/**
 * Multi-hop login target: scan the connection command list for the LAST
 * `ssh <host>` (login action or the leading ssh command) and return that host.
 * This is the true environment the session is expected to end on; the
 * configured connection.host is only the jump box.
 */
function resolveFinalSshTarget(
  commands: string[],
  connection: ConnectionConfig
): string | undefined {
  let target: string | undefined
  for (const command of commands) {
    const trimmed = command.trim()
    const match = trimmed.match(/^ssh(?:\s+-[A-Za-z0-9][^\s]*)*\s+([^\s]+)/)
    if (match?.[1]) target = match[1].replace(/^['"]|['"]$/g, '')
  }
  return target || connection.host || undefined
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

function buildSessionTraceFilename(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/T/, '_')
    .replace(/Z$/, '')
  return `crescent-session-trace-${timestamp}.json`
}

export default App
