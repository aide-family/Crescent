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
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import {
  ArrowLeftRightIcon,
  ArrowUpIcon,
  BookOpenIcon,
  BotIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  FolderOpenIcon,
  HistoryIcon,
  LanguagesIcon,
  Loader2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  ServerIcon,
  SettingsIcon,
  SearchIcon,
  TestTube2Icon,
  TriangleAlertIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'
import { Toaster } from 'sonner'

import { AgentLogList } from '@renderer/components/AgentLogList'
import { AgentReferenceBadges } from '@renderer/components/AgentReferenceBadges'
import { AppFooter } from '@renderer/components/AppFooter'
import {
  CloseTabsConfirmModal,
  CommandApprovalModal,
  PasswordPromptModal,
  type CloseTabsConfirmRequest,
  type PasswordPromptRequest
} from '@renderer/components/AppModals'
import { ConnectionList } from '@renderer/components/ConnectionList'
import { ConnectionManagerModal } from '@renderer/components/ConnectionManagerModal'
import { MarkdownContent, extractResultMarkdown } from '@renderer/components/MarkdownContent'
import { ProductLogo } from '@renderer/components/ProductLogo'
import {
  McpStatusDot,
  SkillInstallStatusDot,
  SkillManageStatus,
  StatusDot,
  type SkillInstallLogStatus,
  type SkillManageMessage
} from '@renderer/components/StatusIndicators'
import { SlashCommandMenu } from '@renderer/components/SlashCommandMenu'
import { SubterminalPanel } from '@renderer/components/SubterminalPanel'
import { TerminalTabBar } from '@renderer/components/TerminalTabBar'
import { WikiSheet } from '@renderer/components/WikiSheet'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Separator } from '@renderer/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger
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
import { useConnections } from '@renderer/hooks/useConnections'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTerminalSessions } from '@renderer/hooks/useTerminalSessions'
import {
  appendElapsedFooter,
  formatAgentRunMarkdown,
  formatHistoryTime,
  hydrateStoredAgentLog
} from '@renderer/lib/agent-log'
import { riskLabel } from '@renderer/lib/agent-event-formatters'
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
  getPipePrompt,
  hasConfiguredModelSelection,
  resolveInitialPaneOrder,
  type PaneOrder
} from '@renderer/lib/app-shell'
import {
  WIKI_MIN_PREVIEW_WIDTH,
  WIKI_REFRESH_MIN_LOADING_MS,
  WIKI_SHEET_SELECTED_FIXED_WIDTH,
  buildModelSelectionValue,
  getDefaultWikiPreviewWidth,
  isLocalConnection,
  parseModelSelectionValue,
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
  findDirectlyMentionedConnection,
  formatVisibleInputWithReferences,
  hasUsableCurrentTerminal,
  isConnectionOnlyRequest,
  isContinueIntent,
  isExplicitConnectionRequest,
  isExplicitNonTerminalAgentRequest,
  isSameConnectionTab
} from '@renderer/lib/agent-input'
import {
  buildConnectionCommands,
  buildConnectionLoginActions,
  buildSshCommand,
  createCustomConnectionId,
  formatConnectionActionLog,
  isPasswordEnvVarMissing,
  mergeConnectionInput,
  parseLoginActions,
  parseSshOptions
} from '@renderer/lib/connection-commands'
import { formatConnectionTarget } from '@renderer/lib/connections'
import { appTerminalTheme } from '@renderer/lib/design-system'
import { getMcpServerStatus } from '@renderer/lib/mcp-status'
import { copyFeedback, copyText, downloadMarkdown } from '@renderer/lib/operation-feedback'
import {
  buildInstalledSkillNameSet,
  buildSkillInstallCommand,
  filterLocalSkills,
  formatInstallCount,
  isSkillSearchResultInstalled
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
  getTerminalDisplayTitle,
  resolveTabModelSelection,
  toStoredSessionTabs,
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
  AgentConnectionIntentResult,
  AgentMcpServerConfig,
  AgentModelOption,
  AgentPathReference,
  AgentProviderConfig,
  AgentSkillInstallEvent,
  AgentSkillSearchResult,
  AgentValidationResult,
  AgentSkillOption,
  AgentWikiReference,
  CommandApprovalRequest,
  ConnectionConfig,
  ConnectionInput,
  LocalInstructionDocument,
  StoredSessionHistoryItem,
  StoredSessionTab,
  WikiDocument,
  WikiDocumentSummary
} from '../../shared/agent-types'
import { hasExplicitLocalFileOperationIntent } from '../../shared/agent-local-intent'

const emptyConfig: AgentConfig = {
  providers: [],
  providerId: undefined,
  model: '',
  agentMode: 'react',
  maxActiveTools: 5,
  commandWhitelist: [],
  openApiBaseUrl: '',
  openApiDocument: '',
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

interface PostConnectionTask {
  input: string
  displayInput: string
  conversationContext?: string
  connection: ConnectionConfig
  appendUserLog: boolean
  startedAt: number
}

const emptyLocalTab = createTerminalTab({ id: 'default', title: 'Local' })

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
  const validationRequestRef = useRef(0)
  const pipeInputBufferRef = useRef('')
  const pipeCursorRef = useRef(0)
  const pipeHistoryRef = useRef<string[]>([])
  const pipeHistoryIndexRef = useRef<number | null>(null)
  const nextLogIdRef = useRef(1)
  const agentLogRef = useRef<HTMLDivElement | null>(null)
  const passwordPromptInputRef = useRef<HTMLInputElement | null>(null)
  const slashCommandListRef = useRef<HTMLDivElement | null>(null)
  const activeTabIdRef = useRef('default')
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
        options?: { allowTerminalTools?: boolean; conversationContext?: string }
      ) => Promise<void>)
    | null
  >(null)
  const activeAgentRunRef = useRef(new Map<string, AgentRunViewState>())
  const skillInstallResultIdsRef = useRef(new Map<string, string>())
  const skillInstallNamesRef = useRef(new Map<string, string>())
  const pendingTabsSaveRef = useRef<{
    key: string
    timer: number
    tabs: StoredSessionTab[]
  } | null>(null)
  const lastSavedTabsKeyRef = useRef('')
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
  const [mcpOpen, setMcpOpen] = useState(false)
  const [providerEditorOpen, setProviderEditorOpen] = useState(false)
  const [instructionEditorOpen, setInstructionEditorOpen] = useState(false)
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
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
  const [connectionForm, setConnectionForm] = useState<ConnectionInput>({
    name: '',
    host: '',
    user: '',
    password: '',
    passwordEnvVar: '',
    port: 22,
    identityFile: '',
    sshOptions: [],
    description: '',
    actions: []
  })
  const [connectionSshOptionsText, setConnectionSshOptionsText] = useState('')
  const [connectionActionsText, setConnectionActionsText] = useState('')
  const [connectionImportText, setConnectionImportText] = useState('')
  const [connectionSaveMessage, setConnectionSaveMessage] = useState<SkillManageMessage | null>(
    null
  )
  const [commandApproval, setCommandApproval] = useState<CommandApprovalRequest | null>(null)
  const [commandRejectionReason, setCommandRejectionReason] = useState('')
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
  const [tabs, setTabs] = useState<AgentTerminalTab[]>([
    createTerminalTab({ id: 'default', title: 'Local' })
  ])
  const [activeTabId, setActiveTabId] = useState('default')
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
    closeSubterminal,
    closeAllSubterminals,
    resizeSubterminalPair
  } = useTerminalSessions({ tabsRef, setTabs })
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? emptyLocalTab
  const activeAgentPending = activeTab.agentBusy || activeTab.agentThinking
  const terminalTabs = useMemo(
    () =>
      tabs.filter(
        (tab) =>
          tab.id !== 'default' || terminalPage === 'terminal' || tab.sessionId || tab.terminalOutput
      ),
    [tabs, terminalPage]
  )
  const t = dictionaries[locale]
  const { appendLog, updateAgentRun, appendAgentEvent } = useAgentRuns({
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
  const activeTabProviderId = activeTab.providerId ?? config.providerId
  const activeProviderId = config.providers.some((provider) => provider.id === activeTabProviderId)
    ? (activeTabProviderId ?? config.providers[0]?.id ?? '')
    : (visibleModels.find((model) => model.id === (activeTab.model ?? config.model))?.providerId ??
      config.providers[0]?.id ??
      '')
  const filteredModels = visibleModels.filter((model) => model.providerId === activeProviderId)
  const activeTabModelId =
    activeTab.model && filteredModels.some((model) => model.id === activeTab.model)
      ? activeTab.model
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
  const aiState: 'ready' | 'pending' | 'not-ready' = validating
    ? 'pending'
    : validation?.modelOk === false
      ? 'not-ready'
      : 'ready'
  const aiStatusText = validating
    ? t.app.aiPending
    : validation?.modelOk === false
      ? `${t.app.aiNotReady}: ${validation.error ?? t.common.error}`
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
  const slashCommandQuery = getSlashCommandQuery(activeTab.agentInput)
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

  const drainPostConnectionTasks = useCallback(
    (targetTabId: string): void => {
      const tasks = postConnectionTasksRef.current.get(targetTabId) ?? []
      if (tasks.length === 0) return

      postConnectionTasksRef.current.delete(targetTabId)
      void Promise.all(
        tasks.map(async (task) => {
          const ready = await waitForTerminalReadyForAgent(targetTabId)
          if (!ready) {
            appendLog(
              {
                kind: 'error',
                text: appendElapsedFooter(
                  t.terminal.postLoginNotReady,
                  Date.now() - task.startedAt,
                  t
                )
              },
              targetTabId
            )
            return
          }

          appendLog(
            {
              kind: 'status',
              text: t.terminal.postLoginTaskStarting
            },
            targetTabId
          )
          await runAgentConversationRef.current?.(
            task.input,
            targetTabId,
            task.connection.id,
            task.displayInput,
            task.appendUserLog,
            task.startedAt,
            {
              conversationContext: task.conversationContext
            }
          )
        })
      )
    },
    [appendLog, t]
  )

  const executeConnectionAutomation = useCallback(
    async (
      connection: ConnectionConfig,
      targetTabId: string,
      includeSshCommand: boolean
    ): Promise<void> => {
      const commands = includeSshCommand
        ? buildConnectionCommands(connection)
        : buildConnectionLoginActions(connection)

      if (isPasswordEnvVarMissing(connection)) {
        appendLog(
          {
            kind: 'error',
            text: `${t.connections.passwordEnvVarMissing}: ${connection.passwordEnvVar}`
          },
          targetTabId
        )
        return
      }

      if (commands.length === 0) return

      const targetTab = tabsRef.current.find((tab) => tab.id === targetTabId)
      if (targetTab?.terminalMode !== 'pty') {
        appendLog(
          {
            kind: 'error',
            text: 'SSH requires PTY mode. Current terminal is PIPE fallback; restart the app after node-pty is available.'
          },
          targetTabId
        )
        return
      }

      updateTab(targetTabId, (tab) => ({
        ...tab,
        title: tab.connectionId || tab.isSsh ? tab.title : connection.name,
        connectionId: connection.id,
        connectionName: connection.name,
        isSsh: true
      }))
      appendLog(
        {
          kind: 'status',
          text: connection.actions?.length
            ? `${t.terminal.connectionStarting}: ${connection.actions.length}`
            : t.terminal.connectionNoActions
        },
        targetTabId
      )

      automatedLoginTabsRef.current.add(targetTabId)
      passwordPromptBuffersRef.current.set(targetTabId, '')
      try {
        if (includeSshCommand) {
          await runConnectionCommandSequence(commands, targetTabId, appendLog, t)
          return
        }

        await runConnectionLoginActionSequence(commands, targetTabId, appendLog, t)
      } finally {
        automatedLoginTabsRef.current.delete(targetTabId)
        passwordPromptBuffersRef.current.set(targetTabId, '')
      }
    },
    [appendLog, t, updateTab]
  )

  const executeConnectionCommands = useCallback(
    async (connection: ConnectionConfig, targetTabId: string): Promise<void> => {
      await executeConnectionAutomation(connection, targetTabId, true)
      drainPostConnectionTasks(targetTabId)
    },
    [drainPostConnectionTasks, executeConnectionAutomation]
  )

  const executeConnectionLoginActions = useCallback(
    async (connection: ConnectionConfig, targetTabId: string): Promise<void> => {
      await executeConnectionAutomation(connection, targetTabId, false)
      drainPostConnectionTasks(targetTabId)
    },
    [drainPostConnectionTasks, executeConnectionAutomation]
  )

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

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
    const storedTabs = toStoredSessionTabs(tabs)
    const key = JSON.stringify(storedTabs)
    const pending = pendingTabsSaveRef.current

    if (key === lastSavedTabsKeyRef.current || key === pending?.key) return
    if (pending) window.clearTimeout(pending.timer)

    const timer = window.setTimeout(() => {
      const current = pendingTabsSaveRef.current
      if (!current || current.key !== key) return

      pendingTabsSaveRef.current = null
      lastSavedTabsKeyRef.current = key
      void window.api.storage.saveTabs(current.tabs)
    }, 350)

    pendingTabsSaveRef.current = { key, timer, tabs: storedTabs }
  }, [tabs])

  useEffect(() => {
    return () => {
      const pending = pendingTabsSaveRef.current
      if (!pending) return

      window.clearTimeout(pending.timer)
      void window.api.storage.saveTabs(pending.tabs)
      pendingTabsSaveRef.current = null
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('crescent.locale', locale)
  }, [locale])

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
    if (passwordPromptRequestRef.current || passwordPromptOpenTabsRef.current.has(tabId)) return

    const tab = tabsRef.current.find((current) => current.id === tabId)
    if (!tab) return

    passwordPromptOpenTabsRef.current.add(tabId)
    const request = {
      tabId,
      title: tab.title,
      prompt: promptLine
    }
    passwordPromptRequestRef.current = request
    setPasswordPromptValue('')
    setPasswordPromptError('')
    setPasswordPromptRequest(request)
  }, [])

  useEffect(() => {
    return window.api.terminal.onData((event) => {
      const subterminal = parseSubterminalTabId(event.tabId)
      if (subterminal) return

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

  const redrawPipeInput = useCallback((terminal: Terminal): void => {
    const buffer = pipeInputBufferRef.current
    const cursor = pipeCursorRef.current

    terminal.write(
      `\r\x1b[2K${getPipePrompt(pipePromptRef.current, terminalCwdRef.current)}${buffer}`
    )
    const left = buffer.length - cursor
    if (left > 0) terminal.write(`\x1b[${left}D`)
  }, [])

  const setPipeBuffer = useCallback(
    (terminal: Terminal, value: string, cursor = value.length): void => {
      pipeInputBufferRef.current = value
      pipeCursorRef.current = Math.max(0, Math.min(cursor, value.length))
      redrawPipeInput(terminal)
    },
    [redrawPipeInput]
  )

  const commitPipeCommand = useCallback((terminal: Terminal): void => {
    const command = pipeInputBufferRef.current
    pipeInputBufferRef.current = ''
    pipeCursorRef.current = 0
    pipeHistoryIndexRef.current = null

    if (command.trim()) pipeHistoryRef.current = [...pipeHistoryRef.current, command].slice(-200)

    terminal.write('\r\n')
    window.api.terminal.write(`${command}\n`, activeTabIdRef.current)
  }, [])

  const handlePipeEscape = useCallback(
    (terminal: Terminal, sequence: string): void => {
      if (sequence === '\x1b[D') {
        if (pipeCursorRef.current > 0) {
          pipeCursorRef.current -= 1
          terminal.write('\x1b[D')
        }
        return
      }

      if (sequence === '\x1b[C') {
        if (pipeCursorRef.current < pipeInputBufferRef.current.length) {
          pipeCursorRef.current += 1
          terminal.write('\x1b[C')
        }
        return
      }

      if (sequence === '\x1b[A') {
        const history = pipeHistoryRef.current
        if (history.length === 0) return
        const current = pipeHistoryIndexRef.current
        const next = current === null ? history.length - 1 : Math.max(0, current - 1)
        pipeHistoryIndexRef.current = next
        setPipeBuffer(terminal, history[next])
        return
      }

      if (sequence === '\x1b[B') {
        const history = pipeHistoryRef.current
        const current = pipeHistoryIndexRef.current
        if (current === null) return
        const next = current + 1
        if (next >= history.length) {
          pipeHistoryIndexRef.current = null
          setPipeBuffer(terminal, '')
        } else {
          pipeHistoryIndexRef.current = next
          setPipeBuffer(terminal, history[next])
        }
      }
    },
    [setPipeBuffer]
  )

  const handlePipeTerminalInput = useCallback(
    (terminal: Terminal, data: string): void => {
      for (let index = 0; index < data.length; index += 1) {
        const char = data[index]

        if (char === '\x1b') {
          const sequence = data.slice(index, index + 3)
          if (sequence[0] === '\x1b' && sequence[1] === '[' && 'ABCD'.includes(sequence[2])) {
            handlePipeEscape(terminal, sequence)
            index += 2
          }
          continue
        }

        if (char === '\r') {
          commitPipeCommand(terminal)
          continue
        }

        if (char === '\t') {
          terminal.write('\x07')
          continue
        }

        if (char === '\u007f') {
          const cursor = pipeCursorRef.current
          if (cursor > 0) {
            const buffer = pipeInputBufferRef.current
            setPipeBuffer(terminal, buffer.slice(0, cursor - 1) + buffer.slice(cursor), cursor - 1)
          }
          continue
        }

        if (char >= ' ') {
          const cursor = pipeCursorRef.current
          const buffer = pipeInputBufferRef.current
          setPipeBuffer(terminal, buffer.slice(0, cursor) + char + buffer.slice(cursor), cursor + 1)
        }
      }
    },
    [commitPipeCommand, handlePipeEscape, setPipeBuffer]
  )

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
        setCommandWhitelistText(nextConfig.commandWhitelist.join('\n'))
        setModels(flattenProviderModels(nextConfig.providers))
        const firstProvider = nextConfig.providers[0]
        setSettingsProviderId(firstProvider?.id ?? '')
        setProviderModelsText(formatProviderModels(firstProvider?.models ?? []))
        const firstMcpServer = nextConfig.mcpServers[0]
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
      appendAgentEvent(event, event.tabId ?? activeTabIdRef.current)
    })

    return unsubscribe
  }, [appendAgentEvent])

  useEffect(() => {
    return window.api.agent.onCommandApprovalRequest((request) => {
      setCommandApproval(request)
      setCommandRejectionReason('')
    })
  }, [])

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
  }, [activeTab?.agentLog])

  useEffect(() => {
    if (!terminalVisible) return

    const host = terminalHostRef.current
    if (!host) return
    const tab = tabsRef.current.find((candidate) => candidate.id === activeTabId)
    if (!tab) return

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: appTerminalTheme
    })
    const fitAddon = new FitAddon()

    terminal.loadAddon(fitAddon)
    terminal.open(host)
    fitAddon.fit()

    if (tab.terminalOutput) terminal.write(tab.terminalOutput)

    const terminalDataDisposable = terminal.onData((data) => {
      if (terminalModeRef.current === 'pipe') {
        handlePipeTerminalInput(terminal, data)
        return
      }

      window.api.terminal.write(data, activeTabIdRef.current)
    })
    const stopTerminalData = window.api.terminal.onData((event) => {
      const subterminal = parseSubterminalTabId(event.tabId)
      if (subterminal) {
        updateSubterminalOutput(subterminal.parentTabId, subterminal.name, event.tabId, event.data)
        return
      }

      updateTab(event.tabId, (current) => ({
        ...current,
        terminalOutput: `${current.terminalOutput}${event.data}`.slice(-200_000)
      }))
      if (event.tabId === activeTabIdRef.current) terminal.write(event.data)
    })
    const stopTerminalPrompt = window.api.terminal.onPrompt(({ tabId, cwd, prompt }) => {
      const subterminal = parseSubterminalTabId(tabId)
      if (subterminal) {
        updateSubterminalCwd(subterminal.parentTabId, subterminal.name, tabId, cwd)
        return
      }

      updateTab(tabId, (current) => ({ ...current, terminalCwd: cwd }))
      if (tabId === activeTabIdRef.current) {
        terminalCwdRef.current = cwd
        pipePromptRef.current = prompt || formatPipePrompt(cwd)
        terminal.write(`\r\n${pipePromptRef.current}`)
      }
    })
    const stopTerminalExit = window.api.terminal.onExit((event) => {
      const subterminal = parseSubterminalTabId(event.tabId)
      if (subterminal) {
        updateSubterminalStatus(subterminal.parentTabId, subterminal.name, event.tabId, 'exited')
        return
      }

      updateTab(event.tabId, (current) => ({
        ...current,
        sessionId: undefined,
        terminalReady: false
      }))
      if (event.tabId === activeTabIdRef.current) {
        terminal.writeln(`\r\n\x1b[31m${t.terminal.shellExited} ${event.exitCode}.\x1b[0m`)
      }
      if (suppressTerminalReconnectRef.current.delete(event.tabId)) {
        return
      }

      void restoreTerminalSessionRef.current?.(event.tabId)
    })

    const startShell = async (): Promise<void> => {
      if (tab.sessionId) {
        terminalSessionIdRef.current = tab.sessionId
        terminalModeRef.current = tab.terminalMode
        terminalCwdRef.current = tab.terminalCwd
        pipePromptRef.current = formatPipePrompt(tab.terminalCwd)
        return
      }

      const dimensions = fitAddon.proposeDimensions()
      const pendingConnection = pendingSshRef.current.get(tab.id)
      const session = await window.api.terminal.start({
        cols: dimensions?.cols ?? 80,
        rows: dimensions?.rows ?? 24,
        tabId: tab.id,
        initialCommand: pendingConnection ? buildSshCommand(pendingConnection) : undefined
      })

      terminalSessionIdRef.current = session.sessionId
      terminalModeRef.current = session.mode
      terminalCwdRef.current = session.cwd
      pipePromptRef.current = formatPipePrompt(session.cwd)
      updateTab(tab.id, (current) => ({
        ...current,
        sessionId: session.sessionId,
        terminalMode: session.mode,
        terminalCwd: session.cwd,
        terminalReady: true
      }))
      if (pendingConnection) {
        pendingSshRef.current.delete(tab.id)
        void executeConnectionLoginActions(pendingConnection, tab.id)
      }
    }

    void startShell().catch((error) => {
      terminal.writeln(`\r\n\x1b[31m${t.terminal.failedToStartShell}: ${String(error)}\x1b[0m`)
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      const dimensions = fitAddon.proposeDimensions()
      if (dimensions) {
        window.api.terminal.resize({ cols: dimensions.cols, rows: dimensions.rows, tabId: tab.id })
      }
    })
    resizeObserver.observe(host)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    return () => {
      resizeObserver.disconnect()
      terminalDataDisposable.dispose()
      stopTerminalData()
      stopTerminalPrompt()
      stopTerminalExit()
      terminalSessionIdRef.current = null
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [
    activeTabId,
    appendLog,
    executeConnectionCommands,
    executeConnectionLoginActions,
    handlePipeTerminalInput,
    maybeRequestTerminalPassword,
    t,
    terminalVisible,
    updateSubterminalCwd,
    updateSubterminalOutput,
    updateSubterminalStatus,
    updateTab
  ])

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
    const text = selectedText || selectedSkillInstallLog
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
    setCommandWhitelistText(nextConfig.commandWhitelist.join('\n'))
    setModels(flattenProviderModels(nextConfig.providers))
    const nextSettingsProvider =
      nextConfig.providers.find((provider) => provider.id === settingsProviderId) ??
      nextConfig.providers[0]
    setSettingsProviderId(nextSettingsProvider?.id ?? '')
    setProviderModelsText(formatProviderModels(nextSettingsProvider?.models ?? []))
    const nextMcpServer =
      nextConfig.mcpServers.find((server) => server.id === settingsMcpServerId) ??
      nextConfig.mcpServers[0]
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
    const restoredTab = createTerminalTab({
      id: detail.tabId,
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
    setActiveTabId(detail.tabId)
    setHistoryOpen(false)
    setHiddenPane(null)

    if (connection) {
      const activeSession = tabsRef.current.find((tab) => tab.id === detail.tabId)?.sessionId
      if (!activeSession) {
        pendingSshRef.current.set(detail.tabId, connection)
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

  async function applyDefaultModel(modelId: string): Promise<void> {
    const modelProviderId =
      modelOptions.find((model) => model.id === modelId)?.providerId ?? config.providerId
    const optimisticConfig = { ...config, providerId: modelProviderId, model: modelId }

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

    updateTab(activeTab.id, (tab) => ({
      ...tab,
      providerId: selectedModel.providerId,
      model: selectedModel.id
    }))
    void persistModelSelection(selectedModel.providerId, selectedModel.id)
  }

  function stopAgentRun(tabId = activeTabIdRef.current): void {
    activeRunCanceledRef.current.add(tabId)
    const runId = activeRunIdRef.current.get(tabId)
    const currentRun = activeAgentRunRef.current.get(tabId)
    if (runId) void window.api.agent.cancel(runId)
    if (runId) {
      setCommandApproval((current) => (current?.runId === runId ? null : current))
      setCommandRejectionReason('')
    }
    if (runId) {
      void window.api.storage.saveAgentRun({
        runId,
        tabId,
        input: activeRunInputRef.current.get(tabId) ?? '',
        status: 'canceled',
        output: currentRun?.result,
        error: t.input.agentCanceled
      })
    }
    updateAgentRun(tabId, (run) => ({
      ...run,
      error: t.input.agentCanceled,
      elapsedMs: Date.now() - (run.startedAt ?? Date.now())
    }))
    updateTab(tabId, (tab) => ({ ...tab, agentBusy: false, agentThinking: false }))
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
    passwordPromptRequestRef.current = null
    setPasswordPromptRequest(null)
    setPasswordPromptValue('')
    setPasswordPromptError('')
  }

  function cancelPasswordPrompt(): void {
    if (passwordPromptRequest) {
      passwordPromptBuffersRef.current.set(passwordPromptRequest.tabId, '')
      passwordPromptOpenTabsRef.current.delete(passwordPromptRequest.tabId)
    }
    passwordPromptRequestRef.current = null
    setPasswordPromptRequest(null)
    setPasswordPromptValue('')
    setPasswordPromptError('')
  }

  function resolveCommandApproval(approved: boolean): void {
    if (!commandApproval) return

    const requestId = commandApproval.id
    const note = commandRejectionReason.trim()
    const rejectionReason = approved ? '' : note
    setCommandApproval(null)
    setCommandRejectionReason('')
    void window.api.agent.resolveCommandApproval({ requestId, approved, note, rejectionReason })
  }

  async function getTerminalContextForAgent(tabId = activeTabIdRef.current): Promise<string> {
    const context = await window.api.terminal.getContext(tabId)
    const output = context.output.slice(-12000).trim()

    return [
      `mode: ${context.mode}`,
      context.pid ? `pid: ${context.pid}` : '',
      context.cwd ? `cwd: ${context.cwd}` : '',
      context.shell ? `shell: ${context.shell}` : '',
      output ? `recent output:\n${output}` : 'recent output: <empty>'
    ]
      .filter(Boolean)
      .join('\n')
  }

  async function ensureTerminalReadyForAgent(tabId: string): Promise<void> {
    const context = await window.api.terminal.getContext(tabId)
    if (context.mode !== 'none') return

    const restored = await restoreTerminalSession(tabId)
    if (restored) return

    throw new Error(t.terminal.terminalReconnectUnavailable)
  }

  async function restoreTerminalSession(tabId: string): Promise<boolean> {
    const tab = tabsRef.current.find((current) => current.id === tabId)
    if (!tab) return false

    return tab.connectionId ? restoreTerminalConnection(tabId) : restoreLocalTerminal(tabId)
  }

  async function restoreLocalTerminal(tabId: string): Promise<boolean> {
    if (reconnectingTabsRef.current.has(tabId)) return waitForTerminalRestore(tabId)

    reconnectingTabsRef.current.add(tabId)
    appendLog({ kind: 'status', text: t.terminal.terminalReconnecting }, tabId)

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
      appendLog({ kind: 'error', text: `${t.terminal.terminalReconnectFailed}: ${message}` }, tabId)
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
    appendLog({ kind: 'status', text: t.terminal.terminalReconnecting }, tabId)

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
      await executeConnectionCommands(connection, tabId)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendLog({ kind: 'error', text: `${t.terminal.terminalReconnectFailed}: ${message}` }, tabId)
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
    postLoginStartedAt = Date.now()
  ): string {
    const currentTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
    let targetTabId = currentTab?.id ?? ''
    let targetTab = currentTab

    if (currentTab?.isSsh) {
      const nextTab = createTerminalTab({
        title: getNextTerminalTitle(connection.name, tabsRef.current),
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
          startedAt: postLoginStartedAt
        }
      ])
    }

    if (targetTab?.sessionId) {
      void executeConnectionCommands(connection, targetTabId)
    } else {
      pendingSshRef.current.set(targetTabId, connection)
    }

    return targetTabId
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

  function openLocalTerminal(): void {
    setHiddenPane(null)
    setTerminalPage('terminal')

    const currentTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
    const canReuseCurrentTab =
      currentTab &&
      !currentTab.isSsh &&
      !currentTab.connectionId &&
      !currentTab.sessionId &&
      !currentTab.terminalOutput

    const targetTabId = canReuseCurrentTab ? currentTab.id : createTerminalTab().id

    if (canReuseCurrentTab) {
      updateTab(currentTab.id, (tab) => ({
        ...tab,
        title: getNextTerminalTitle(t.connections.localTerminal, tabsRef.current),
        connectionId: undefined,
        connectionName: undefined,
        isSsh: false
      }))
    } else {
      const nextTab = createTerminalTab({
        id: targetTabId,
        title: getNextTerminalTitle(t.connections.localTerminal, tabsRef.current),
        providerId: config.providerId,
        isSsh: false
      })
      setTabs((current) => [...current, nextTab])
    }

    setActiveTabId(targetTabId)
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

  async function resolveConnectionIntentForInput(input: string): Promise<{
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
      const analysis = await window.api.agent.resolveConnectionIntent({ input })
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
          reason: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }

  async function saveConnection(connectAfterSave = false): Promise<void> {
    const normalizedInput = normalizeConnectionInputForSave()
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

  async function submitAgent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    const tabId = activeTabIdRef.current
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
    const displayInput = tab?.agentInput.trim() ?? ''
    if (!displayInput) return

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
      updateTab(tabId, (current) => ({
        ...current,
        agentInput: '',
        skillRefs: [],
        pathRefs: [],
        toolRefs: [],
        wikiRefs: []
      }))
      const runId = activeRunIdRef.current.get(tabId)
      if (runId) void window.api.agent.supplement({ runId, input })
      updateAgentRun(tabId, (run) => ({
        ...run,
        actions: [
          ...run.actions,
          {
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

    updateTab(tabId, (current) => ({
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
      tabId
    )
    updateTab(tabId, (current) => ({ ...current, agentThinking: true }))
    const terminalContext = await window.api.terminal.getContext(tabId)
    const explicitNonTerminalRequest = isExplicitNonTerminalAgentRequest(displayInput, toolRefs)
    const explicitLocalFileRequest = hasExplicitLocalFileOperationIntent(displayInput)
    const allowTerminalTools = !explicitNonTerminalRequest
    const directlyMentionedConnection = explicitLocalFileRequest
      ? undefined
      : findDirectlyMentionedConnection(displayInput, connections)
    const directlyMentionsCurrentConnection =
      Boolean(directlyMentionedConnection) && isSameConnectionTab(tab, directlyMentionedConnection)
    const inputMentionsConnection =
      Boolean(directlyMentionedConnection) && !directlyMentionsCurrentConnection
    const shouldResolveConnectionIntent =
      !resumeRequested &&
      !directlyMentionsCurrentConnection &&
      !explicitNonTerminalRequest &&
      !explicitLocalFileRequest
    let connectionIntent: Awaited<ReturnType<typeof resolveConnectionIntentForInput>> | undefined
    try {
      connectionIntent =
        inputMentionsConnection && directlyMentionedConnection
          ? {
              analysis: {
                ok: true,
                shouldConnect: true,
                connectionId: directlyMentionedConnection.id,
                confidence: 100,
                executeAfterLogin: !isConnectionOnlyRequest(
                  displayInput,
                  directlyMentionedConnection
                ),
                matchBasis: 'name',
                reason: `${t.terminal.connectionMatched}: ${directlyMentionedConnection.name}`
              },
              connection: directlyMentionedConnection
            }
          : shouldResolveConnectionIntent
            ? await resolveConnectionIntentForInput(displayInput)
            : undefined
    } finally {
      updateTab(tabId, (current) => ({ ...current, agentThinking: false }))
    }
    const shouldUseCurrentTerminal =
      terminalContext.mode !== 'none' &&
      hasUsableCurrentTerminal(tab, terminalContext.output) &&
      !connectionIntent?.analysis?.shouldConnect &&
      !explicitNonTerminalRequest &&
      !isExplicitConnectionRequest(displayInput)
    if (connectionIntent?.analysis?.shouldConnect) {
      const matchedConnection = connectionIntent.connection
      const executeAfterLogin = connectionIntent.analysis.executeAfterLogin === true

      if (!matchedConnection) {
        appendLog(
          {
            kind: 'assistant',
            text: formatAgentRunMarkdown(
              {
                logId: -1,
                actions: [
                  {
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
          tabId
        )
        updateTab(tabId, (current) => ({
          ...current,
          agentInput: '',
          skillRefs: [],
          pathRefs: [],
          toolRefs: [],
          wikiRefs: []
        }))
        return
      }

      appendLog(
        {
          kind: 'assistant',
          text: formatAgentRunMarkdown(
            {
              logId: -1,
              actions: [
                {
                  title: t.terminal.connectionMatched,
                  detail: [
                    matchedConnection.name,
                    `${t.terminal.connectionTarget}: ${formatConnectionTarget(matchedConnection)}`,
                    connectionIntent.analysis.reason,
                    executeAfterLogin ? t.terminal.postLoginSkillHint : ''
                  ]
                    .filter(Boolean)
                    .join('\n')
                }
              ],
              result: executeAfterLogin
                ? t.terminal.connectionIntentWithTaskResult
                : t.terminal.connectionIntentResult,
              elapsedMs: Date.now() - startedAt
            },
            t
          )
        },
        tabId
      )
      connectToConnection(
        matchedConnection,
        executeAfterLogin ? buildPostLoginAgentInput(input, matchedConnection, t) : undefined,
        executeAfterLogin
          ? formatVisibleInputWithReferences(
              displayInput,
              skillRefs,
              pathRefs,
              toolRefs,
              wikiRefs,
              t
            )
          : undefined,
        conversationContext,
        false,
        startedAt
      )
      updateTab(tabId, (current) => ({
        ...current,
        agentInput: '',
        skillRefs: [],
        pathRefs: [],
        toolRefs: [],
        wikiRefs: []
      }))
      return
    }

    const runInput = shouldUseCurrentTerminal
      ? buildCurrentTerminalAgentInput(input, terminalContext, t)
      : input
    await runAgentConversation(
      runInput,
      tabId,
      tab?.connectionId || undefined,
      displayInput,
      false,
      startedAt,
      {
        allowTerminalTools,
        conversationContext
      }
    )
  }

  async function runAgentConversation(
    input: string,
    tabId: string,
    connectionId?: string,
    displayInput = input,
    appendUserLog = true,
    startedAt = Date.now(),
    options: { allowTerminalTools?: boolean; conversationContext?: string } = {}
  ): Promise<void> {
    updateTab(tabId, (current) => ({
      ...current,
      agentInput: '',
      agentBusy: true,
      agentThinking: false
    }))
    activeRunCanceledRef.current.delete(tabId)
    const runId = `run-${crypto.randomUUID()}`
    activeRunIdRef.current.set(tabId, runId)
    activeRunInputRef.current.set(tabId, displayInput)
    void window.api.storage.saveAgentRun({
      runId,
      tabId,
      input: displayInput,
      status: 'running',
      connectionId
    })
    if (appendUserLog) appendLog({ kind: 'user', text: displayInput }, tabId)
    const runLogId = appendLog(
      {
        kind: 'assistant',
        text: formatAgentRunMarkdown(
          {
            logId: -1,
            actions: [
              {
                title: t.input.startedRun,
                detail:
                  options.allowTerminalTools === false
                    ? t.input.contextSupplementDetail
                    : t.input.terminalContext
              }
            ]
          },
          t
        )
      },
      tabId
    )
    activeAgentRunRef.current.set(tabId, {
      logId: runLogId,
      actions: [
        {
          title: t.input.startedRun,
          detail:
            options.allowTerminalTools === false
              ? t.input.contextSupplementDetail
              : t.input.terminalContext
        }
      ],
      startedAt
    })

    try {
      const allowTerminalTools = options.allowTerminalTools !== false
      if (allowTerminalTools) await ensureTerminalReadyForAgent(tabId)
      const terminalContext = allowTerminalTools ? await getTerminalContextForAgent(tabId) : ''
      const runTab = tabsRef.current.find((candidate) => candidate.id === tabId)
      const runModelSelection = resolveTabModelSelection(runTab, config, visibleModels)
      const result = await window.api.agent.run({
        runId,
        input,
        skillInput: displayInput,
        conversationContext:
          options.conversationContext ??
          buildRecentConversationContext(
            tabsRef.current.find((candidate) => candidate.id === tabId),
            displayInput,
            t
          ),
        providerId: runModelSelection.providerId,
        model: runModelSelection.model,
        terminalContext,
        allowTerminalTools,
        connectionId,
        tabId,
        locale
      })

      if (activeRunCanceledRef.current.has(tabId)) return

      if (result.ok) {
        const text = result.text || t.input.done
        updateAgentRun(tabId, (run) => ({
          ...run,
          result: text,
          elapsedMs: Date.now() - startedAt
        }))
        void window.api.storage.saveAgentRun({
          runId,
          tabId,
          input: displayInput,
          status: 'success',
          connectionId,
          output: text
        })
      } else {
        updateAgentRun(tabId, (run) => ({
          ...run,
          error: result.error || t.input.failed,
          elapsedMs: Date.now() - startedAt
        }))
        void window.api.storage.saveAgentRun({
          runId,
          tabId,
          input: displayInput,
          status: 'error',
          connectionId,
          error: result.error || t.input.failed
        })
      }
    } catch (error) {
      if (activeRunCanceledRef.current.has(tabId)) return

      const message = error instanceof Error ? error.message : String(error)
      updateAgentRun(tabId, (run) => ({
        ...run,
        error: message,
        elapsedMs: Date.now() - startedAt
      }))
      void window.api.storage.saveAgentRun({
        runId,
        tabId,
        input: displayInput,
        status: 'error',
        connectionId,
        error: message
      })
    } finally {
      activeAgentRunRef.current.delete(tabId)
      activeRunCanceledRef.current.delete(tabId)
      activeRunIdRef.current.delete(tabId)
      activeRunInputRef.current.delete(tabId)
      updateTab(tabId, (current) => ({
        ...current,
        agentInput: '',
        agentBusy: false,
        agentThinking: false
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

    updateTab(activeTabIdRef.current, (tab) => ({
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

    if (command.pathReferenceKind) {
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        agentInput: replaceSlashCommandInput(tab.agentInput, '')
      }))
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      void pickPathReference(command.pathReferenceKind)
      return
    }

    if (command.toolRef) {
      updateTab(activeTab.id, (tab) => ({
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
      updateTab(activeTab.id, (tab) => ({
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
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        agentInput: replaceSlashCommandInput(tab.agentInput, '')
      }))
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      return
    }

    if (command.connection) {
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        agentInput: replaceSlashCommandInput(tab.agentInput, '')
      }))
      setSlashCommandIndex(0)
      setSlashCommandOpen(false)
      connectToConnection(command.connection)
      return
    }

    updateTab(activeTab.id, (tab) => ({
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
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      skillRefs: tab.skillRefs.filter((skill) => skill.id !== skillId)
    }))
  }

  function removeToolRef(toolId: string): void {
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      toolRefs: tab.toolRefs.filter((tool) => tool.id !== toolId)
    }))
  }

  function removeWikiRef(wikiId: string): void {
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      wikiRefs: tab.wikiRefs.filter((wiki) => wiki.id !== wikiId)
    }))
  }

  async function addWikiReference(document: WikiDocumentSummary): Promise<void> {
    const detail = await window.api.agent.getWikiDocument(document.id)
    if (!detail) return

    updateTab(activeTab.id, (tab) => ({
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

    updateTab(activeTab.id, (tab) => ({
      ...tab,
      pathRefs: addUniquePathRef(tab.pathRefs, reference)
    }))
  }

  function removePathRef(pathRefId: string): void {
    updateTab(activeTab.id, (tab) => ({
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
    const nextProviderId = key === 'id' ? String(value) : settingsProviderId
    if (
      key === 'id' &&
      config.providers.some(
        (provider) => provider.id !== settingsProvider.id && provider.id === nextProviderId
      )
    ) {
      return
    }

    setConfig((current) => {
      const providers = current.providers.map((provider) =>
        provider.id === settingsProvider.id ? { ...provider, [key]: value } : provider
      )

      return {
        ...current,
        providers,
        providerId: current.providerId === settingsProvider.id ? nextProviderId : current.providerId
      }
    })
    if (key === 'id') setSettingsProviderId(nextProviderId)
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
    if (providerEditorOpen && settingsProviderId === providerId) {
      setProviderEditorOpen(false)
      return
    }

    selectSettingsProvider(providerId)
    setInstructionEditorOpen(false)
    setProviderEditorOpen(true)
  }

  function createProvider(): void {
    const id = `provider-${Date.now()}`
    const provider: AgentProviderConfig = {
      id,
      name: id,
      baseUrl: '',
      apiKey: '',
      models: []
    }

    setConfig((current) => ({ ...current, providers: [...current.providers, provider] }))
    setSettingsProviderId(id)
    setProviderModelsText(formatProviderModels(provider.models))
    setInstructionEditorOpen(false)
    setProviderEditorOpen(true)
    setValidation(undefined)
  }

  function deleteSettingsProvider(): void {
    if (config.providers.length <= 1) return
    if (!window.confirm(`${t.confirm.deleteProvider}\n\n${settingsProvider.name}`)) return

    const remainingProviders = config.providers.filter(
      (provider) => provider.id !== settingsProvider.id
    )
    const nextProvider = remainingProviders[0]
    const modelProvider = remainingProviders.find((provider) =>
      provider.models.some((model) => model.id === config.model)
    )
    const modelStillAvailable = Boolean(modelProvider)

    setConfig({
      ...config,
      providers: remainingProviders,
      providerId: modelStillAvailable ? modelProvider?.id : nextProvider?.id,
      model: modelStillAvailable ? config.model : (nextProvider?.models[0]?.id ?? '')
    })
    setSettingsProviderId(nextProvider?.id ?? '')
    setProviderModelsText(formatProviderModels(nextProvider?.models ?? []))
    if (!nextProvider) setProviderEditorOpen(false)
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

  function normalizeConnectionInputForSave(): ConnectionInput | null {
    const actions = parseLoginActions(connectionActionsText)
    const sshOptions = parseSshOptions(connectionSshOptionsText)
    const name = connectionForm.name.trim()
    const host = connectionForm.host.trim()

    if (!name || !host) return null

    return {
      id: connectionForm.id,
      name,
      host,
      user: connectionForm.user?.trim() || undefined,
      password: connectionForm.password?.trim() || undefined,
      passwordEnvVar: connectionForm.passwordEnvVar?.trim() || undefined,
      port: connectionForm.port || undefined,
      identityFile: connectionForm.identityFile?.trim() || undefined,
      sshOptions,
      description: connectionForm.description?.trim() || undefined,
      actions
    }
  }

  function resetConnectionForm(): void {
    setConnectionForm({
      name: '',
      host: '',
      user: '',
      password: '',
      passwordEnvVar: '',
      port: 22,
      identityFile: '',
      sshOptions: [],
      description: '',
      actions: []
    })
    setConnectionSshOptionsText('')
    setConnectionActionsText('')
    setConnectionImportText('')
    setConnectionSaveMessage(null)
    setSelectedConnectionId('')
    setConnectionEditing(true)
  }

  function loadConnectionIntoForm(connection: ConnectionConfig, editing: boolean): void {
    setConnectionForm({
      id: connection.id,
      name: connection.name,
      host: connection.host,
      user: connection.user,
      password: connection.password,
      passwordEnvVar: connection.passwordEnvVar,
      port: connection.port ?? 22,
      identityFile: connection.identityFile,
      sshOptions: connection.sshOptions,
      description: connection.description,
      actions: connection.actions
    })
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
    const name = `${connection.name} copy`
    setConnectionForm({
      name,
      host: connection.host,
      user: connection.user,
      password: connection.password,
      passwordEnvVar: connection.passwordEnvVar,
      port: connection.port ?? 22,
      identityFile: connection.identityFile,
      sshOptions: connection.sshOptions,
      description: connection.description,
      actions: connection.actions
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
    const closingTab = tabsRef.current.find((tab) => tab.id === tabId)
    suppressTerminalReconnectRef.current.add(tabId)
    window.api.terminal.stop(tabId)
    closingTab?.subTerminals.forEach((subterminal) => {
      suppressTerminalReconnectRef.current.add(subterminal.id)
      window.api.terminal.stop(subterminal.id)
    })
    pendingSshRef.current.delete(tabId)
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== tabId)
      if (activeTabIdRef.current === tabId) {
        const fallback = next.find((tab) => tab.id !== 'default') ?? next[0]
        if (fallback) {
          setActiveTabId(fallback.id)
          setTerminalPage('terminal')
        } else {
          setActiveTabId('default')
          setTerminalPage('connections')
        }
      }
      return next
    })
    setTabMenu(null)
  }

  function performCloseOtherTabs(tabId: string): void {
    for (const tab of tabsRef.current) {
      if (tab.id !== tabId) {
        suppressTerminalReconnectRef.current.add(tab.id)
        window.api.terminal.stop(tab.id)
        tab.subTerminals.forEach((subterminal) => {
          suppressTerminalReconnectRef.current.add(subterminal.id)
          window.api.terminal.stop(subterminal.id)
        })
        pendingSshRef.current.delete(tab.id)
      }
    }

    setTabs((current) => {
      const keepTab = current.find((tab) => tab.id === tabId)
      return keepTab ? [keepTab] : [createTerminalTab({ id: 'default', title: 'Local' })]
    })
    setActiveTabId(tabId)
    setTabMenu(null)
  }

  function performCloseAllTabs(): void {
    for (const tab of tabsRef.current) {
      suppressTerminalReconnectRef.current.add(tab.id)
      window.api.terminal.stop(tab.id)
      tab.subTerminals.forEach((subterminal) => {
        suppressTerminalReconnectRef.current.add(subterminal.id)
        window.api.terminal.stop(subterminal.id)
      })
      pendingSshRef.current.delete(tab.id)
    }

    setTabs([])
    setActiveTabId('default')
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
    const tabId = activeTabIdRef.current
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
    const tabId = activeTabIdRef.current
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

  const skillInstallLogResultIds = Object.keys(skillInstallLogs)
  const skillInstallLogCount = skillInstallLogResultIds.length
  const selectedSkillInstallName = skillInstallLogResultId
    ? (skillInstallLogNames[skillInstallLogResultId] ?? skillInstallLogResultId)
    : ''
  const selectedSkillInstallRunning = Boolean(
    skillInstallLogResultId && skillInstallIds[skillInstallLogResultId]
  )
  const selectedSkillInstallStatus: SkillInstallLogStatus = selectedSkillInstallRunning
    ? 'running'
    : skillInstallLogResultId
      ? (skillInstallLogStatuses[skillInstallLogResultId] ?? 'success')
      : 'success'
  const selectedSkillInstallLog = skillInstallLogResultId
    ? (skillInstallLogs[skillInstallLogResultId] ?? '')
    : ''
  const skillSidePanelOpen = Boolean(skillInstallLogResultId || selectedSkillPreview)

  const skillSheet = (
    <Sheet open={skillOpen} onOpenChange={setSkillOpen}>
      <SheetContent
        side="right"
        className={`w-full ${skillSidePanelOpen ? 'sm:max-w-6xl' : 'sm:max-w-2xl'}`}
      >
        <SheetHeader>
          <SheetTitle>{t.settings.skillsManagement}</SheetTitle>
          <SheetDescription>{t.settings.skillsManagementHint}</SheetDescription>
        </SheetHeader>
        <div className="app-sheet-split flex min-h-0 flex-1 flex-row-reverse gap-3 overflow-hidden px-4">
          <div className="app-sheet-main min-w-0 flex-1 space-y-4 overflow-auto">
            <div className="space-y-3 rounded-md border bg-muted/10 p-3">
              <Field>
                <FieldLabel htmlFor="skill-root">{t.settings.skillDirectory}</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="skill-root"
                    value={config.skillRoot}
                    onChange={(event) => updateConfig('skillRoot', event.target.value)}
                    placeholder="~/.agents/skills"
                  />
                  <Button type="button" variant="outline" onClick={() => void saveSkillRoot()}>
                    {t.settings.saveSkillDirectory}
                  </Button>
                </div>
                <FieldDescription>{t.settings.skillDirectoryHint}</FieldDescription>
              </Field>
            </div>
            <div className="space-y-3 rounded-md border bg-muted/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">
                  {t.settings.localSkills} · {filteredLocalSkills.length}/{skills.length}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={refreshSkills}>
                  <SearchIcon data-icon="inline-start" />
                  {t.settings.refreshSkills}
                </Button>
              </div>
              <Input
                value={localSkillSearchQuery}
                onChange={(event) => setLocalSkillSearchQuery(event.target.value)}
                placeholder={t.settings.localSkillsSearchPlaceholder}
              />
              <div className="max-h-72 space-y-2 overflow-auto">
                {skills.length === 0 ? (
                  <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                    {t.settings.noLocalSkills}
                  </div>
                ) : filteredLocalSkills.length === 0 ? (
                  <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                    {t.settings.noMatchedLocalSkills}
                  </div>
                ) : (
                  filteredLocalSkills.map((skill) => (
                    <div
                      key={skill.path}
                      className={`flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3 text-xs transition ${
                        selectedSkillPreview?.skill.path === skill.path
                          ? 'border-primary/50 bg-primary/5'
                          : 'bg-background hover:bg-muted/40'
                      }`}
                      role="button"
                      tabIndex={0}
                      onClick={() => void previewSkill(skill)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          void previewSkill(skill)
                        }
                      }}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium">{skill.name}</span>
                          {!skill.removable && (
                            <Badge variant="outline">{t.settings.protectedSkill}</Badge>
                          )}
                          {skillPreviewLoadingPath === skill.path && (
                            <Loader2Icon
                              className="size-3 shrink-0 animate-spin text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        {skill.description && (
                          <div className="line-clamp-2 text-muted-foreground">
                            {skill.description}
                          </div>
                        )}
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {skill.path}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={!skill.removable || skillDeletingPath === skill.path}
                        aria-label={t.settings.deleteSkill}
                        title={t.settings.deleteSkill}
                        onClick={(event) => {
                          event.stopPropagation()
                          void deleteSkill(skill)
                        }}
                      >
                        {skillDeletingPath === skill.path ? (
                          <Loader2Icon className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2Icon aria-hidden="true" />
                        )}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-3 rounded-md border bg-muted/10 p-3">
              <div className="flex gap-2">
                <Input
                  value={skillSearchQuery}
                  onChange={(event) => setSkillSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void searchSkills()
                    }
                  }}
                  placeholder={t.settings.skillsSearchPlaceholder}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={searchSkills}
                  disabled={skillSearchLoading}
                >
                  {skillSearchLoading ? (
                    <Loader2Icon className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <SearchIcon data-icon="inline-start" />
                  )}
                  {t.settings.searchSkills}
                </Button>
              </div>
              <FieldDescription>{t.settings.skillsSearchHint}</FieldDescription>
              {skillSearchResults.length > 0 && (
                <div className="max-h-80 space-y-2 overflow-auto">
                  {skillSearchResults.map((result) => {
                    const installed = isSkillSearchResultInstalled(result, installedSkillNames)
                    const installing = Boolean(skillInstallIds[result.id])

                    return (
                      <div
                        key={result.id}
                        className="flex items-start justify-between gap-3 rounded-md border bg-background p-3 text-xs"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex min-w-0 items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">{result.name}</span>
                              {installed && (
                                <Badge variant="secondary" className="shrink-0">
                                  {t.settings.skillInstalledStatus}
                                </Badge>
                              )}
                            </div>
                            <Badge variant="outline" className="shrink-0">
                              {t.settings.skillInstalls}: {formatInstallCount(result.installs)}
                            </Badge>
                          </div>
                          {result.description && (
                            <div className="line-clamp-2 text-muted-foreground">
                              {result.description}
                            </div>
                          )}
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {buildSkillInstallCommand(result)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t.settings.copySkillInstallCommand}
                            title={t.settings.copySkillInstallCommand}
                            onClick={() => void copySkillInstallCommand(result)}
                          >
                            {copiedSkillCommandId === result.id ? (
                              <CheckIcon aria-hidden="true" />
                            ) : (
                              <CopyIcon aria-hidden="true" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={installing ? 'outline' : 'default'}
                            onClick={() => void installSkill(result)}
                          >
                            {installing ? (
                              <Loader2Icon className="animate-spin" data-icon="inline-start" />
                            ) : (
                              <DownloadIcon data-icon="inline-start" />
                            )}
                            {installing
                              ? t.settings.skillInstalling
                              : installed
                                ? t.settings.updateSkill
                                : t.settings.installSkill}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <SkillManageStatus message={skillManageMessage} />
            </div>
          </div>
          {skillInstallLogResultId ? (
            <div className="app-sheet-detail flex w-[680px] shrink-0 overflow-hidden rounded-md border bg-background">
              <div className="w-44 shrink-0 overflow-auto border-r bg-muted/20 p-1">
                {skillInstallLogResultIds.map((resultId) => {
                  const running = Boolean(skillInstallIds[resultId])
                  const status: SkillInstallLogStatus = running
                    ? 'running'
                    : (skillInstallLogStatuses[resultId] ?? 'success')
                  const selected = resultId === skillInstallLogResultId

                  return (
                    <div
                      key={resultId}
                      className={`mb-1 block w-full rounded px-2 py-2 text-left text-[11px] transition ${
                        selected
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                      }`}
                      title={skillInstallLogNames[resultId] ?? resultId}
                    >
                      <button
                        type="button"
                        className="flex w-full min-w-0 items-start gap-2 text-left"
                        onClick={() => setSkillInstallLogResultId(resultId)}
                      >
                        <SkillInstallStatusDot status={status} />
                        <span className="min-w-0 flex-1 break-words leading-snug">
                          {skillInstallLogNames[resultId] ?? resultId}
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-3 border-b px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-start gap-2 text-sm font-semibold">
                      <SkillInstallStatusDot status={selectedSkillInstallStatus} />
                      <span className="min-w-0 break-words">
                        {t.settings.skillInstallLog}: {selectedSkillInstallName}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {selectedSkillInstallRunning
                        ? t.settings.skillInstallRunningHint
                        : t.settings.skillInstallFinishedHint}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t.settings.copySkillInstallLog}
                      title={t.settings.copySkillInstallLog}
                      disabled={!selectedSkillInstallLog}
                      onClick={() => void copySelectedSkillInstallLog()}
                    >
                      {copiedSkillInstallLogId === skillInstallLogResultId ? (
                        <CheckIcon aria-hidden="true" />
                      ) : (
                        <CopyIcon aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      aria-label={t.settings.deleteSkillInstallLog}
                      title={t.settings.deleteSkillInstallLog}
                      onClick={() =>
                        skillInstallLogResultId && deleteSkillInstallLog(skillInstallLogResultId)
                      }
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t.common.close}
                      title={t.common.close}
                      onClick={() => setSkillInstallLogResultId(null)}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <pre className="min-h-0 flex-1 select-text overflow-auto bg-[var(--app-terminal)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-zinc-100">
                  {selectedSkillInstallLog || t.settings.skillInstallWaitingLog}
                </pre>
                <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
                  {selectedSkillInstallRunning && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={Boolean(
                        skillInstallLogResultId && skillInstallCancelingIds[skillInstallLogResultId]
                      )}
                      onClick={() =>
                        skillInstallLogResultId && void cancelSkillInstall(skillInstallLogResultId)
                      }
                    >
                      {skillInstallLogResultId &&
                        skillInstallCancelingIds[skillInstallLogResultId] && (
                          <Loader2Icon className="animate-spin" data-icon="inline-start" />
                        )}
                      {t.settings.cancelSkillInstall}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : selectedSkillPreview ? (
            <div className="app-sheet-detail flex w-[680px] shrink-0 flex-col overflow-hidden rounded-md border bg-background">
              <div className="flex items-start justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {t.settings.skillPreview}: {selectedSkillPreview.skill.name}
                    </span>
                    {!selectedSkillPreview.skill.removable && (
                      <Badge variant="outline">{t.settings.protectedSkill}</Badge>
                    )}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {selectedSkillPreview.skill.path}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.common.close}
                  title={t.common.close}
                  onClick={() => setSelectedSkillPreview(null)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3 text-sm">
                {selectedSkillPreview.content ? (
                  <MarkdownContent value={selectedSkillPreview.content} t={t} />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden="true" />
                    {t.settings.skillPreviewLoading}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            disabled={skillInstallLogCount === 0}
            onClick={() =>
              setSkillInstallLogResultId(
                (current) => current ?? skillInstallLogResultIds[0] ?? null
              )
            }
          >
            <FileTextIcon data-icon="inline-start" />
            {t.settings.skillInstallLogs}
            {skillInstallLogCount > 0 ? ` (${skillInstallLogCount})` : ''}
          </Button>
          <Button type="button" variant="outline" onClick={() => void refreshSkills()}>
            <SearchIcon data-icon="inline-start" />
            {t.settings.refreshSkills}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
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
    <Sheet open={historyOpen} onOpenChange={setHistorySheetOpen}>
      <SheetContent side="left" className="w-[420px] sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>{t.history.title}</SheetTitle>
          <SheetDescription>{t.history.description}</SheetDescription>
        </SheetHeader>
        <div className="app-sheet-list min-h-0 flex-1 space-y-2 overflow-auto px-4">
          {historyLoading && (
            <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              {t.history.loading}
            </div>
          )}
          {!historyLoading && historyItems.length === 0 && (
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              {t.history.empty}
            </div>
          )}
          {!historyLoading &&
            historyItems.map((item) => {
              const editing = historyTitleEditingId === item.tabId

              return (
                <div
                  key={item.tabId}
                  className="flex items-start gap-2 rounded-md border bg-card p-3 text-sm transition hover:border-primary/60 hover:bg-muted/30"
                >
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <div className="space-y-2">
                        <Input
                          value={historyTitleDraft}
                          onChange={(event) => setHistoryTitleDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void saveHistorySessionTitle(item)
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelRenameHistorySession()
                            }
                          }}
                          aria-label={t.history.renameTitle}
                          autoFocus
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={cancelRenameHistorySession}
                          >
                            {t.common.cancel}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={
                              !historyTitleDraft.trim() || historyTitleSavingId === item.tabId
                            }
                            onClick={() => void saveHistorySessionTitle(item)}
                          >
                            {historyTitleSavingId === item.tabId && (
                              <Loader2Icon className="animate-spin" data-icon="inline-start" />
                            )}
                            {t.common.save}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="min-w-0 text-left"
                        onClick={() => void openHistorySession(item)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-medium">{item.title}</span>
                          {item.isSsh && (
                            <Badge variant="secondary" className="shrink-0">
                              SSH
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <time dateTime={item.lastMessageAt ?? item.updatedAt}>
                            {formatHistoryTime(item.lastMessageAt ?? item.updatedAt)}
                          </time>
                          {item.connectionName && (
                            <span className="truncate">· {item.connectionName}</span>
                          )}
                          <span className="shrink-0">
                            · {item.runCount} {t.history.runs}
                          </span>
                        </div>
                        {(item.summary || item.lastMessage) && (
                          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                            {item.summary ?? summarizeHistoryMessage(item.lastMessage ?? '')}
                          </p>
                        )}
                      </button>
                    )}
                  </div>
                  {!editing && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0"
                      aria-label={`${t.history.renameTitle}: ${item.title}`}
                      title={`${t.history.renameTitle}: ${item.title}`}
                      onClick={() => startRenameHistorySession(item)}
                    >
                      <PencilIcon aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0"
                    aria-label={`${t.wiki.saveFromHistory}: ${item.title}`}
                    title={`${t.wiki.saveFromHistory}: ${item.title}`}
                    disabled={editing || savingHistoryWikiTabId === item.tabId}
                    onClick={() => void saveHistorySessionToWiki(item)}
                  >
                    {savingHistoryWikiTabId === item.tabId ? (
                      <Loader2Icon className="animate-spin" aria-hidden="true" />
                    ) : (
                      <FileTextIcon aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0"
                    aria-label={`${t.common.delete}: ${item.title}`}
                    title={`${t.common.delete}: ${item.title}`}
                    disabled={editing}
                    onClick={() => void deleteHistorySession(item)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
              )
            })}
        </div>
        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => void refreshSessionHistory()}
            disabled={historyLoading}
          >
            {historyLoading && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            {t.history.refresh}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
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
              {getTerminalDisplayTitle(activeTab)} · {activeTab.terminalCwd || t.app.shellStarting}
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
          <Sheet
            open={sheetOpen}
            onOpenChange={(open) => {
              setSheetOpen(open)
              if (!open) {
                setProviderEditorOpen(false)
                setInstructionEditorOpen(false)
              }
            }}
          >
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t.common.settings}
                title={t.common.settings}
              >
                <SettingsIcon aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent
              className={`w-full ${
                (providerEditorOpen && settingsProvider.id) ||
                (instructionEditorOpen && selectedInstructionFile)
                  ? 'sm:max-w-5xl'
                  : 'sm:max-w-2xl'
              }`}
            >
              <SheetHeader>
                <SheetTitle>{t.settings.title}</SheetTitle>
                <SheetDescription>{t.settings.titleDescription}</SheetDescription>
              </SheetHeader>
              <div className="app-sheet-split flex min-h-0 flex-1 flex-row-reverse gap-3 overflow-hidden px-4">
                <div className="app-sheet-main min-w-0 flex-1 space-y-4 overflow-auto">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      {t.settings.providerList} · {config.providers.length}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={createProvider}>
                      <PlusIcon data-icon="inline-start" />
                      {t.settings.newProvider}
                    </Button>
                  </div>
                  {config.providers.length === 0 ? (
                    <div className="rounded-md border bg-muted/10 p-3 text-xs text-muted-foreground">
                      <BotIcon className="mr-2 inline size-3" aria-hidden="true" />
                      {t.settings.modelHint}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {config.providers.map((provider) => {
                        const selected = providerEditorOpen && settingsProviderId === provider.id
                        const isDefaultProvider = config.providerId === provider.id
                        const modelCount = provider.models.length
                        const hasApiKey = Boolean(provider.apiKey?.trim())

                        return (
                          <div
                            key={provider.id}
                            className={`flex min-w-0 cursor-pointer flex-col gap-3 rounded-md border bg-card p-3 text-xs transition hover:bg-muted/30 ${
                              selected ? 'border-primary/70 ring-1 ring-primary/30' : ''
                            }`}
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleProviderDetails(provider.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                toggleProviderDetails(provider.id)
                              }
                            }}
                          >
                            <div className="min-w-0 text-left">
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <StatusDot
                                      state={
                                        provider.baseUrl.trim() && modelCount > 0
                                          ? 'ready'
                                          : 'not-ready'
                                      }
                                    />
                                    <span className="truncate text-sm font-medium">
                                      {provider.name || provider.id}
                                    </span>
                                  </div>
                                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                                    {provider.id}
                                  </div>
                                </div>
                                {isDefaultProvider && (
                                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                                    {t.settings.model}
                                  </Badge>
                                )}
                              </div>
                              <div className="mt-3 truncate font-mono text-[11px] text-muted-foreground">
                                {provider.baseUrl || '-'}
                              </div>
                              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>
                                  {t.settings.providerModels}: {modelCount}
                                </span>
                                <span>·</span>
                                <span>{hasApiKey ? t.settings.apiKey : '-'}</span>
                              </div>
                              {provider.models.length > 0 && (
                                <div className="mt-2 line-clamp-2 font-mono text-[11px] text-muted-foreground">
                                  {provider.models.map((model) => model.id).join(', ')}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="model">{t.settings.model}</FieldLabel>
                      <Select
                        value={config.model}
                        onValueChange={(value) => void applyDefaultModel(value)}
                      >
                        <SelectTrigger id="model" className="w-full">
                          <SelectValue placeholder={t.settings.selectModel} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>{t.settings.modelGroup}</SelectLabel>
                            {modelOptions.map((model) => (
                              <SelectItem key={`${model.providerId}:${model.id}`} value={model.id}>
                                {model.name} · {model.providerName}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldDescription>{t.settings.modelHint}</FieldDescription>
                    </Field>
                    <Field>
                      <label
                        htmlFor="close-terminal-confirm"
                        className="flex items-start justify-between gap-3 rounded-md border bg-muted/10 p-3"
                      >
                        <span className="space-y-1">
                          <span className="block text-sm font-medium">
                            {t.settings.closeTerminalConfirm}
                          </span>
                          <FieldDescription>{t.settings.closeTerminalConfirmHint}</FieldDescription>
                        </span>
                        <Input
                          id="close-terminal-confirm"
                          type="checkbox"
                          checked={closeTerminalConfirmEnabled}
                          onChange={(event) => setCloseTerminalConfirmEnabled(event.target.checked)}
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                        />
                      </label>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="max-active-tools">
                        {t.settings.dynamicToolLimit}
                      </FieldLabel>
                      <Input
                        id="max-active-tools"
                        type="number"
                        min={1}
                        max={12}
                        value={config.maxActiveTools}
                        onChange={(event) =>
                          updateConfig('maxActiveTools', Number(event.target.value))
                        }
                      />
                      <FieldDescription>{t.settings.maxToolsHint}</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="command-whitelist">
                        {t.settings.commandWhitelist}
                      </FieldLabel>
                      <Textarea
                        id="command-whitelist"
                        className="min-h-28 resize-y font-mono text-xs"
                        value={commandWhitelistText}
                        onChange={(event) => {
                          const text = event.target.value
                          setCommandWhitelistText(text)
                          updateConfig('commandWhitelist', parseCommandWhitelist(text))
                        }}
                        placeholder={'exact command\ncommand prefix *\n/^custom regex rule$/'}
                      />
                      <FieldDescription>{t.settings.commandWhitelistHint}</FieldDescription>
                    </Field>
                    <Separator />
                    <Field>
                      <div className="flex items-center justify-between gap-2">
                        <FieldLabel>{t.settings.instructionFiles}</FieldLabel>
                        <span className="text-xs text-muted-foreground">
                          {instructionFiles.length}
                        </span>
                      </div>
                      {instructionFiles.length === 0 ? (
                        <div className="rounded-md border bg-muted/10 p-3 text-xs text-muted-foreground">
                          <FileTextIcon className="mr-2 inline size-3" aria-hidden="true" />
                          {t.settings.instructionFilePlaceholder}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {instructionFiles.map((file) => {
                            const selected =
                              instructionEditorOpen && file.name === selectedInstructionName
                            const contentLength = file.content.trim().length

                            return (
                              <div
                                key={file.name}
                                className={`flex min-w-0 cursor-pointer flex-col gap-3 rounded-md border bg-card p-3 text-xs transition hover:bg-muted/30 ${
                                  selected ? 'border-primary/70 ring-1 ring-primary/30' : ''
                                }`}
                                role="button"
                                tabIndex={0}
                                onClick={() => toggleInstructionDetails(file.name)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    toggleInstructionDetails(file.name)
                                  }
                                }}
                              >
                                <div className="min-w-0 text-left">
                                  <div className="flex min-w-0 items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex min-w-0 items-center gap-2">
                                        <StatusDot state={file.exists ? 'ready' : 'pending'} />
                                        <span className="truncate text-sm font-medium">
                                          {file.name}
                                        </span>
                                      </div>
                                      <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                                        {file.path}
                                      </div>
                                    </div>
                                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                                      {file.exists
                                        ? t.settings.instructionFileExists
                                        : t.settings.instructionFileNew}
                                    </Badge>
                                  </div>
                                  <div className="mt-3 text-[11px] text-muted-foreground">
                                    {contentLength} chars
                                  </div>
                                  {file.content.trim() && (
                                    <div className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">
                                      {file.content.trim().replace(/\s+/g, ' ')}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </Field>
                    <Separator />
                    {validation && (
                      <div className="rounded-md border bg-muted/40 p-3 text-xs">
                        {validation.ok ? (
                          <div className="space-y-2">
                            <p className="font-medium text-green-400">
                              {t.settings.selectedTools}: {validation.toolCount}
                            </p>
                            <div className="space-y-1 text-muted-foreground">
                              {validation.tools?.map((tool) => (
                                <p key={tool.name}>
                                  {tool.name} · {tool.method.toUpperCase()} {tool.path}
                                </p>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-destructive">{validation.error}</p>
                        )}
                      </div>
                    )}
                  </FieldGroup>
                </div>
                {providerEditorOpen && settingsProvider.id ? (
                  <div className="app-sheet-detail flex w-[560px] shrink-0 flex-col overflow-hidden rounded-md border bg-background">
                    <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {t.settings.providerList}: {settingsProvider.name || settingsProvider.id}
                        </div>
                        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {settingsProvider.id}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={config.providers.length <= 1}
                          aria-label={t.settings.deleteProvider}
                          title={t.settings.deleteProvider}
                          onClick={deleteSettingsProvider}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t.common.close}
                          title={t.common.close}
                          onClick={() => setProviderEditorOpen(false)}
                        >
                          <XIcon aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-3">
                      <FieldGroup>
                        <div className="grid grid-cols-2 gap-2">
                          <Field>
                            <FieldLabel htmlFor="provider-id">{t.settings.providerId}</FieldLabel>
                            <Input
                              id="provider-id"
                              value={settingsProvider.id}
                              onChange={(event) => updateSettingsProvider('id', event.target.value)}
                              placeholder="provider-id"
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="provider-name">
                              {t.settings.providerName}
                            </FieldLabel>
                            <Input
                              id="provider-name"
                              value={settingsProvider.name}
                              onChange={(event) =>
                                updateSettingsProvider('name', event.target.value)
                              }
                              placeholder={t.settings.providerName}
                            />
                          </Field>
                        </div>
                        <Field>
                          <FieldLabel htmlFor="provider-base-url">{t.settings.baseUrl}</FieldLabel>
                          <Input
                            id="provider-base-url"
                            value={settingsProvider.baseUrl}
                            onChange={(event) =>
                              updateSettingsProvider('baseUrl', event.target.value)
                            }
                            placeholder="https://api.deepseek.com"
                          />
                          <FieldDescription>{t.settings.baseUrlHint}</FieldDescription>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="provider-api-key">{t.settings.apiKey}</FieldLabel>
                          <Input
                            id="provider-api-key"
                            type="password"
                            value={settingsProvider.apiKey ?? ''}
                            onChange={(event) =>
                              updateSettingsProvider('apiKey', event.target.value)
                            }
                            placeholder="sk-... or leave blank when env key is available"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="provider-models">
                            {t.settings.providerModels}
                          </FieldLabel>
                          <Textarea
                            id="provider-models"
                            className="min-h-44 resize-y font-mono text-xs"
                            value={providerModelsText}
                            onChange={(event) => updateSettingsProviderModels(event.target.value)}
                            placeholder={'model-id\nmodel-id-reasoner'}
                          />
                          <FieldDescription>{t.settings.modelListHint}</FieldDescription>
                        </Field>
                      </FieldGroup>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2">
                      <Button
                        type="button"
                        onClick={async () => {
                          await saveConfig()
                          setProviderEditorOpen(false)
                        }}
                      >
                        {saved ? (
                          <CheckIcon data-icon="inline-start" />
                        ) : (
                          <BotIcon data-icon="inline-start" />
                        )}
                        {saved ? t.settings.saved : t.settings.saveSettings}
                      </Button>
                    </div>
                  </div>
                ) : instructionEditorOpen && selectedInstructionFile ? (
                  <div className="app-sheet-detail flex w-[560px] shrink-0 flex-col overflow-hidden rounded-md border bg-background">
                    <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {t.settings.instructionFiles}: {selectedInstructionFile.name}
                        </div>
                        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {selectedInstructionFile.path}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t.common.close}
                        title={t.common.close}
                        onClick={() => setInstructionEditorOpen(false)}
                      >
                        <XIcon aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-3">
                      <FieldGroup>
                        <Field>
                          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/10 p-3">
                            <div className="min-w-0 space-y-1">
                              <div className="truncate text-sm font-medium">
                                {selectedInstructionFile.name}
                              </div>
                              <FieldDescription>
                                {selectedInstructionFile.exists
                                  ? t.settings.instructionFileExists
                                  : t.settings.instructionFileNew}
                              </FieldDescription>
                            </div>
                            <Badge variant="secondary" className="shrink-0">
                              {instructionContent.trim().length} chars
                            </Badge>
                          </div>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="instruction-content">
                            {t.settings.instructionFiles}
                          </FieldLabel>
                          <Textarea
                            id="instruction-content"
                            className="min-h-[420px] resize-y font-mono text-xs"
                            value={instructionContent}
                            onChange={(event) => {
                              setInstructionContent(event.target.value)
                              setInstructionSaved(false)
                            }}
                            placeholder={t.settings.instructionFilePlaceholder}
                          />
                          <FieldDescription>{selectedInstructionFile.path}</FieldDescription>
                        </Field>
                      </FieldGroup>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2">
                      <Button type="button" onClick={saveInstructionFile}>
                        {instructionSaved ? (
                          <CheckIcon data-icon="inline-start" />
                        ) : (
                          <FileTextIcon data-icon="inline-start" />
                        )}
                        {instructionSaved
                          ? t.settings.instructionFileSaved
                          : t.settings.saveInstructionFile}
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
                  {saved ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : (
                    <BotIcon data-icon="inline-start" />
                  )}
                  {saved ? t.settings.saved : t.settings.saveSettings}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
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
          <div
            className="app-terminal-pane flex min-h-0 flex-col"
            style={{ width: hiddenPane === 'chat' ? '100%' : `${terminalPanePercent}%` }}
          >
            <TerminalTabBar
              tabs={terminalTabs}
              terminalPage={terminalPage}
              activeTabId={activeTabId}
              tabMenu={tabMenu}
              t={t}
              onNewConnection={openNewConnectionForm}
              onSelectTab={(tabId) => {
                setActiveTabId(tabId)
                setTerminalPage('terminal')
              }}
              onOpenTabMenu={setTabMenu}
              onCloseTab={closeTab}
              onCloseOtherTabs={closeOtherTabs}
              onCloseAllTabs={closeAllTabs}
            />
            <div className="flex min-h-0 flex-1 flex-col">
              {terminalTabs.length === 0 ? (
                <div className="min-h-0 flex-1 bg-background/80 p-4">
                  <ConnectionList
                    className="mx-auto h-full max-w-3xl"
                    connections={displayConnections}
                    filteredConnections={filteredDisplayConnections}
                    query={connectionSearchQuery}
                    t={t}
                    formatConnectionTarget={formatConnectionTarget}
                    onQueryChange={setConnectionSearchQuery}
                    headerAction={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={showConnectionList}
                      >
                        <ServerIcon data-icon="inline-start" />
                        {t.connections.manageConnections}
                      </Button>
                    }
                    renderConnectionActions={(connection) => (
                      <Button
                        type="button"
                        size="sm"
                        className="shrink-0"
                        onClick={() => connectFromConnectionManager(connection)}
                      >
                        <ServerIcon data-icon="inline-start" />
                        {t.connections.connect}
                      </Button>
                    )}
                  />
                </div>
              ) : (
                <div ref={terminalHostRef} className="terminal-canvas min-h-0 flex-1" />
              )}
              <SubterminalPanel
                activeTab={activeTab}
                collapsed={subterminalCollapsed}
                panelHeight={subterminalPanelHeight}
                resizeRef={subterminalResizeRef}
                heightResizeRef={subterminalHeightResizeRef}
                t={t}
                onCollapsedChange={setSubterminalCollapsed}
                onCloseSubterminal={closeSubterminal}
                onCloseAllSubterminals={closeAllSubterminals}
              />
            </div>
          </div>
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
          <aside className="app-agent-pane flex min-h-0 min-w-[360px] flex-1 flex-col">
            <AgentLogList
              logRef={agentLogRef}
              entries={activeTab.agentLog}
              copiedLogId={activeTab.copiedLogId}
              t={t}
              onCopyEntry={(entry) => void copyLogEntry(entry)}
              onCopyResult={(entry) => void copyLogEntryResult(entry)}
              onExportResult={(entry) => void exportLogEntryResultMarkdown(entry)}
              onExportFull={(entry) => void exportLogEntryFullMarkdown(entry)}
            />
            <div className="app-input-dock space-y-3 p-4">
              <form onSubmit={submitAgent} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label={hiddenPane === 'terminal' ? t.app.showTerminal : t.app.hideTerminal}
                    title={hiddenPane === 'terminal' ? t.app.showTerminal : t.app.hideTerminal}
                    onClick={() => {
                      setHiddenPane((current) => (current === 'terminal' ? null : 'terminal'))
                    }}
                  >
                    {hiddenPane === 'terminal' ? (
                      terminalPaneFirst ? (
                        <PanelLeftOpenIcon aria-hidden="true" />
                      ) : (
                        <PanelRightOpenIcon aria-hidden="true" />
                      )
                    ) : terminalPaneFirst ? (
                      <PanelLeftCloseIcon aria-hidden="true" />
                    ) : (
                      <PanelRightCloseIcon aria-hidden="true" />
                    )}
                  </Button>
                  <Select
                    value={activeModelSelectionValue}
                    onValueChange={applyConversationModel}
                    disabled={visibleModels.length === 0}
                  >
                    <SelectTrigger className="h-8 min-w-0 flex-1" title={aiStatusText}>
                      <span className="sr-only">
                        <SelectValue aria-label={t.app.model} />
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <StatusDot state={aiState} />
                        <span className="truncate">
                          {activeModel
                            ? `${activeModel.name} · ${activeModel.providerName}`
                            : activeTabModelId}
                        </span>
                        {validation?.modelOk === false && (
                          <TriangleAlertIcon
                            className="size-3.5 shrink-0 text-destructive"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>{t.app.model}</SelectLabel>
                        {visibleModels.map((model) => (
                          <SelectItem
                            key={`${model.providerId}:${model.id}`}
                            value={buildModelSelectionValue(model.providerId, model.id)}
                          >
                            {model.name} · {model.providerName}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Select
                    value={config.agentMode}
                    onValueChange={(value) => {
                      if (value === 'react' || value === 'plan-execute') {
                        updateConfig('agentMode', value)
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 min-w-0 flex-1">
                      <SelectValue aria-label={t.settings.agentMode} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>{t.settings.agentMode}</SelectLabel>
                        <SelectItem value="react">ReAct</SelectItem>
                        <SelectItem value="plan-execute">Plan-and-Execute</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="relative rounded-lg border bg-background/95 p-2 shadow-sm">
                  <SlashCommandMenu
                    visible={slashMenuVisible}
                    listRef={slashCommandListRef}
                    options={slashCommandOptions}
                    selectedIndex={selectedSlashCommandIndex}
                    t={t}
                    onSelect={insertSlashCommand}
                  />
                  <AgentReferenceBadges
                    skillRefs={activeTab.skillRefs}
                    pathRefs={activeTab.pathRefs}
                    toolRefs={activeTab.toolRefs}
                    wikiRefs={activeTab.wikiRefs}
                    t={t}
                    onRemoveSkill={removeSkillRef}
                    onRemovePath={removePathRef}
                    onRemoveTool={removeToolRef}
                    onRemoveWiki={removeWikiRef}
                  />
                  <Textarea
                    value={activeTab.agentInput}
                    onChange={(event) => {
                      setSlashCommandOpen(true)
                      setSlashCommandIndex(0)
                      updateTab(activeTab.id, (tab) => ({ ...tab, agentInput: event.target.value }))
                    }}
                    onKeyDown={handleAgentInputKeyDown}
                    onPaste={(event) => void handleAgentInputPaste(event)}
                    placeholder={t.input.askPlaceholder}
                    className="max-h-40 min-h-20 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2 text-xs text-muted-foreground">
                    <span>
                      {activeTab.agentThinking
                        ? t.input.thinking
                        : activeTab.agentBusy
                          ? t.input.contextHint
                          : t.input.currentTerminal}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t.input.referenceFile}
                        title={t.input.referenceFile}
                        onClick={() => void pickPathReference('file')}
                      >
                        <FileIcon aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t.input.referenceDirectory}
                        title={t.input.referenceDirectory}
                        onClick={() => void pickPathReference('directory')}
                      >
                        <FolderOpenIcon aria-hidden="true" />
                      </Button>
                      <span>{configured ? t.input.toolsConfigured : t.input.chatNoTools}</span>
                      {activeTab.agentBusy && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="xs"
                          className="h-5 px-2 text-[11px]"
                          onClick={() => stopAgentRun()}
                        >
                          {t.common.stop}
                        </Button>
                      )}
                      {(activeAgentPending || activeTab.agentInput.trim()) && (
                        <Button
                          type="submit"
                          size={activeAgentPending ? 'icon-xs' : 'icon'}
                          aria-label={
                            activeTab.agentThinking
                              ? t.input.thinking
                              : activeTab.agentBusy
                                ? t.input.contextAdd
                                : t.common.send
                          }
                          disabled={activeTab.agentThinking}
                        >
                          {activeTab.agentThinking ||
                          (activeTab.agentBusy && !activeTab.agentInput.trim()) ? (
                            <Loader2Icon className="animate-spin" aria-hidden="true" />
                          ) : activeTab.agentBusy ? (
                            <PlusIcon aria-hidden="true" />
                          ) : (
                            <ArrowUpIcon aria-hidden="true" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </aside>
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
      <PasswordPromptModal
        request={passwordPromptRequest}
        t={t}
        value={passwordPromptValue}
        error={passwordPromptError}
        inputRef={passwordPromptInputRef}
        onChange={setPasswordPromptValue}
        onCancel={cancelPasswordPrompt}
        onSubmit={submitPasswordPrompt}
      />
      <CommandApprovalModal
        commandApproval={commandApproval}
        t={t}
        riskLabel={commandApproval ? riskLabel(commandApproval.audit.risk, t) : ''}
        rejectionReason={commandRejectionReason}
        onRejectionReasonChange={setCommandRejectionReason}
        onResolve={resolveCommandApproval}
      />
      <AppFooter shellState={shellState} activeTab={activeTab} t={t} />
    </main>
  )
}

function summarizeHistoryMessage(value: string): string {
  const compact = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (compact.length <= 120) return compact
  return `${compact.slice(0, 120)}...`
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
  t: Dictionary
): Promise<void> {
  const [sshCommand, ...loginActions] = commands
  if (!sshCommand) return

  const firstActionReady = loginActions.length ? waitForTerminalActionPrompt(tabId) : undefined
  window.api.terminal.pasteCommand(sshCommand, true, tabId)

  if (loginActions.length === 0) return

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
        tabId
      )
      return
    }

    sendTerminalInput(action, tabId)
    appendLog(
      {
        kind: 'command',
        text: formatConnectionActionLog(action, index + 1, t)
      },
      tabId
    )
  }

  return
}

async function runConnectionLoginActionSequence(
  loginActions: string[],
  tabId: string,
  appendLog: (entry: Omit<AgentLogEntry, 'id' | 'createdAt'>, tabId?: string) => void,
  t: Dictionary
): Promise<void> {
  if (loginActions.length === 0) return

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
        tabId
      )
      return
    }

    sendTerminalInput(action, tabId)
    appendLog(
      {
        kind: 'command',
        text: formatConnectionActionLog(action, index + 1, t)
      },
      tabId
    )
  }
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

export default App
