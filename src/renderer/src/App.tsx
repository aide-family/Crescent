import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import {
  ArrowUpIcon,
  BookOpenIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
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
  PlusIcon,
  ServerIcon,
  SettingsIcon,
  SearchIcon,
  TestTube2Icon,
  TerminalIcon,
  TriangleAlertIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'

import { ProductLogo } from '@renderer/components/ProductLogo'
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
import type {
  AgentConfig,
  AgentConnectionIntentResult,
  AgentEvent,
  AgentModelOption,
  AgentPathReference,
  AgentProviderConfig,
  AgentProviderModelConfig,
  AgentSkillSearchResult,
  AgentValidationResult,
  AgentSkillOption,
  AgentWikiReference,
  CommandApprovalRequest,
  CommandRiskLevel,
  ConnectionConfig,
  ConnectionInput,
  LocalInstructionDocument,
  StoredAgentLogEntry,
  StoredSessionHistoryDetail,
  StoredSessionHistoryItem,
  WikiDocument,
  WikiDocumentSummary
} from '../../shared/agent-types'
import { BUILT_IN_TOOL_CATALOG } from '../../shared/agent-tool-catalog'

const emptyConfig: AgentConfig = {
  providers: [
    {
      id: 'nova-litellm',
      name: 'Nova LiteLLM',
      baseUrl: 'http://nova.dmxwg.yiducloud.cn/litellm',
      apiKey: '',
      models: [
        { id: 'azure/gpt-5.4', name: 'azure/gpt-5.4', reasoning: true },
        { id: 'azure/gpt-5.5', name: 'azure/gpt-5.5', reasoning: true },
        { id: 'bailian/glm-5-1', name: 'bailian/glm-5-1', reasoning: false },
        { id: 'bailian/qwen3.6-plus', name: 'bailian/qwen3.6-plus', reasoning: false }
      ]
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      models: [
        { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', reasoning: false },
        { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', reasoning: true },
        { id: 'deepseek-chat', name: 'deepseek-chat', reasoning: false },
        { id: 'deepseek-reasoner', name: 'deepseek-reasoner', reasoning: true }
      ]
    }
  ],
  providerId: 'nova-litellm',
  model: 'azure/gpt-5.5',
  agentMode: 'react',
  maxActiveTools: 5,
  commandWhitelist: [],
  openApiBaseUrl: '',
  openApiDocument: ''
}
const CLOSE_TERMINAL_CONFIRM_STORAGE_KEY = 'crescent.closeTerminalConfirmEnabled'

type AgentLogEntry =
  | { id: number; kind: 'user' | 'assistant' | 'error'; text: string; createdAt: string }
  | {
      id: number
      kind: 'status' | 'thought' | 'tool' | 'plan' | 'command'
      text: string
      createdAt: string
    }

interface AgentRunViewState {
  logId: number
  actions: AgentRunAction[]
  startedAt?: number
  result?: string
  error?: string
  elapsedMs?: number
}

interface AgentRunAction {
  title: string
  detail: string
}

interface PasswordPromptRequest {
  tabId: string
  title: string
  prompt: string
}

type SkillManageMessage = {
  type: 'info' | 'success' | 'error'
  text: string
}

interface CloseTabsConfirmRequest {
  mode: 'tab' | 'other-tabs'
  tabId: string
  dontAskAgain: boolean
}

interface PostConnectionTask {
  input: string
  displayInput: string
  connection: ConnectionConfig
  appendUserLog: boolean
  startedAt: number
}

interface SlashCommandOption {
  id: string
  title: string
  description: string
  value: string
  keywords: string[]
  skill?: AgentSkillOption
  connection?: ConnectionConfig
  agentMode?: AgentConfig['agentMode']
  pathReferenceKind?: AgentPathReference['kind']
  toolRef?: AgentToolReference
  wikiRef?: AgentWikiReference
  wikiDocument?: WikiDocumentSummary
}

interface AgentToolReference {
  id: string
  name: string
  description: string
  source: 'built-in' | 'openapi'
}

interface AgentTerminalTab {
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

interface TemporarySubterminal {
  id: string
  name: string
  output: string
  rawOutput: string
  cwd: string
  status: 'active' | 'exited'
  widthPercent?: number
}

function createTerminalTab(input?: Partial<AgentTerminalTab>): AgentTerminalTab {
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

const emptyLocalTab = createTerminalTab({ id: 'default', title: 'Local' })

function getNextTerminalTitle(baseTitle: string, tabs: AgentTerminalTab[]): string {
  const normalizedBase = baseTitle.trim() || 'Terminal'
  const titles = new Set(tabs.map((tab) => tab.title))

  if (!titles.has(normalizedBase)) return normalizedBase

  for (let index = 1; ; index += 1) {
    const candidate = `${normalizedBase} ${index}`
    if (!titles.has(candidate)) return candidate
  }
}

function formatPipePrompt(cwd: string): string {
  const home = cwd.replace(/^\/Users\/[^/]+/, '~')

  return `\x1b[38;5;45m${home}\x1b[0m $ `
}

function getPipePrompt(prompt: string, cwd: string): string {
  return prompt || formatPipePrompt(cwd)
}

function App(): React.JSX.Element {
  const terminalHostRef = useRef<HTMLDivElement | null>(null)
  const connectionSearchInputRef = useRef<HTMLInputElement | null>(null)
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
        startedAt?: number
      ) => Promise<void>)
    | null
  >(null)
  const activeAgentRunRef = useRef(new Map<string, AgentRunViewState>())
  const splitDragRef = useRef(false)
  const [config, setConfig] = useState<AgentConfig>(emptyConfig)
  const [commandWhitelistText, setCommandWhitelistText] = useState('')
  const [providerModelsText, setProviderModelsText] = useState(
    formatProviderModels(emptyConfig.providers[0]?.models ?? [])
  )
  const [models, setModels] = useState<AgentModelOption[]>([])
  const [skills, setSkills] = useState<AgentSkillOption[]>([])
  const [localSkillSearchQuery, setLocalSkillSearchQuery] = useState('')
  const [skillSearchQuery, setSkillSearchQuery] = useState('Browser')
  const [skillSearchResults, setSkillSearchResults] = useState<AgentSkillSearchResult[]>([])
  const [skillSearchLoading, setSkillSearchLoading] = useState(false)
  const [skillInstallingId, setSkillInstallingId] = useState<string | null>(null)
  const [skillDeletingPath, setSkillDeletingPath] = useState<string | null>(null)
  const [copiedSkillCommandId, setCopiedSkillCommandId] = useState<string | null>(null)
  const [skillManageMessage, setSkillManageMessage] = useState<SkillManageMessage | null>(null)
  const [instructionFiles, setInstructionFiles] = useState<LocalInstructionDocument[]>([])
  const [selectedInstructionName, setSelectedInstructionName] = useState('IDENTITY.md')
  const [instructionContent, setInstructionContent] = useState('')
  const [instructionSaved, setInstructionSaved] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyItems, setHistoryItems] = useState<StoredSessionHistoryItem[]>([])
  const [wikiOpen, setWikiOpen] = useState(false)
  const [wikiLoading, setWikiLoading] = useState(false)
  const [wikiDocumentLoadingId, setWikiDocumentLoadingId] = useState<string | null>(null)
  const [wikiDocuments, setWikiDocuments] = useState<WikiDocumentSummary[]>([])
  const [selectedWikiDocument, setSelectedWikiDocument] = useState<WikiDocument | null>(null)
  const [wikiSearchQuery, setWikiSearchQuery] = useState('')
  const [wikiEditing, setWikiEditing] = useState(false)
  const [wikiEditTitle, setWikiEditTitle] = useState('')
  const [wikiEditContent, setWikiEditContent] = useState('')
  const [wikiSaving, setWikiSaving] = useState(false)
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
  const [connectionSearchQuery, setConnectionSearchQuery] = useState('')
  const [connectionModalOpen, setConnectionModalOpen] = useState(false)
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
  const [terminalPage, setTerminalPage] = useState<'terminal' | 'connections'>('connections')
  const [slashCommandOpen, setSlashCommandOpen] = useState(true)
  const [slashCommandIndex, setSlashCommandIndex] = useState(0)
  const [locale, setLocale] = useState<Locale>(() => resolveInitialLocale())
  const [closeTerminalConfirmEnabled, setCloseTerminalConfirmEnabled] = useState(
    () => localStorage.getItem(CLOSE_TERMINAL_CONFIRM_STORAGE_KEY) !== 'false'
  )
  const [closeTabsConfirmRequest, setCloseTabsConfirmRequest] =
    useState<CloseTabsConfirmRequest | null>(null)
  const [settingsProviderId, setSettingsProviderId] = useState('nova-litellm')
  const [tabs, setTabs] = useState<AgentTerminalTab[]>([
    createTerminalTab({ id: 'default', title: 'Local' })
  ])
  const [activeTabId, setActiveTabId] = useState('default')
  const [tabMenu, setTabMenu] = useState<{
    tabId: string
    x: number
    y: number
  } | null>(null)
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
  const providerOptions = useMemo(
    () =>
      config.providers.map((provider) => ({
        id: provider.id,
        name: provider.name || provider.id
      })),
    [config.providers]
  )
  const modelOptions = useMemo(() => flattenProviderModels(config.providers), [config.providers])
  const visibleModels = modelOptions.length ? modelOptions : models
  const activeTabProviderId = activeTab.providerId ?? config.providerId
  const activeProviderId =
    config.providers.some((provider) => provider.id === activeTabProviderId)
      ? (activeTabProviderId ?? config.providers[0]?.id ?? 'custom')
      : (visibleModels.find((model) => model.id === (activeTab.model ?? config.model))?.providerId ??
        config.providers[0]?.id ??
        'custom')
  const filteredModels = visibleModels.filter((model) => model.providerId === activeProviderId)
  const activeTabModelId =
    activeTab.model && filteredModels.some((model) => model.id === activeTab.model)
      ? activeTab.model
      : (filteredModels[0]?.id ?? config.model)
  const activeModel = visibleModels.find(
    (model) => model.id === activeTabModelId && model.providerId === activeProviderId
  )
  const settingsProvider =
    config.providers.find((provider) => provider.id === settingsProviderId) ??
    config.providers[0] ??
    emptyConfig.providers[0]
  const availableToolRefs = useMemo(() => buildAvailableToolRefs(validation), [validation])
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
  const shellState: 'ready' | 'pending' | 'not-ready' = activeTab.terminalReady
    ? 'ready'
    : activeTab.sessionId
      ? 'not-ready'
      : 'pending'
  const terminalVisible = hiddenPane !== 'terminal' && terminalPage === 'terminal'
  const slashCommandQuery = getSlashCommandQuery(activeTab.agentInput)
  const slashCommandOptions = useMemo(() => {
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
  }, [availableToolRefs, connections, skills, slashCommandQuery, t, wikiDocuments])
  const slashMenuVisible =
    slashCommandOpen && slashCommandQuery !== undefined && slashCommandOptions.length > 0
  const selectedSlashCommandIndex = slashCommandOptions.length
    ? Math.min(slashCommandIndex, slashCommandOptions.length - 1)
    : 0
  const failedToLoadConfigText = t.terminal.failedToLoadConfig
  const failedToLoadConnectionsText = t.terminal.failedToLoadConnections
  const failedToLoadModelsText = t.terminal.failedToLoadModels

  useEffect(() => {
    if (!slashMenuVisible) return

    const selectedItem = slashCommandListRef.current?.querySelector<HTMLElement>(
      `[data-slash-command-index="${selectedSlashCommandIndex}"]`
    )
    selectedItem?.scrollIntoView({ block: 'nearest' })
  }, [selectedSlashCommandIndex, slashCommandOptions.length, slashMenuVisible])

  const configured = useMemo(
    () =>
      Boolean(config.model.trim() && config.openApiBaseUrl.trim() && config.openApiDocument.trim()),
    [config.model, config.openApiBaseUrl, config.openApiDocument]
  )
  const connectionFormReady = useMemo(
    () => Boolean(connectionForm.name.trim() && connectionForm.host.trim()),
    [connectionForm.host, connectionForm.name]
  )
  const connectionCommandPreview = useMemo(() => {
    const host = connectionForm.host.trim()
    if (!host) return ''

    return buildSshCommand({
      id: connectionForm.id || 'preview',
      source: 'custom',
      name: connectionForm.name.trim() || 'preview',
      host,
      user: connectionForm.user?.trim() || undefined,
      port: connectionForm.port || undefined,
      identityFile: connectionForm.identityFile?.trim() || undefined,
      sshOptions: parseSshOptions(connectionSshOptionsText)
    })
  }, [
    connectionForm.host,
    connectionForm.id,
    connectionForm.identityFile,
    connectionForm.name,
    connectionForm.port,
    connectionForm.user,
    connectionSshOptionsText
  ])
  const filteredLocalSkills = useMemo(
    () => filterLocalSkills(skills, localSkillSearchQuery),
    [localSkillSearchQuery, skills]
  )
  const connectionSearchText = connectionSearchQuery.trim().toLowerCase()
  const localTerminalMatchesSearch =
    !connectionSearchText ||
    [
      t.connections.localTerminal,
      t.connections.defaultTerminal,
      'local',
      'terminal',
      'default',
      '本地',
      '默认',
      '终端'
    ].some((value) => value.toLowerCase().includes(connectionSearchText))
  const filteredConnections = useMemo(
    () =>
      connectionSearchText
        ? connections.filter((connection) =>
            matchesConnectionSearch(connection, connectionSearchText)
          )
        : connections,
    [connectionSearchText, connections]
  )

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
    const initialLoad = wikiDocuments.length === 0
    if (initialLoad) setWikiLoading(true)
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
      if (initialLoad) setWikiLoading(false)
    }
  }, [wikiDocuments.length])

  function setWikiSheetOpen(open: boolean): void {
    setWikiOpen(open)
    if (open) {
      setWikiEditing(false)
      setWikiMessage(null)
      void refreshWikiDocuments()
    }
  }

  const updateTab = useCallback(
    (tabId: string, updater: (tab: AgentTerminalTab) => AgentTerminalTab): void => {
      setTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)))
    },
    []
  )

  const upsertSubterminal = useCallback(
    (
      parentTabId: string,
      name: string,
      id: string,
      updater: (subterminal: TemporarySubterminal) => TemporarySubterminal
    ): void => {
      updateTab(parentTabId, (tab) => {
        const existing = tab.subTerminals.find((subterminal) => subterminal.id === id)
        const base: TemporarySubterminal = existing ?? {
          id,
          name,
          output: '',
          rawOutput: '',
          cwd: '',
          status: 'active'
        }
        const nextSubterminal = updater(base)
        const nextSubTerminals = existing
          ? tab.subTerminals.map((subterminal) =>
              subterminal.id === id ? nextSubterminal : subterminal
            )
          : [...tab.subTerminals, nextSubterminal].slice(-3)

        return { ...tab, subTerminals: nextSubTerminals }
      })
    },
    [updateTab]
  )

  const updateSubterminalOutput = useCallback(
    (parentTabId: string, name: string, id: string, data: string): void => {
      upsertSubterminal(parentTabId, name, id, (subterminal) => ({
        ...subterminal,
        status: 'active',
        rawOutput: `${subterminal.rawOutput}${data}`.slice(-120_000),
        output: formatReadableSubterminalOutput(`${subterminal.rawOutput}${data}`).slice(-80_000)
      }))
    },
    [upsertSubterminal]
  )

  const updateSubterminalCwd = useCallback(
    (parentTabId: string, name: string, id: string, cwd: string): void => {
      upsertSubterminal(parentTabId, name, id, (subterminal) => ({
        ...subterminal,
        cwd,
        status: 'active'
      }))
    },
    [upsertSubterminal]
  )

  const updateSubterminalStatus = useCallback(
    (
      parentTabId: string,
      name: string,
      id: string,
      status: TemporarySubterminal['status']
    ): void => {
      upsertSubterminal(parentTabId, name, id, (subterminal) => ({
        ...subterminal,
        status
      }))
    },
    [upsertSubterminal]
  )

  const closeSubterminal = useCallback(
    (parentTabId: string, subterminalId: string): void => {
      window.api.terminal.stop(subterminalId)
      updateTab(parentTabId, (tab) => ({
        ...tab,
        subTerminals: tab.subTerminals.filter((subterminal) => subterminal.id !== subterminalId)
      }))
    },
    [updateTab]
  )

  const closeAllSubterminals = useCallback(
    (parentTabId: string): void => {
      const parentTab = tabsRef.current.find((tab) => tab.id === parentTabId)
      parentTab?.subTerminals.forEach((subterminal) => window.api.terminal.stop(subterminal.id))
      updateTab(parentTabId, (tab) => ({ ...tab, subTerminals: [] }))
    },
    [updateTab]
  )

  const resizeSubterminalPair = useCallback(
    (
      tabId: string,
      leftId: string,
      rightId: string,
      leftWidth: number,
      rightWidth: number
    ): void => {
      updateTab(tabId, (tab) => {
        const currentWidths = getSubterminalWidths(tab.subTerminals)
        const total = leftWidth + rightWidth
        const nextLeft = Math.max(18, Math.min(total - 18, leftWidth))
        const nextRight = total - nextLeft

        return {
          ...tab,
          subTerminals: tab.subTerminals.map((subterminal, index) => {
            if (subterminal.id === leftId) return { ...subterminal, widthPercent: nextLeft }
            if (subterminal.id === rightId) return { ...subterminal, widthPercent: nextRight }
            return {
              ...subterminal,
              widthPercent: subterminal.widthPercent ?? currentWidths[index]
            }
          })
        }
      })
    },
    [updateTab]
  )

  const appendLog = useCallback(
    (entry: Omit<AgentLogEntry, 'id' | 'createdAt'>, tabId = activeTabIdRef.current): number => {
      const id = nextLogIdRef.current
      const createdAt = new Date().toISOString()
      nextLogIdRef.current += 1
      updateTab(tabId, (tab) => ({
        ...tab,
        agentLog: [...tab.agentLog, { id, ...entry, createdAt }].slice(-120)
      }))
      void window.api.storage.saveAgentLog({
        tabId,
        logId: id,
        kind: entry.kind,
        text: entry.text,
        createdAt
      })
      return id
    },
    [updateTab]
  )

  const updateLogEntryText = useCallback(
    (tabId: string, logId: number, text: string): void => {
      updateTab(tabId, (tab) => ({
        ...tab,
        agentLog: tab.agentLog.map((entry) => (entry.id === logId ? { ...entry, text } : entry))
      }))
      void window.api.storage.updateAgentLog({ tabId, logId, text })
    },
    [updateTab]
  )

  const updateAgentRun = useCallback(
    (tabId: string, updater: (run: AgentRunViewState) => AgentRunViewState): void => {
      const run = activeAgentRunRef.current.get(tabId)
      if (!run) return

      const nextRun = updater(run)
      activeAgentRunRef.current.set(tabId, nextRun)
      updateLogEntryText(tabId, nextRun.logId, formatAgentRunMarkdown(nextRun, t))
    },
    [t, updateLogEntryText]
  )

  const appendAgentEvent = useCallback(
    (event: AgentEvent, tabId = activeTabIdRef.current): void => {
      if (event.type === 'token' || event.type === 'done') return

      if (event.type === 'plan') {
        const detail = event.steps.length
          ? event.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
          : t.input.planUnavailable
        updateAgentRun(tabId, (run) => ({
          ...run,
          actions: [
            ...run.actions,
            {
              title: t.input.createdPlan,
              detail
            }
          ]
        }))
        return
      }

      if (event.type === 'command-review') {
        updateAgentRun(tabId, (run) => ({
          ...run,
          actions: [
            ...run.actions,
            {
              title: `${t.commandReview.title}: ${riskLabel(event.audit.risk, t)}`,
              detail: formatCommandAuditActionDetail(event.command, event.audit, t)
            }
          ]
        }))
        return
      }

      if (event.type === 'tool') {
        updateAgentRun(tabId, (run) => ({
          ...run,
          actions: [
            ...run.actions,
            {
              title: `${t.input.usedTool}: ${event.name}`,
              detail: localizeAgentEventMessage(event.message, t)
            }
          ]
        }))
        return
      }

      updateAgentRun(tabId, (run) => ({
        ...run,
        actions: [
          ...run.actions,
          {
            title: formatAgentEventActionTitle(event, t),
            detail: localizeAgentEventMessage(event.message, t)
          }
        ]
      }))
    },
    [t, updateAgentRun]
  )

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
            task.startedAt
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
            text:
              locale === 'zh-CN'
                ? 'SSH 需要 PTY 模式。当前终端是 PIPE 备用模式，请在 node-pty 可用后重启应用。'
                : 'SSH requires PTY mode. Current terminal is PIPE fallback; restart the app after node-pty is available.'
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

      if (includeSshCommand) {
        await runConnectionCommandSequence(commands, targetTabId, appendLog, t)
        return
      }

      await runConnectionLoginActionSequence(commands, targetTabId, appendLog, t)
    },
    [appendLog, locale, t, updateTab]
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
    void window.api.storage.saveTabs(
      tabs.map((tab) => ({
        tabId: tab.id,
        title: tab.title,
        connectionId: tab.connectionId,
        connectionName: tab.connectionName,
        isSsh: tab.isSsh,
        terminalCwd: tab.terminalCwd,
        terminalMode: tab.terminalMode
      }))
    )
  }, [tabs])

  useEffect(() => {
    localStorage.setItem('crescent.locale', locale)
  }, [locale])

  useEffect(() => {
    localStorage.setItem(
      CLOSE_TERMINAL_CONFIRM_STORAGE_KEY,
      closeTerminalConfirmEnabled ? 'true' : 'false'
    )
  }, [closeTerminalConfirmEnabled])

  useEffect(() => {
    if (terminalPage !== 'connections') return

    window.requestAnimationFrame(() => connectionSearchInputRef.current?.focus())
  }, [terminalPage])

  useEffect(() => {
    const handleConnectionShortcut = (event: globalThis.KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return

      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        showConnectionList()
        window.requestAnimationFrame(() => connectionSearchInputRef.current?.focus())
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

  const maybeRequestTerminalPassword = useCallback(
    (tabId: string, data: string): void => {
      const nextBuffer = `${passwordPromptBuffersRef.current.get(tabId) ?? ''}${data}`.slice(-4000)
      passwordPromptBuffersRef.current.set(tabId, nextBuffer)

      const promptLine = extractPasswordPromptLine(nextBuffer)
      if (!promptLine) return
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
    },
    []
  )

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
        const listWidth = 280
        const sheetChromeWidth = 62
        const maxWidth = Math.max(360, window.innerWidth - 48 - listWidth - sheetChromeWidth)
        const nextWidth = Math.max(
          360,
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
      const nextPercent = Math.max(35, Math.min(78, (event.clientX / width) * 100))
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
  }, [resizeSubterminalPair])

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
        setSettingsProviderId(firstProvider?.id ?? 'nova-litellm')
        setProviderModelsText(formatProviderModels(firstProvider?.models ?? []))
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
      theme: {
        background: '#111111',
        foreground: '#f5f5f5',
        cursor: '#ffffff',
        selectionBackground: '#3f3f46',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#38bdf8',
        magenta: '#d946ef',
        cyan: '#06b6d4',
        white: '#f4f4f5'
      }
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
      maybeRequestTerminalPassword(event.tabId, event.data)
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
    setSkillInstallingId(result.id)
    setSkillManageMessage({
      type: 'info',
      text: `${t.settings.skillInstalling}: ${result.name}`
    })
    try {
      const response = await window.api.agent.installSkill({
        installSource: result.installSource,
        installSkill: result.installSkill
      })
      setSkills(response.skills)
      setSkillManageMessage({
        type: 'success',
        text: [
          `${t.settings.skillInstalled}: ${result.name}`,
          response.fallbackInstalledAll && response.requestedSkill
            ? `${t.settings.skillFallbackInstalledAll}: ${response.requestedSkill}`
            : '',
          response.output
        ]
          .filter(Boolean)
          .join('\n\n')
      })
    } catch (error) {
      setSkillManageMessage({
        type: 'error',
        text: `${t.settings.skillInstallFailed}: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
    } finally {
      setSkillInstallingId(null)
    }
  }

  async function copySkillInstallCommand(result: AgentSkillSearchResult): Promise<void> {
    await copyText(buildSkillInstallCommand(result))
    setCopiedSkillCommandId(result.id)
    window.setTimeout(() => {
      setCopiedSkillCommandId((current) => (current === result.id ? null : current))
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

  async function saveAgentConfig(nextConfigInput: AgentConfig): Promise<AgentConfig> {
    const nextConfig = await window.api.agent.saveConfig(nextConfigInput)
    setConfig(nextConfig)
    setCommandWhitelistText(nextConfig.commandWhitelist.join('\n'))
    setModels(flattenProviderModels(nextConfig.providers))
    const nextSettingsProvider =
      nextConfig.providers.find((provider) => provider.id === settingsProviderId) ??
      nextConfig.providers[0]
    setSettingsProviderId(nextSettingsProvider?.id ?? 'nova-litellm')
    setProviderModelsText(formatProviderModels(nextSettingsProvider?.models ?? []))
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
      setWikiEditTitle(document.title)
      setWikiEditContent(document.content)
      setWikiEditing(false)
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

  async function openWikiDocument(document: WikiDocumentSummary): Promise<void> {
    setWikiDocumentLoadingId(document.id)
    setWikiEditing(false)
    setWikiMessage(null)
    try {
      const detail = (await window.api.agent.getWikiDocument(document.id)) ?? null
      setSelectedWikiDocument(detail)
      setWikiEditTitle(detail?.title ?? '')
      setWikiEditContent(detail?.content ?? '')
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
        title: wikiEditTitle,
        content: wikiEditContent
      })
      setSelectedWikiDocument(document)
      setWikiEditTitle(document.title)
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

  function applyModel(modelId: string): void {
    const modelProviderId =
      filteredModels.find((model) => model.id === modelId)?.providerId ?? activeProviderId

    updateTab(activeTab.id, (tab) => ({
      ...tab,
      providerId: modelProviderId,
      model: modelId
    }))
  }

  function applyProvider(providerId: string): void {
    const providerModels = visibleModels.filter((model) => model.providerId === providerId)
    if (!providerModels.length) return

    updateTab(activeTab.id, (tab) => ({
      ...tab,
      providerId,
      model:
        tab.model && providerModels.some((model) => model.id === tab.model)
          ? tab.model
          : providerModels[0].id
    }))
  }

  function stopAgentRun(tabId = activeTabIdRef.current): void {
    activeRunCanceledRef.current.add(tabId)
    const runId = activeRunIdRef.current.get(tabId)
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
    const rejectionReason = approved ? '' : commandRejectionReason.trim()
    setCommandApproval(null)
    setCommandRejectionReason('')
    void window.api.agent.resolveCommandApproval({ requestId, approved, rejectionReason })
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
        title: tab.connectionId || tab.isSsh ? tab.title : getNextTerminalTitle(connection.name, tabsRef.current),
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
    setTerminalPage('connections')
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
    const defaultTab = tabsRef.current.find((tab) => tab.id === 'default')
    const canUseDefaultTab =
      defaultTab &&
      !defaultTab.sessionId &&
      !defaultTab.terminalOutput &&
      defaultTab.agentLog.length === 0 &&
      !defaultTab.connectionId

    if (canUseDefaultTab) {
      setActiveTabId('default')
      return
    }

    const nextTab = createTerminalTab({
      title: getNextTerminalTitle('Local', tabsRef.current),
      providerId: config.providerId
    })

    setTabs((current) => [...current, nextTab])
    setActiveTabId(nextTab.id)
  }

  function openConnectionTerminal(connection: ConnectionConfig): void {
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
    if (terminalPage === 'connections') {
      openConnectionTerminal(connection)
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
        text: formatVisibleInputWithReferences(
          displayInput,
          skillRefs,
          pathRefs,
          toolRefs,
          wikiRefs,
          t
        )
      },
      tabId
    )
    updateTab(tabId, (current) => ({ ...current, agentThinking: true }))
    const terminalContext = await window.api.terminal.getContext(tabId)
    const shouldUseCurrentTerminal =
      terminalContext.mode !== 'none' &&
      hasUsableCurrentTerminal(tab, terminalContext.output) &&
      !isExplicitConnectionRequest(displayInput)
    const shouldResolveConnectionIntent =
      !resumeRequested && !tab?.isSsh && !tab?.connectionId && !shouldUseCurrentTerminal
    let connectionIntent: Awaited<ReturnType<typeof resolveConnectionIntentForInput>> | undefined
    try {
      connectionIntent = shouldResolveConnectionIntent
        ? await resolveConnectionIntentForInput(displayInput)
        : undefined
    } finally {
      updateTab(tabId, (current) => ({ ...current, agentThinking: false }))
    }
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
                    connectionIntent.analysis.reason
                  ]
                    .filter(Boolean)
                    .join('\n')
                }
              ],
              result: t.terminal.connectionIntentResult,
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
      startedAt
    )
  }

  async function runAgentConversation(
    input: string,
    tabId: string,
    connectionId?: string,
    displayInput = input,
    appendUserLog = true,
    startedAt = Date.now()
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
            actions: [{ title: t.input.startedRun, detail: t.input.terminalContext }]
          },
          t
        )
      },
      tabId
    )
    activeAgentRunRef.current.set(tabId, {
      logId: runLogId,
      actions: [{ title: t.input.startedRun, detail: t.input.terminalContext }],
      startedAt
    })

    try {
      await ensureTerminalReadyForAgent(tabId)
      const terminalContext = await getTerminalContextForAgent(tabId)
      const runTab = tabsRef.current.find((candidate) => candidate.id === tabId)
      const runModelSelection = resolveTabModelSelection(runTab, config, visibleModels)
      const result = await window.api.agent.run({
        runId,
        input,
        providerId: runModelSelection.providerId,
        model: runModelSelection.model,
        terminalContext,
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

  function insertSlashCommand(command: SlashCommandOption): void {
    const shouldOpenModeList = command.id === 'mode'
    const shouldOpenSkillList = command.id === 'skill'
    const shouldOpenConnectionList = command.id === 'connection'
    const shouldOpenToolList = command.id === 'tool'
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
      agentInput: replaceSlashCommandInput(tab.agentInput, command.skill ? '' : command.value),
      skillRefs: command.skill ? addUniqueSkillRef(tab.skillRefs, command.skill) : tab.skillRefs
    }))
    setSlashCommandIndex(0)
    setSlashCommandOpen(
      shouldOpenModeList ||
        shouldOpenSkillList ||
        shouldOpenConnectionList ||
        shouldOpenToolList ||
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

  function createProvider(): void {
    const id = `provider-${Date.now()}`
    const provider: AgentProviderConfig = {
      id,
      name: id,
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      models: [{ id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', reasoning: false }]
    }

    setConfig((current) => ({ ...current, providers: [...current.providers, provider] }))
    setSettingsProviderId(id)
    setProviderModelsText(formatProviderModels(provider.models))
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
    setSettingsProviderId(nextProvider?.id ?? 'nova-litellm')
    setProviderModelsText(formatProviderModels(nextProvider?.models ?? []))
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

    await copyText(JSON.stringify(value, null, 2))
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

  function requestCloseTabs(mode: CloseTabsConfirmRequest['mode'], tabId: string): void {
    setTabMenu(null)
    if (!closeTerminalConfirmEnabled) {
      if (mode === 'tab') performCloseTab(tabId)
      else performCloseOtherTabs(tabId)
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

  function confirmCloseTabs(): void {
    if (!closeTabsConfirmRequest) return

    const request = closeTabsConfirmRequest
    setCloseTabsConfirmRequest(null)
    if (request.dontAskAgain) setCloseTerminalConfirmEnabled(false)

    if (request.mode === 'tab') performCloseTab(request.tabId)
    else performCloseOtherTabs(request.tabId)
  }

  async function copyLogEntry(entry: AgentLogEntry): Promise<void> {
    const tabId = activeTabIdRef.current
    await copyText(entry.text)
    updateTab(tabId, (tab) => ({ ...tab, copiedLogId: entry.id }))
    window.setTimeout(() => {
      updateTab(tabId, (tab) => ({
        ...tab,
        copiedLogId: tab.copiedLogId === entry.id ? null : tab.copiedLogId
      }))
    }, 1200)
  }

  const historySheet = (
    <Sheet open={historyOpen} onOpenChange={setHistorySheetOpen}>
      <SheetContent side="left" className="w-[420px] sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>{t.history.title}</SheetTitle>
          <SheetDescription>{t.history.description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-4">
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
            historyItems.map((item) => (
              <div
                key={item.tabId}
                className="flex items-start gap-2 rounded-md border bg-card p-3 text-sm transition hover:border-primary/60 hover:bg-muted/30"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
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
                    {item.connectionName && <span className="truncate">· {item.connectionName}</span>}
                    <span className="shrink-0">
                      · {item.runCount} {t.history.runs}
                    </span>
                  </div>
                  {item.lastMessage && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {summarizeHistoryMessage(item.lastMessage)}
                    </p>
                  )}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0"
                  aria-label={`${t.wiki.saveFromHistory}: ${item.title}`}
                  title={`${t.wiki.saveFromHistory}: ${item.title}`}
                  disabled={savingHistoryWikiTabId === item.tabId}
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
                  onClick={() => void deleteHistorySession(item)}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>
            ))}
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
    <Sheet open={wikiOpen} onOpenChange={setWikiSheetOpen}>
      <SheetContent
        side="left"
        className="w-[var(--wiki-sheet-width)] max-w-[calc(100vw-3rem)] sm:max-w-[calc(100vw-3rem)]"
        style={
          {
            '--wiki-sheet-width': selectedWikiDocument
              ? `${280 + 12 + 32 + wikiPreviewWidth}px`
              : '420px',
            maxWidth: 'calc(100vw - 3rem)'
          } as React.CSSProperties
        }
      >
        <SheetHeader>
          <SheetTitle>{t.wiki.title}</SheetTitle>
          <SheetDescription>{t.wiki.description}</SheetDescription>
        </SheetHeader>
        <div
          className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-4"
          style={
            selectedWikiDocument
              ? { gridTemplateColumns: `280px minmax(360px, ${wikiPreviewWidth}px)` }
              : undefined
          }
        >
          <div className="flex min-h-0 flex-col gap-2">
            <Input
              value={wikiSearchQuery}
              onChange={(event) => setWikiSearchQuery(event.target.value)}
              placeholder={t.wiki.searchPlaceholder}
            />
            <div className="min-h-0 space-y-2 overflow-auto">
              {wikiLoading && (
                <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                  {t.wiki.loading}
                </div>
              )}
              {!wikiLoading && wikiDocuments.length === 0 && (
                <div className="rounded-md border p-3 text-sm text-muted-foreground">
                  {t.wiki.empty}
                </div>
              )}
              {!wikiLoading && wikiDocuments.length > 0 && filteredWikiDocuments.length === 0 && (
                <div className="rounded-md border p-3 text-sm text-muted-foreground">
                  {t.wiki.empty}
                </div>
              )}
              {filteredWikiDocuments.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  className={`block w-full min-w-0 overflow-hidden rounded-md border p-3 text-left text-xs transition hover:border-primary/60 hover:bg-muted/30 ${
                    selectedWikiDocument?.id === document.id
                      ? 'border-primary/70 ring-1 ring-primary/30'
                      : ''
                  }`}
                  onClick={() => void openWikiDocument(document)}
                >
                  <span className="block truncate font-medium">{document.title}</span>
                  <span className="mt-1 block truncate text-muted-foreground">
                    {formatHistoryTime(document.updatedAt)}
                  </span>
                  {document.excerpt && (
                    <span className="mt-2 line-clamp-2 block overflow-hidden break-words leading-snug text-muted-foreground">
                      {document.excerpt}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          {selectedWikiDocument && (
            <div className="relative min-h-0 overflow-auto rounded-md border bg-background">
              {wikiDocumentLoadingId === selectedWikiDocument.id ? (
                <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                  {t.wiki.loading}
                </div>
              ) : wikiEditing ? (
                <div className="space-y-4 p-5 text-sm">
                  <Field>
                    <FieldLabel htmlFor="wiki-edit-title">{t.wiki.titleLabel}</FieldLabel>
                    <Input
                      id="wiki-edit-title"
                      value={wikiEditTitle}
                      onChange={(event) => setWikiEditTitle(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="wiki-edit-content">{t.wiki.markdownSource}</FieldLabel>
                    <Textarea
                      id="wiki-edit-content"
                      className="min-h-[520px] resize-y font-mono text-xs"
                      value={wikiEditContent}
                      onChange={(event) => setWikiEditContent(event.target.value)}
                    />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setWikiEditing(false)
                        setWikiEditTitle(selectedWikiDocument.title)
                        setWikiEditContent(selectedWikiDocument.content)
                      }}
                      disabled={wikiSaving}
                    >
                      {t.wiki.cancelEdit}
                    </Button>
                    <Button type="button" onClick={saveWikiEdits} disabled={wikiSaving}>
                      {wikiSaving && (
                        <Loader2Icon className="animate-spin" data-icon="inline-start" />
                      )}
                      {t.wiki.saveEdit}
                    </Button>
                  </div>
                </div>
              ) : (
                <article className="mx-auto w-full max-w-4xl space-y-4 p-5 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold">{selectedWikiDocument.title}</h2>
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        {selectedWikiDocument.path}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setWikiEditTitle(selectedWikiDocument.title)
                        setWikiEditContent(selectedWikiDocument.content)
                        setWikiEditing(true)
                      }}
                    >
                      {t.wiki.edit}
                    </Button>
                  </div>
                  <MarkdownContent value={selectedWikiDocument.content} t={t} />
                </article>
              )}
              <div
                className="absolute inset-y-0 right-0 hidden w-2 cursor-col-resize hover:bg-primary/40 lg:block"
                role="separator"
                aria-orientation="vertical"
                aria-label={t.wiki.resize}
                title={t.wiki.resize}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  wikiSheetResizeRef.current = {
                    startX: event.clientX,
                    startWidth: wikiPreviewWidth
                  }
                  document.body.style.cursor = 'col-resize'
                  document.body.style.userSelect = 'none'
                }}
              />
            </div>
          )}
        </div>
        <SheetFooter className="gap-2 sm:justify-between">
          <SkillManageStatus message={wikiMessage} />
          <Button
            type="button"
            variant="outline"
            onClick={() => void refreshWikiDocuments()}
            disabled={wikiLoading}
          >
            {wikiLoading && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            {t.wiki.refresh}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )

  return (
    <main className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <ProductLogo />
          <span className="text-sm font-semibold">Crescent</span>
        </div>
        <div className="flex items-center gap-2">
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
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
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
            <SheetContent className="w-full sm:max-w-xl">
              <SheetHeader>
                <SheetTitle>{t.settings.title}</SheetTitle>
                <SheetDescription>{t.settings.titleDescription}</SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-auto px-4">
                <FieldGroup>
                  <Field>
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel htmlFor="provider">{t.settings.providerList}</FieldLabel>
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={createProvider}>
                          <PlusIcon data-icon="inline-start" />
                          {t.settings.newProvider}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={config.providers.length <= 1}
                          aria-label={t.settings.deleteProvider}
                          title={t.settings.deleteProvider}
                          onClick={deleteSettingsProvider}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <Select
                      value={settingsProvider.id}
                      onValueChange={selectSettingsProvider}
                    >
                      <SelectTrigger id="provider" className="w-full">
                        <SelectValue placeholder={t.settings.providerList} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>{t.settings.providerList}</SelectLabel>
                          {config.providers.map((provider) => (
                            <SelectItem key={provider.id} value={provider.id}>
                              {provider.name || provider.id}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <FieldLabel htmlFor="provider-id">{t.settings.providerId}</FieldLabel>
                      <Input
                        id="provider-id"
                        value={settingsProvider.id}
                        onChange={(event) => updateSettingsProvider('id', event.target.value)}
                        placeholder="nova-litellm"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="provider-name">{t.settings.providerName}</FieldLabel>
                      <Input
                        id="provider-name"
                        value={settingsProvider.name}
                        onChange={(event) => updateSettingsProvider('name', event.target.value)}
                        placeholder="Nova LiteLLM"
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="provider-base-url">{t.settings.baseUrl}</FieldLabel>
                    <Input
                      id="provider-base-url"
                      value={settingsProvider.baseUrl}
                      onChange={(event) => updateSettingsProvider('baseUrl', event.target.value)}
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
                      onChange={(event) => updateSettingsProvider('apiKey', event.target.value)}
                      placeholder="sk-... or leave blank when env key is available"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="provider-models">{t.settings.providerModels}</FieldLabel>
                    <Textarea
                      id="provider-models"
                      className="min-h-28 resize-y font-mono text-xs"
                      value={providerModelsText}
                      onChange={(event) => updateSettingsProviderModels(event.target.value)}
                      placeholder={'deepseek-v4-flash\ndeepseek-v4-pro'}
                    />
                    <FieldDescription>{t.settings.modelListHint}</FieldDescription>
                  </Field>
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
                    <FieldLabel>{t.settings.skillsManagement}</FieldLabel>
                    <FieldDescription>{t.settings.skillsManagementHint}</FieldDescription>
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
                      <div className="max-h-48 space-y-2 overflow-auto">
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
                              className="flex items-start justify-between gap-3 rounded-md border bg-background p-3 text-xs"
                            >
                              <div className="min-w-0 space-y-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="truncate font-medium">{skill.name}</span>
                                  {!skill.removable && (
                                    <Badge variant="outline">{t.settings.protectedSkill}</Badge>
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
                                onClick={() => void deleteSkill(skill)}
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
                      <Separator />
                      <div className="space-y-2">
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
                            placeholder="Browser"
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
                          <div className="max-h-64 space-y-2 overflow-auto">
                            {skillSearchResults.map((result) => (
                              <div
                                key={result.id}
                                className="flex items-start justify-between gap-3 rounded-md border bg-background p-3 text-xs"
                              >
                                <div className="min-w-0 space-y-1">
                                  <div className="truncate font-medium">{result.name}</div>
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
                                    disabled={skillInstallingId === result.id}
                                    onClick={() => void installSkill(result)}
                                  >
                                    {skillInstallingId === result.id ? (
                                      <Loader2Icon
                                        className="animate-spin"
                                        data-icon="inline-start"
                                      />
                                    ) : (
                                      <DownloadIcon data-icon="inline-start" />
                                    )}
                                    {t.settings.installSkill}
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <SkillManageStatus message={skillManageMessage} />
                      </div>
                    </div>
                  </Field>
                  <Separator />
                  <Field>
                    <FieldLabel htmlFor="instruction-file">
                      {t.settings.instructionFiles}
                    </FieldLabel>
                    <Select
                      value={selectedInstructionName}
                      onValueChange={(name) => {
                        setSelectedInstructionName(name)
                        setInstructionContent(
                          instructionFiles.find((file) => file.name === name)?.content ?? ''
                        )
                        setInstructionSaved(false)
                      }}
                    >
                      <SelectTrigger id="instruction-file" className="w-full">
                        <SelectValue placeholder={t.settings.instructionFiles} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>{t.settings.instructionFiles}</SelectLabel>
                          {instructionFiles.map((file) => (
                            <SelectItem key={file.name} value={file.name}>
                              {file.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {selectedInstructionFile?.path ?? '~/.crescent'}
                      {' · '}
                      {selectedInstructionFile?.exists
                        ? t.settings.instructionFileExists
                        : t.settings.instructionFileNew}
                    </FieldDescription>
                    <Textarea
                      className="min-h-56 resize-y font-mono text-xs"
                      value={instructionContent}
                      onChange={(event) => {
                        setInstructionContent(event.target.value)
                        setInstructionSaved(false)
                      }}
                      placeholder={t.settings.instructionFilePlaceholder}
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={saveInstructionFile}
                      >
                        {instructionSaved
                          ? t.settings.instructionFileSaved
                          : t.settings.saveInstructionFile}
                      </Button>
                    </div>
                  </Field>
                  <Separator />
                  <Field>
                    <FieldLabel htmlFor="open-api-base-url">{t.settings.openApiBaseUrl}</FieldLabel>
                    <Input
                      id="open-api-base-url"
                      value={config.openApiBaseUrl}
                      onChange={(event) => updateConfig('openApiBaseUrl', event.target.value)}
                      placeholder="https://api.example.com"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="open-api-document">{t.settings.document}</FieldLabel>
                    <Textarea
                      id="open-api-document"
                      className="min-h-48 resize-none font-mono text-xs"
                      value={config.openApiDocument}
                      onChange={(event) => updateConfig('openApiDocument', event.target.value)}
                      placeholder="https://api.example.com/openapi.json"
                    />
                  </Field>
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
      {historySheet}
      {wikiSheet}
      <section className="flex min-h-0 flex-1">
        {hiddenPane !== 'terminal' && (
          <div
            className="flex min-h-0 flex-col bg-[#111111]"
            style={{ width: hiddenPane === 'chat' ? '100%' : `${terminalPanePercent}%` }}
          >
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/10 bg-background px-2">
              {terminalTabs.map((tab) => {
                const selected = terminalPage === 'terminal' && tab.id === activeTabId

                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`inline-flex h-7 max-w-40 items-center gap-1.5 rounded-md border px-2 text-xs transition ${
                      selected
                        ? 'border-primary/70 bg-primary/15 text-foreground shadow-sm ring-1 ring-primary/40'
                        : 'border-transparent text-muted-foreground hover:border-white/10 hover:bg-muted/40 hover:text-foreground'
                    }`}
                    onClick={() => {
                      setActiveTabId(tab.id)
                      setTerminalPage('terminal')
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setTabMenu({ tabId: tab.id, x: event.clientX, y: event.clientY })
                    }}
                  >
                    <TerminalActivityDot active={tab.terminalReady} />
                    <span className="truncate">{tab.title}</span>
                  </button>
                )
              })}
              {terminalPage === 'connections' && (
                <button
                  type="button"
                  className="h-7 rounded bg-secondary px-2 text-xs text-secondary-foreground"
                >
                  {t.connections.connectionList}
                </button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t.connections.openConnectionList}
                title={t.connections.openConnectionList}
                onClick={showConnectionList}
              >
                <PlusIcon aria-hidden="true" />
              </Button>
              {tabMenu && (
                <div
                  className="fixed z-50 min-w-36 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-md"
                  style={{ left: tabMenu.x, top: tabMenu.y }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => closeTab(tabMenu.tabId)}
                  >
                    {t.common.closeTab}
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
                    onClick={() => closeOtherTabs(tabMenu.tabId)}
                  >
                    {t.common.closeOtherTabs}
                  </button>
                </div>
              )}
            </div>
            {terminalPage === 'terminal' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div ref={terminalHostRef} className="min-h-0 flex-1" />
                {activeTab.subTerminals.length > 0 && (
                  <div
                    className="shrink-0 border-t border-white/10 bg-background"
                    style={{ height: subterminalCollapsed ? undefined : subterminalPanelHeight }}
                  >
                    {!subterminalCollapsed && (
                      <div
                        className="h-1.5 cursor-row-resize bg-border/60 hover:bg-primary/60"
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label={t.terminal.resizeSubterminalHeight}
                        title={t.terminal.resizeSubterminalHeight}
                        onPointerDown={(event) => {
                          event.preventDefault()
                          event.currentTarget.setPointerCapture(event.pointerId)
                          subterminalHeightResizeRef.current = {
                            startY: event.clientY,
                            startHeight: subterminalPanelHeight
                          }
                          document.body.style.cursor = 'row-resize'
                          document.body.style.userSelect = 'none'
                        }}
                      />
                    )}
                    <div className="flex h-8 items-center justify-between gap-2 border-b px-2">
                      <div className="min-w-0 truncate text-xs font-medium">
                        {t.terminal.temporarySubterminal} · {activeTab.subTerminals.length}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={
                            subterminalCollapsed
                              ? t.terminal.expandSubterminals
                              : t.terminal.collapseSubterminals
                          }
                          title={
                            subterminalCollapsed
                              ? t.terminal.expandSubterminals
                              : t.terminal.collapseSubterminals
                          }
                          onClick={() => setSubterminalCollapsed((current) => !current)}
                        >
                          {subterminalCollapsed ? (
                            <ChevronUpIcon aria-hidden="true" />
                          ) : (
                            <ChevronDownIcon aria-hidden="true" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={t.terminal.closeAllSubterminals}
                          title={t.terminal.closeAllSubterminals}
                          onClick={() => closeAllSubterminals(activeTab.id)}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    {!subterminalCollapsed && (
                      <div className="h-[calc(100%-2.375rem)] overflow-auto p-2">
                        <div className="flex h-full min-w-full gap-0">
                          {activeTab.subTerminals.map((subterminal, index) => {
                            const widths = getSubterminalWidths(activeTab.subTerminals)
                            const width = widths[index]
                            const nextSubterminal = activeTab.subTerminals[index + 1]

                            return (
                              <div
                                key={subterminal.id}
                                className="flex min-w-0"
                                style={{ flexBasis: `${width}%`, flexGrow: 0, flexShrink: 0 }}
                              >
                                <section className="flex min-w-0 flex-1 flex-col rounded-md border bg-card text-xs">
                                  <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b px-2">
                                    <div className="min-w-0">
                                      <p className="truncate font-medium">
                                        {t.terminal.temporarySubterminal}: {subterminal.name}
                                      </p>
                                      {subterminal.cwd && (
                                        <p className="truncate text-[10px] text-muted-foreground">
                                          {subterminal.cwd}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                      <Badge
                                        variant={
                                          subterminal.status === 'active' ? 'secondary' : 'outline'
                                        }
                                      >
                                        {subterminal.status === 'active'
                                          ? t.terminal.subterminalActive
                                          : t.terminal.subterminalExited}
                                      </Badge>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                        aria-label={t.terminal.closeSubterminal}
                                        title={t.terminal.closeSubterminal}
                                        onClick={() =>
                                          closeSubterminal(activeTab.id, subterminal.id)
                                        }
                                      >
                                        <XIcon aria-hidden="true" />
                                      </Button>
                                    </div>
                                  </div>
                                  <pre className="min-h-0 flex-1 select-text overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                                    {subterminal.output || t.terminal.recentOutputEmpty}
                                  </pre>
                                </section>
                                {nextSubterminal && (
                                  <div
                                    className="mx-1 w-1.5 shrink-0 cursor-col-resize rounded bg-border hover:bg-primary/60"
                                    role="separator"
                                    aria-orientation="vertical"
                                    aria-label={t.terminal.resizeSubterminals}
                                    title={t.terminal.resizeSubterminals}
                                    onPointerDown={(event) => {
                                      event.preventDefault()
                                      event.currentTarget.setPointerCapture(event.pointerId)
                                      subterminalResizeRef.current = {
                                        tabId: activeTab.id,
                                        leftId: subterminal.id,
                                        rightId: nextSubterminal.id,
                                        startX: event.clientX,
                                        leftStart: width,
                                        rightStart: widths[index + 1]
                                      }
                                      document.body.style.cursor = 'col-resize'
                                      document.body.style.userSelect = 'none'
                                    }}
                                  />
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto bg-background p-4">
                <div className="mx-auto max-w-3xl space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">{t.connections.connectionList}</h2>
                      <p className="text-xs text-muted-foreground">
                        {t.connections.connectionListDescription}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConnectionModalOpen(true)}
                    >
                      <SettingsIcon data-icon="inline-start" />
                      {t.connections.manageConnections}
                    </Button>
                  </div>
                  <div className="relative">
                    <SearchIcon
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      ref={connectionSearchInputRef}
                      value={connectionSearchQuery}
                      onChange={(event) => setConnectionSearchQuery(event.target.value)}
                      placeholder={t.connections.searchPlaceholder}
                      className="h-9 pl-9 pr-9"
                    />
                    {connectionSearchQuery && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute right-1 top-1/2 -translate-y-1/2"
                        aria-label={t.common.close}
                        title={t.common.close}
                        onClick={() => setConnectionSearchQuery('')}
                      >
                        <XIcon aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {localTerminalMatchesSearch && (
                      <button
                        type="button"
                        className={`flex w-full items-center justify-between gap-3 rounded-md border bg-card p-3 text-left text-xs transition hover:border-primary/60 hover:bg-muted/30 ${
                          activeTabId === 'default'
                            ? 'border-primary/70 ring-1 ring-primary/30'
                            : ''
                        }`}
                        onClick={openLocalTerminal}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                            <TerminalIcon className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {t.connections.localTerminal}
                            </span>
                            <span className="block truncate text-muted-foreground">
                              {t.connections.defaultTerminal}
                            </span>
                          </span>
                        </span>
                        <Badge variant="outline">{t.app.workingDirectory}</Badge>
                      </button>
                    )}
                    {connections.length === 0 && !connectionSearchText ? (
                      <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                        {t.connections.noConnections}
                      </p>
                    ) : filteredConnections.length === 0 && !localTerminalMatchesSearch ? (
                      <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                        {t.connections.noSearchResults}
                      </p>
                    ) : (
                      filteredConnections.map((connection) => {
                        const connectionTab = tabs.find((tab) => tab.connectionId === connection.id)
                        const selected = connectionTab?.id === activeTabId

                        return (
                          <button
                            key={connection.id}
                            type="button"
                            className={`flex w-full items-center justify-between gap-3 rounded-md border bg-card p-3 text-left text-xs transition hover:border-primary/60 hover:bg-muted/30 ${
                              selected ? 'border-primary/70 ring-1 ring-primary/30' : ''
                            }`}
                            onClick={() => openConnectionTerminal(connection)}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                                <ServerIcon className="size-4" aria-hidden="true" />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate font-medium">
                                  {connection.name}
                                </span>
                                <span className="block truncate text-muted-foreground">
                                  {formatConnectionTarget(connection)}
                                </span>
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              {connectionTab && <Badge variant="secondary">{t.app.running}</Badge>}
                              <Badge variant="outline">
                                {connection.source === 'ssh-config'
                                  ? '~/.ssh/config'
                                  : t.connections.customConnectionName}
                              </Badge>
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {!hiddenPane && (
          <div
            className="w-1.5 shrink-0 cursor-col-resize border-x border-border bg-muted/30 hover:bg-primary/40"
            role="separator"
            aria-orientation="vertical"
            aria-label={
              locale === 'zh-CN' ? '调整终端和对话区域宽度' : 'Resize terminal and chat panes'
            }
            onPointerDown={(event) => {
              event.preventDefault()
              splitDragRef.current = true
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
            }}
          />
        )}
        {hiddenPane !== 'chat' && (
          <aside className="flex min-h-0 min-w-[360px] flex-1 flex-col bg-card">
            <div
              ref={agentLogRef}
              className="min-h-0 min-w-0 flex-1 space-y-2 overflow-auto p-4 text-sm"
            >
              {activeTab.agentLog.map((entry) => (
                <div
                  key={entry.id}
                  className={isConversationLog(entry.kind) ? `${logClassName(entry.kind)} min-w-0` : 'min-w-0'}
                >
                  {isConversationLog(entry.kind) ? (
                    <>
                      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="font-medium uppercase tracking-wide">
                            {logRoleLabel(entry.kind, t)}
                          </span>
                          <time dateTime={entry.createdAt}>{formatLogTime(entry.createdAt)}</time>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t.common.copy}
                          title={t.common.copy}
                          onClick={() => copyLogEntry(entry)}
                        >
                          {activeTab.copiedLogId === entry.id ? (
                            <CheckIcon aria-hidden="true" />
                          ) : (
                            <CopyIcon aria-hidden="true" />
                          )}
                        </Button>
                      </div>
                      <AgentLogContent entry={entry} t={t} />
                    </>
                  ) : (
                    <ActionLogRow entry={entry} t={t} />
                  )}
                </div>
              ))}
            </div>
            <div className="space-y-3 border-t p-4">
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
                      <PanelLeftOpenIcon aria-hidden="true" />
                    ) : (
                      <PanelLeftCloseIcon aria-hidden="true" />
                    )}
                  </Button>
                  <Select value={activeProviderId} onValueChange={applyProvider}>
                    <SelectTrigger className="h-8 min-w-0 flex-1">
                      <SelectValue aria-label={t.app.provider} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>{t.app.provider}</SelectLabel>
                        {providerOptions.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Select value={activeTabModelId} onValueChange={applyModel}>
                    <SelectTrigger className="h-8 min-w-0 flex-1">
                      <span className="sr-only">
                        <SelectValue aria-label={t.app.model} />
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <StatusDot state={aiState} />
                        <span className="truncate">{activeModel?.name ?? activeTabModelId}</span>
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>{t.app.model}</SelectLabel>
                        {(filteredModels.length ? filteredModels : visibleModels).map((model) => (
                          <SelectItem key={`${model.providerId}:${model.id}`} value={model.id}>
                            {model.name}
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
                <div className="relative rounded-lg border bg-background p-2 shadow-sm">
                  {slashMenuVisible && (
                    <div className="absolute bottom-full left-2 right-2 z-30 mb-2 overflow-hidden rounded-md border bg-popover text-xs text-popover-foreground shadow-lg">
                      <div className="border-b px-3 py-2 text-muted-foreground">
                        {t.input.slashCommandHint}
                      </div>
                      <div ref={slashCommandListRef} className="max-h-56 overflow-auto p-1">
                        {slashCommandOptions.map((command, index) => (
                          <button
                            key={command.id}
                            type="button"
                            data-slash-command-index={index}
                            className={`block w-full rounded px-2 py-2 text-left transition-colors ${
                              index === selectedSlashCommandIndex
                                ? 'bg-secondary text-secondary-foreground'
                                : 'hover:bg-muted/50'
                            }`}
                            onMouseDown={(event) => {
                              event.preventDefault()
                              insertSlashCommand(command)
                            }}
                          >
                            <span className="block font-medium">
                              {command.connection ||
                              command.agentMode ||
                              command.pathReferenceKind ||
                              command.toolRef ||
                              command.wikiDocument ||
                              command.wikiRef
                                ? command.title
                                : `/${command.id}`}
                            </span>
                            <span className="block text-muted-foreground">
                              {command.description}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {(activeTab.skillRefs.length > 0 ||
                    activeTab.pathRefs.length > 0 ||
                    activeTab.toolRefs.length > 0 ||
                    activeTab.wikiRefs.length > 0) && (
                    <div className="mb-2 flex flex-wrap gap-2 px-1">
                      {activeTab.wikiRefs.map((wiki) => (
                        <Badge
                          key={wiki.id}
                          variant="secondary"
                          className="max-w-full gap-1 rounded-md pr-1"
                          title={wiki.path}
                        >
                          <BookOpenIcon className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">
                            {t.input.referencedWiki}: {wiki.title}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="size-4 hover:bg-background/70"
                            aria-label={`${t.input.removeWikiRef}: ${wiki.title}`}
                            title={`${t.input.removeWikiRef}: ${wiki.title}`}
                            onClick={() => removeWikiRef(wiki.id)}
                          >
                            <XIcon aria-hidden="true" />
                          </Button>
                        </Badge>
                      ))}
                      {activeTab.toolRefs.map((tool) => (
                        <Badge
                          key={tool.id}
                          variant="secondary"
                          className="max-w-full gap-1 rounded-md pr-1"
                          title={tool.description}
                        >
                          <span className="truncate">
                            {t.input.referencedTool}: {tool.name}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="size-4 hover:bg-background/70"
                            aria-label={`${t.input.removeToolRef}: ${tool.name}`}
                            title={`${t.input.removeToolRef}: ${tool.name}`}
                            onClick={() => removeToolRef(tool.id)}
                          >
                            <XIcon aria-hidden="true" />
                          </Button>
                        </Badge>
                      ))}
                      {activeTab.skillRefs.map((skill) => (
                        <Badge
                          key={skill.id}
                          variant="secondary"
                          className="max-w-full gap-1 rounded-md pr-1"
                          title={[skill.name, skill.description, skill.path]
                            .filter(Boolean)
                            .join('\n')}
                        >
                          <span className="truncate">
                            {t.input.referencedSkill}: {skill.name}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="size-4 hover:bg-background/70"
                            aria-label={`${t.input.removeSkillRef}: ${skill.name}`}
                            title={`${t.input.removeSkillRef}: ${skill.name}`}
                            onClick={() => removeSkillRef(skill.id)}
                          >
                            <XIcon aria-hidden="true" />
                          </Button>
                        </Badge>
                      ))}
                      {activeTab.pathRefs.map((reference) => (
                        <Badge
                          key={reference.id}
                          variant="secondary"
                          className="max-w-full gap-1 rounded-md pr-1"
                          title={reference.path}
                        >
                          {reference.kind === 'directory' ? (
                            <FolderOpenIcon className="size-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <FileIcon className="size-3.5 shrink-0" aria-hidden="true" />
                          )}
                          <span className="truncate">
                            {reference.kind === 'directory'
                              ? t.input.referencedDirectory
                              : t.input.referencedFile}
                            : {reference.name}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="size-4 hover:bg-background/70"
                            aria-label={`${t.input.removePathRef}: ${reference.name}`}
                            title={`${t.input.removePathRef}: ${reference.name}`}
                            onClick={() => removePathRef(reference.id)}
                          >
                            <XIcon aria-hidden="true" />
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <Textarea
                    value={activeTab.agentInput}
                    onChange={(event) => {
                      setSlashCommandOpen(true)
                      setSlashCommandIndex(0)
                      updateTab(activeTab.id, (tab) => ({ ...tab, agentInput: event.target.value }))
                    }}
                    onKeyDown={handleAgentInputKeyDown}
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
      {connectionModalOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="connection-modal-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConnectionModalOpen(false)
          }}
        >
          <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
              <div>
                <h2 id="connection-modal-title" className="text-sm font-semibold">
                  {t.connections.sshConnections}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t.connections.sshConnectionsDescription}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConnectionModalOpen(false)}
              >
                {t.common.close}
              </Button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.9fr)_minmax(360px,1.1fr)] overflow-hidden">
              <div className="min-h-0 overflow-auto border-r p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    {t.connections.existing}
                  </h3>
                  <Badge variant="outline">{connections.length}</Badge>
                </div>
                <div className="space-y-2">
                  {connections.length === 0 ? (
                    <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                      {t.connections.noConnections}
                    </p>
                  ) : (
                    connections.map((connection) => (
                      <div
                        key={connection.id}
                        className={`rounded-md border bg-card p-3 text-xs transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md ${selectedConnectionId === connection.id ? 'border-primary/70 shadow-lg shadow-primary/10 ring-1 ring-primary/30' : ''}`}
                        onClick={() => {
                          if (connection.source === 'custom') selectConnection(connection)
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{connection.name}</p>
                            <p className="truncate text-muted-foreground">
                              {formatConnectionTarget(connection)}
                            </p>
                            <p className="truncate text-muted-foreground">
                              {connection.source === 'ssh-config'
                                ? '~/.ssh/config'
                                : connection.description || '~/.crescent/config.json'}
                            </p>
                            {connection.source === 'custom' && (
                              <p className="truncate text-muted-foreground">
                                {connection.sshOptions?.length || 0} {t.connections.sshOptionsCount}{' '}
                                · {connection.actions?.length || 0} {t.connections.actionsCount}
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation()
                              connectFromConnectionManager(connection)
                              setConnectionModalOpen(false)
                            }}
                          >
                            <ServerIcon data-icon="inline-start" />
                            {t.connections.connect}
                          </Button>
                        </div>
                        {connection.source === 'custom' && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                copyConnection(connection)
                              }}
                            >
                              <CopyIcon data-icon="inline-start" />
                              {t.common.copy}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                duplicateConnection(connection)
                              }}
                            >
                              {t.common.duplicate}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                editConnection(connection)
                              }}
                            >
                              {t.common.edit}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                deleteConnection(connection.id)
                              }}
                            >
                              {t.common.delete}
                            </Button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="min-h-0 overflow-auto p-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel>{t.connections.copiedConnection}</FieldLabel>
                    <Textarea
                      className="min-h-20 resize-y font-mono text-xs"
                      value={connectionImportText}
                      onChange={(event) => setConnectionImportText(event.target.value)}
                      placeholder={t.connections.copiedConnectionPlaceholder}
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={importConnectionFromText}
                        disabled={!connectionImportText.trim()}
                      >
                        {t.connections.importAsNew}
                      </Button>
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel>{t.connections.customConnectionName}</FieldLabel>
                    <Input
                      value={connectionForm.name}
                      onChange={(event) => updateConnectionForm('name', event.target.value)}
                      placeholder={t.connections.namePlaceholder}
                      disabled={!connectionEditing}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <FieldLabel>{t.connections.host}</FieldLabel>
                      <Input
                        value={connectionForm.host}
                        onChange={(event) => updateConnectionForm('host', event.target.value)}
                        placeholder="10.0.0.8"
                        disabled={!connectionEditing}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>{t.connections.port}</FieldLabel>
                      <Input
                        type="number"
                        value={connectionForm.port ?? 22}
                        onChange={(event) =>
                          updateConnectionForm('port', Number(event.target.value))
                        }
                        placeholder="22"
                        disabled={!connectionEditing}
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel>{t.connections.user}</FieldLabel>
                    <Input
                      value={connectionForm.user ?? ''}
                      onChange={(event) => updateConnectionForm('user', event.target.value)}
                      placeholder="root"
                      disabled={!connectionEditing}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>{t.connections.password}</FieldLabel>
                    <Input
                      type="password"
                      value={connectionForm.password ?? ''}
                      onChange={(event) => updateConnectionForm('password', event.target.value)}
                      placeholder={t.connections.passwordPlaceholder}
                      disabled={!connectionEditing}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>{t.connections.passwordEnvVar}</FieldLabel>
                    <Input
                      value={connectionForm.passwordEnvVar ?? ''}
                      onChange={(event) =>
                        updateConnectionForm('passwordEnvVar', event.target.value)
                      }
                      placeholder={t.connections.passwordEnvVarPlaceholder}
                      disabled={!connectionEditing}
                    />
                    <FieldDescription>{t.connections.passwordEnvVarDescription}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>{t.connections.identityFile}</FieldLabel>
                    <Input
                      value={connectionForm.identityFile ?? ''}
                      onChange={(event) => updateConnectionForm('identityFile', event.target.value)}
                      placeholder="~/.ssh/id_rsa"
                      disabled={!connectionEditing}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>{t.connections.sshOptions}</FieldLabel>
                    <Textarea
                      className="min-h-28 resize-y font-mono text-xs"
                      value={connectionSshOptionsText}
                      onChange={(event) => setConnectionSshOptionsText(event.target.value)}
                      disabled={!connectionEditing}
                      placeholder={
                        '-o HostKeyAlgorithms=+ssh-rsa\n-o PubkeyAcceptedAlgorithms=+ssh-rsa\n-t\n-o PreferredAuthentications=keyboard-interactive,password\n-o PubkeyAuthentication=no'
                      }
                    />
                    <FieldDescription>{t.connections.sshOptionsDescription}</FieldDescription>
                    {connectionCommandPreview && (
                      <pre className="overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs text-muted-foreground">
                        {connectionCommandPreview}
                      </pre>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel>{t.connections.loginActions}</FieldLabel>
                    <Textarea
                      className="min-h-32 resize-y font-mono text-xs"
                      value={connectionActionsText}
                      onChange={(event) => setConnectionActionsText(event.target.value)}
                      disabled={!connectionEditing}
                      placeholder={'your_password\ncd /srv/app\nkubectl get pods'}
                    />
                    <FieldDescription>{t.connections.loginActionsDescription}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>{t.connections.description}</FieldLabel>
                    <Input
                      value={connectionForm.description ?? ''}
                      onChange={(event) => updateConnectionForm('description', event.target.value)}
                      placeholder={t.connections.descriptionPlaceholder}
                      disabled={!connectionEditing}
                    />
                    <FieldDescription>
                      {connectionEditing ? t.connections.storedIn : t.connections.readOnlyHint}
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </div>
            </div>
            <div className="shrink-0 border-t px-4 py-3">
              <SkillManageStatus message={connectionSaveMessage} />
              <div className="mt-3 flex items-center justify-between gap-3">
                <Button type="button" variant="outline" onClick={resetConnectionForm}>
                  {t.common.new}
                </Button>
                <div className="flex items-center gap-2">
                  {!connectionEditing && connectionForm.id && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConnectionEditing(true)}
                    >
                      {t.common.edit}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => saveConnection(false)}
                    disabled={!connectionEditing || !connectionFormReady}
                  >
                    {t.common.save}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => saveConnection(true)}
                    disabled={!connectionEditing || !connectionFormReady}
                  >
                    <ServerIcon data-icon="inline-start" />
                    {t.common.saveAndConnect}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {closeTabsConfirmRequest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-tabs-confirm-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCloseTabsConfirmRequest(null)
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-lg border bg-background shadow-xl">
            <div className="flex items-start gap-3 border-b px-4 py-3">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0">
                <h2 id="close-tabs-confirm-title" className="text-sm font-semibold">
                  {t.confirm.closeTabsTitle}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {closeTabsConfirmRequest.mode === 'tab'
                    ? t.confirm.closeTab
                    : t.confirm.closeOtherTabs}
                </p>
              </div>
            </div>
            <div className="space-y-4 px-4 py-4">
              <label
                htmlFor="close-tabs-dont-ask"
                className="flex items-center gap-3 rounded-md border bg-muted/10 p-3 text-sm"
              >
                <Input
                  id="close-tabs-dont-ask"
                  type="checkbox"
                  checked={closeTabsConfirmRequest.dontAskAgain}
                  onChange={(event) =>
                    setCloseTabsConfirmRequest((current) =>
                      current ? { ...current, dontAskAgain: event.target.checked } : current
                    )
                  }
                  className="size-4 shrink-0 accent-primary"
                />
                <span>{t.confirm.dontAskAgain}</span>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCloseTabsConfirmRequest(null)}
              >
                {t.common.cancel}
              </Button>
              <Button type="button" variant="destructive" onClick={confirmCloseTabs}>
                {t.common.close}
              </Button>
            </div>
          </div>
        </div>
      )}
      {passwordPromptRequest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="password-prompt-title"
        >
          <form
            onSubmit={submitPasswordPrompt}
            className="w-full max-w-md overflow-hidden rounded-lg border bg-background shadow-xl"
          >
            <div className="border-b px-4 py-3">
              <h2 id="password-prompt-title" className="text-sm font-semibold">
                {t.terminal.passwordPromptTitle}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {passwordPromptRequest.title}
              </p>
            </div>
            <div className="space-y-4 px-4 py-4">
              <div className="rounded-md border bg-muted/20 px-3 py-2 font-mono text-xs text-muted-foreground">
                {passwordPromptRequest.prompt}
              </div>
              <Field>
                <FieldLabel htmlFor="terminal-password-input">
                  {t.terminal.passwordPromptLabel}
                </FieldLabel>
                <Input
                  id="terminal-password-input"
                  ref={passwordPromptInputRef}
                  type="password"
                  value={passwordPromptValue}
                  onChange={(event) => setPasswordPromptValue(event.target.value)}
                  autoComplete="current-password"
                />
                <FieldDescription>{t.terminal.passwordPromptDescription}</FieldDescription>
              </Field>
              {passwordPromptError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {passwordPromptError}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <Button type="button" variant="outline" onClick={cancelPasswordPrompt}>
                {t.common.cancel}
              </Button>
              <Button type="submit">{t.terminal.passwordPromptSubmit}</Button>
            </div>
          </form>
        </div>
      )}
      {commandApproval && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="command-review-title"
        >
          <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <TriangleAlertIcon className="size-4 text-destructive" aria-hidden="true" />
                  <h2 id="command-review-title" className="text-sm font-semibold">
                    {t.commandReview.title}
                  </h2>
                  <Badge variant={riskBadgeVariant(commandApproval.audit.risk)}>
                    {riskLabel(commandApproval.audit.risk, t)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.commandReview.description}
                  {commandApproval.tabId ? ` · Tab: ${commandApproval.tabId}` : ''}
                </p>
              </div>
            </div>
            <div className="select-text min-h-0 flex-1 space-y-4 overflow-auto p-4 text-sm">
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t.commandReview.command}
                </h3>
                <Textarea
                  readOnly
                  value={commandApproval.command}
                  className="min-h-24 max-h-64 resize-y bg-muted/30 font-mono text-xs"
                />
              </section>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t.commandReview.auditSummary}
                </h3>
                <p className="text-sm">{commandApproval.audit.summary}</p>
              </section>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t.commandReview.operationReason}
                </h3>
                <p className="text-sm">{commandApproval.audit.operationReason}</p>
              </section>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t.commandReview.riskPoints}
                </h3>
                <ul className="space-y-1 text-sm">
                  {commandApproval.audit.riskPoints.map((point, index) => (
                    <li key={`${point}-${index}`} className="rounded-md bg-muted/30 px-3 py-2">
                      {point}
                    </li>
                  ))}
                </ul>
              </section>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t.commandReview.impactAnalysis}
                </h3>
                <p className="text-sm">{commandApproval.audit.impactAnalysis}</p>
              </section>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t.commandReview.recommendation}
                </h3>
                <p className="text-sm">{commandApproval.audit.recommendation}</p>
              </section>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t.commandReview.rejectionReason}
                </h3>
                <Textarea
                  value={commandRejectionReason}
                  onChange={(event) => setCommandRejectionReason(event.target.value)}
                  placeholder={t.commandReview.rejectionReasonPlaceholder}
                  className="min-h-20 resize-y text-sm"
                />
              </section>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
              <Button type="button" variant="outline" onClick={() => resolveCommandApproval(false)}>
                {t.commandReview.reject}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => resolveCommandApproval(true)}
              >
                {t.commandReview.approve}
              </Button>
            </div>
          </div>
        </div>
      )}
      <footer className="flex h-9 shrink-0 items-center border-t px-4 text-xs text-muted-foreground">
        {terminalPage === 'connections' ? (
          <span className="inline-flex items-center gap-2">
            <StatusDot state="pending" />
            {t.connections.connectionList}
            <span className="text-muted-foreground/70">
              {connections.length} {t.connections.sshConnections}
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <StatusDot state={shellState} />
            {shellState === 'ready'
              ? `${t.app.shellReady} · ${activeTab.terminalMode.toUpperCase()}`
              : shellState === 'pending'
                ? t.app.shellStarting
                : t.app.shellStopped}
            <span className="text-muted-foreground/70">
              {t.app.workingDirectory}: {activeTab.terminalCwd || '...'}
            </span>
          </span>
        )}
      </footer>
    </main>
  )
}

function logClassName(kind: AgentLogEntry['kind']): string {
  const base = 'rounded-lg border p-3'

  switch (kind) {
    case 'user':
      return `${base} ml-8 border-border bg-muted/20`
    case 'assistant':
      return `${base} mr-8 border-border bg-background`
    case 'error':
      return `${base} border-destructive/40 bg-destructive/10 text-destructive`
    case 'tool':
      return `${base} border-amber-500/30 bg-amber-500/10`
    case 'command':
      return `${base} border-cyan-500/30 bg-cyan-500/10`
    case 'plan':
      return `${base} border-purple-500/30 bg-purple-500/10`
    default:
      return `${base} bg-muted/40 text-muted-foreground`
  }
}

function isConversationLog(kind: AgentLogEntry['kind']): boolean {
  return kind === 'user' || kind === 'assistant' || kind === 'error'
}

function ActionLogRow({ entry, t }: { entry: AgentLogEntry; t: Dictionary }): React.JSX.Element {
  const summary = summarizeBehaviorLog(entry.text, entry.kind, t)

  return (
    <details className={`group rounded-md border text-xs ${actionLogClassName(entry.kind)}`}>
      <summary className="grid cursor-pointer select-none grid-cols-[5.5rem_4.75rem_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 marker:text-muted-foreground">
        <span className="truncate font-medium uppercase tracking-wide">
          {logRoleLabel(entry.kind, t)}
        </span>
        <time className="text-muted-foreground" dateTime={entry.createdAt}>
          {formatLogTime(entry.createdAt)}
        </time>
        <span className="truncate text-foreground/90">{summary}</span>
      </summary>
      <pre className="select-text max-h-72 min-w-0 overflow-auto border-t bg-background/70 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
        {entry.text}
      </pre>
    </details>
  )
}

function SkillManageStatus({
  message
}: {
  message: SkillManageMessage | null
}): React.JSX.Element | null {
  if (!message) return null

  const className =
    message.type === 'success'
      ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
      : message.type === 'error'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'

  return (
    <pre
      className={`select-text max-h-32 overflow-auto rounded-md border p-2 text-xs leading-relaxed whitespace-pre-wrap ${className}`}
    >
      {message.text}
    </pre>
  )
}

function AgentLogContent({ entry, t }: { entry: AgentLogEntry; t: Dictionary }): React.JSX.Element {
  if (isConversationLog(entry.kind)) return <MarkdownContent value={entry.text} t={t} />

  const summary = summarizeBehaviorLog(entry.text, entry.kind, t)

  return (
    <details className="group rounded-md border bg-background/60">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium marker:text-muted-foreground">
        {summary}
      </summary>
      <pre className="select-text max-h-80 min-w-0 overflow-auto border-t p-3 text-xs leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
        {entry.text}
      </pre>
    </details>
  )
}

function actionLogClassName(kind: AgentLogEntry['kind']): string {
  switch (kind) {
    case 'tool':
      return 'border-amber-500/25 bg-amber-500/5'
    case 'command':
      return 'border-cyan-500/25 bg-cyan-500/5'
    case 'plan':
      return 'border-purple-500/25 bg-purple-500/5'
    case 'thought':
      return 'border-blue-500/25 bg-blue-500/5'
    default:
      return 'border-border bg-muted/20'
  }
}

function summarizeBehaviorLog(value: string, kind: AgentLogEntry['kind'], t: Dictionary): string {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  if (kind === 'command') {
    if (!firstLine) return t.terminal.commandExecuted
    if (firstLine.startsWith(`${t.terminal.commandExecuted}:`)) return t.terminal.commandExecuted
    if (firstLine.startsWith(`${t.terminal.connectionAction} `)) {
      return firstLine.split(':')[0] || t.terminal.connectionAction
    }
    return firstLine
  }

  return firstLine || t.input.actionDetails
}

function isContinueIntent(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[。.!！?？\s]+$/g, '')
    .replace(/\s+/g, ' ')

  return (
    /^(继续|继续处理|继续执行|继续未完成的工作|接着来|接着处理|接着执行|恢复|恢复继续|继续刚才的任务)$/.test(
      normalized
    ) || /^(continue|resume|keep going|go on|continue working|continue the task)$/.test(normalized)
  )
}

function isExplicitConnectionRequest(value: string): boolean {
  return /(^|\s)(ssh|login|connect)\b|登录|登陆|连接|进入.*机器|切换.*连接|打开.*终端/i.test(
    value
  )
}

function hasUsableCurrentTerminal(tab: AgentTerminalTab | undefined, output: string): boolean {
  if (tab?.isSsh || tab?.connectionId) return true
  if (tab && tab.id !== 'default' && tab.title !== 'Local') return true

  const normalized = normalizeTerminalControlText(output).trim()
  if (!normalized) return false

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20)
  if (lines.length === 0) return false

  return lines.some(
    (line) =>
      !/^\[Crescent\]/.test(line) &&
      !/^(__CRESCENT_CMD_START_|__CRESCENT_CMD_END_)/.test(line)
  )
}

function buildResumeAgentInput(tab: AgentTerminalTab, latestInput: string, t: Dictionary): string {
  const previousUserEntry = [...tab.agentLog].reverse().find((entry) => entry.kind === 'user')
  const recentContext = tab.agentLog
    .slice(-10)
    .map((entry) => formatResumeContextEntry(entry, t))
    .filter(Boolean)
    .join('\n\n')

  return [
    t.input.resumeInstruction,
    previousUserEntry ? `${t.input.resumePreviousGoal}\n${previousUserEntry.text}` : '',
    `${t.input.resumeLatestInput}\n${latestInput}`,
    recentContext ? `${t.input.resumeRecentContext}\n${recentContext}` : t.input.resumeNoContext
  ]
    .filter(Boolean)
    .join('\n\n')
}

function formatResumeContextEntry(entry: AgentLogEntry, t: Dictionary): string {
  const role = logRoleLabel(entry.kind, t)
  const text = entry.text.trim()
  if (!text) return ''

  return `[${role}] ${text.slice(-1800)}`
}

function StatusDot({ state }: { state: 'ready' | 'pending' | 'not-ready' }): React.JSX.Element {
  const className =
    state === 'ready'
      ? 'bg-green-500 shadow-green-500/40'
      : state === 'pending'
        ? 'bg-yellow-400 shadow-yellow-400/40'
        : 'bg-red-500 shadow-red-500/40'

  return <span className={`size-2 rounded-full shadow-[0_0_8px] ${className}`} />
}

function TerminalActivityDot({ active }: { active: boolean }): React.JSX.Element {
  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${
        active ? 'bg-green-500 shadow-[0_0_8px] shadow-green-500/50' : 'bg-muted-foreground/30'
      }`}
      aria-hidden="true"
    />
  )
}

function logRoleLabel(kind: AgentLogEntry['kind'], t: Dictionary): string {
  switch (kind) {
    case 'user':
      return t.roles.user
    case 'assistant':
      return t.roles.assistant
    case 'error':
      return t.roles.error
    case 'tool':
      return t.roles.tool
    case 'command':
      return t.roles.command
    case 'plan':
      return t.roles.plan
    case 'thought':
      return t.roles.thought
    default:
      return t.roles.system
  }
}

function formatLogTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

function formatHistoryTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
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

function hydrateStoredAgentLog(entry: StoredAgentLogEntry): AgentLogEntry {
  return {
    id: entry.logId,
    kind: normalizeStoredAgentLogKind(entry.kind),
    text: entry.text,
    createdAt: entry.createdAt
  }
}

function normalizeStoredAgentLogKind(kind: string): AgentLogEntry['kind'] {
  if (
    kind === 'user' ||
    kind === 'assistant' ||
    kind === 'error' ||
    kind === 'status' ||
    kind === 'thought' ||
    kind === 'tool' ||
    kind === 'plan' ||
    kind === 'command'
  ) {
    return kind
  }

  return 'status'
}

function riskLabel(risk: CommandRiskLevel, t: Dictionary): string {
  switch (risk) {
    case 'low':
      return t.commandReview.lowRisk
    case 'medium':
      return t.commandReview.mediumRisk
    case 'high':
      return t.commandReview.highRisk
  }
}

function riskBadgeVariant(risk: CommandRiskLevel): 'outline' | 'secondary' | 'destructive' {
  if (risk === 'high') return 'destructive'
  if (risk === 'medium') return 'secondary'
  return 'outline'
}

function formatCommandAuditDetail(
  command: string,
  audit: CommandApprovalRequest['audit'],
  t: Dictionary
): string {
  return [
    `${t.commandReview.command}:`,
    command,
    '',
    `${t.commandReview.auditSummary}:`,
    audit.summary,
    '',
    `${t.commandReview.operationReason}:`,
    audit.operationReason,
    '',
    `${t.commandReview.riskLevel}: ${riskLabel(audit.risk, t)}`,
    '',
    `${t.commandReview.riskPoints}:`,
    ...audit.riskPoints.map((point) => `- ${point}`),
    '',
    `${t.commandReview.impactAnalysis}:`,
    audit.impactAnalysis,
    '',
    `${t.commandReview.recommendation}:`,
    audit.recommendation
  ].join('\n')
}

function formatCommandAuditActionDetail(
  command: string,
  audit: CommandApprovalRequest['audit'],
  t: Dictionary
): string {
  if (audit.risk === 'low' && !audit.requiresApproval) {
    return [
      `${t.commandReview.command}:`,
      command,
      '',
      `${t.commandReview.auditSummary}:`,
      audit.summary,
      '',
      `${t.commandReview.operationReason}:`,
      audit.operationReason
    ].join('\n')
  }

  return formatCommandAuditDetail(command, audit, t)
}

function formatAgentEventActionTitle(
  event: Exclude<AgentEvent, { type: 'token' | 'done' }>,
  t: Dictionary
): string {
  switch (event.type) {
    case 'status':
      return localizeAgentEventMessage(event.message, t)
    case 'thought':
      return localizeAgentEventMessage(event.message, t)
    case 'error':
      return `${t.input.error}: ${localizeAgentEventMessage(event.message, t)}`
    default:
      return t.input.genericAction
  }
}

function localizeAgentEventMessage(message: string, t: Dictionary): string {
  if (message === 'Dispatching tool call.') return t.input.toolDispatching
  if (message.startsWith('Submitting command for review:')) {
    return `${t.commandReview.submitted}:\n${message.slice('Submitting command for review:'.length).trim()}`
  }
  const subterminalCommand = message.match(
    /^Submitting command in temporary sub-terminal "([^"]+)":\s*([\s\S]+)$/
  )
  if (subterminalCommand) {
    return `${t.commandReview.submitted} (${subterminalCommand[1]}):\n${subterminalCommand[2].trim()}`
  }
  if (message === 'Command audit classified this as read-only inspection.') {
    return t.commandReview.readOnlyAllowed
  }
  if (message === 'Command review subprocess is analyzing risk.') return t.commandReview.analyzing
  if (message.startsWith('Command matched whitelist:')) return t.commandReview.whitelisted
  if (message === 'Command approved by user.') return t.commandReview.approved
  if (message === 'Command rejected by user.') return t.commandReview.rejected
  if (message === 'Running in chat-only terminal assistant mode.') return t.input.currentTerminal
  if (message === 'Done.') return t.input.done
  if (message === 'Agent run canceled.') return t.input.agentCanceled
  if (message === 'Planning before execution...') return t.input.createdPlan
  if (/^Selected \d+ active tools:/.test(message)) return t.input.toolsConfigured
  if (/^Executing plan with ReAct step /.test(message)) return t.input.executingPlanStep
  if (/^Reasoning and acting step /.test(message)) return t.input.reasoningNextStep
  if (message === 'Analyzing tool results and preparing the next action...') {
    return t.input.analyzingNextAction
  }
  if (message === 'Analyzing tool results and preparing the final answer...') {
    return t.input.synthesizingResult
  }

  return message
}

function formatAgentRunMarkdown(run: AgentRunViewState, t: Dictionary): string {
  const lines: string[] = []

  if (run.actions.length > 0) {
    lines.push(`**${t.input.actions}**`, '')
    for (const action of run.actions) {
      lines.push(`- ${action.title}`)
    }
    lines.push('', '<details>', `<summary>${t.input.actionDetails}</summary>`, '')
    for (const [index, action] of run.actions.entries()) {
      lines.push(`#### ${index + 1}. ${action.title}`, '', '```text', action.detail, '```', '')
    }
    lines.push('</details>')
  }

  if (run.result) {
    lines.push('', `**${t.input.result}**`, '', run.result)
  }

  if (run.error) {
    lines.push('', `**${t.input.error}**`, '', run.error)
  }

  if (typeof run.elapsedMs === 'number') {
    lines.push('', formatElapsedFooter(run.elapsedMs, t))
  }

  return lines.join('\n').trim()
}

function appendElapsedFooter(text: string, elapsedMs: number, t: Dictionary): string {
  return [text.trim(), formatElapsedFooter(elapsedMs, t)].filter(Boolean).join('\n\n')
}

function formatElapsedFooter(elapsedMs: number, t: Dictionary): string {
  return ['---', '', `${t.input.elapsed}: ${formatElapsedDuration(elapsedMs)}`].join('\n')
}

function formatElapsedDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatConnectionTarget(connection: ConnectionConfig): string {
  const user = connection.user ? `${connection.user}@` : ''
  const port = connection.port ? `:${connection.port}` : ''

  return `${user}${connection.host}${port}`
}

function matchesConnectionSearch(connection: ConnectionConfig, query: string): boolean {
  return [
    connection.name,
    connection.host,
    connection.user ?? '',
    connection.description ?? '',
    connection.source,
    formatConnectionTarget(connection)
  ].some((value) => value.toLowerCase().includes(query))
}

function parseSubterminalTabId(tabId: string): { parentTabId: string; name: string } | undefined {
  const marker = '::subterminal::'
  const markerIndex = tabId.indexOf(marker)

  if (markerIndex === -1) return undefined

  const parentTabId = tabId.slice(0, markerIndex)
  const encodedName = tabId.slice(markerIndex + marker.length)

  try {
    return {
      parentTabId,
      name: decodeURIComponent(encodedName)
    }
  } catch {
    return {
      parentTabId,
      name: encodedName
    }
  }
}

function getSubterminalWidths(subterminals: TemporarySubterminal[]): number[] {
  if (subterminals.length === 0) return []
  if (subterminals.length === 1) return [100]

  const defaultWidth = 100 / subterminals.length
  const widths = subterminals.map((subterminal) => subterminal.widthPercent ?? defaultWidth)
  const total = widths.reduce((sum, width) => sum + width, 0)

  if (total <= 0) return subterminals.map(() => defaultWidth)

  return widths.map((width) => (width / total) * 100)
}

function formatReadableSubterminalOutput(raw: string): string {
  const plain = normalizeTerminalControlText(raw)
  const commandOutput = extractLatestCrescentCommandOutput(plain)
  const source = commandOutput ?? plain
  const lines = source
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !isSubterminalDisplayNoise(line))

  return collapseBlankLines(lines).join('\n').trim()
}

function normalizeTerminalControlText(value: string): string {
  const withoutControls = applyBackspaces(stripTerminalControlSequences(value))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

  return removeControlCharacters(withoutControls)
}

function stripTerminalControlSequences(value: string): string {
  let output = ''

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code !== 27) {
      output += value[index]
      continue
    }

    const next = value[index + 1]
    if (next === ']') {
      index += 2
      while (index < value.length) {
        if (value.charCodeAt(index) === 7) break
        if (value.charCodeAt(index) === 27 && value[index + 1] === '\\') {
          index += 1
          break
        }
        index += 1
      }
      continue
    }

    if (next === '[') {
      index += 1
      while (index + 1 < value.length) {
        index += 1
        const finalCode = value.charCodeAt(index)
        if (finalCode >= 64 && finalCode <= 126) break
      }
      continue
    }

    if (next === '(' || next === ')') {
      index += 2
      continue
    }

    if (next === '=' || next === '>') {
      index += 1
      continue
    }

    index += 1
  }

  return output
}

function applyBackspaces(value: string): string {
  let output = ''

  for (const char of value) {
    if (char === '\b') {
      output = output.slice(0, -1)
      continue
    }
    output += char
  }

  return output
}

function removeControlCharacters(value: string): string {
  let output = ''

  for (const char of value) {
    const code = char.charCodeAt(0)
    if (char === '\n' || char === '\t' || code >= 32) output += char
  }

  return output
}

function extractLatestCrescentCommandOutput(value: string): string | undefined {
  const startMatches = [...value.matchAll(/__CRESCENT_CMD_START_[A-Za-z0-9_]+__/g)]
  const latestStart = startMatches.at(-1)
  if (latestStart?.index === undefined) return undefined

  const startIndex = latestStart.index + latestStart[0].length
  const rest = value.slice(startIndex)
  const endMatch = rest.match(/__CRESCENT_CMD_END_[A-Za-z0-9_]+__:\d+/)
  if (endMatch?.index === undefined) return rest

  return rest.slice(0, endMatch.index)
}

function isSubterminalDisplayNoise(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false

  return (
    trimmed === '%' ||
    /^➜\s+/.test(trimmed) ||
    /^stty\s+-?echo(?:\s+2>\/dev\/null)?$/.test(trimmed) ||
    trimmed.includes('__crescent_script=$(mktemp') ||
    trimmed.includes('$__crescent_script') ||
    trimmed.includes('__crescent_status=') ||
    trimmed.includes('__CRESCENT_CMD_START_') ||
    trimmed.includes('__CRESCENT_CMD_END_') ||
    /printf\s+%s\s+'[A-Za-z0-9+/=]{80,}'/.test(trimmed) ||
    /base64\s+-[dD]\s+>/.test(trimmed) ||
    /^[A-Za-z0-9+/=]{100,}$/.test(trimmed)
  )
}

function collapseBlankLines(lines: string[]): string[] {
  const result: string[] = []

  for (const line of lines) {
    if (!line.trim() && !result.at(-1)?.trim()) continue
    result.push(line)
  }

  return result
}

function mergeConnectionInput(
  saved: ConnectionConfig | undefined,
  fallback: ConnectionConfig
): ConnectionConfig {
  return {
    ...fallback,
    ...saved,
    password: saved?.password ?? fallback.password,
    passwordEnvVar: saved?.passwordEnvVar ?? fallback.passwordEnvVar,
    resolvedPassword: saved?.resolvedPassword ?? fallback.resolvedPassword,
    sshOptions: saved?.sshOptions?.length ? saved.sshOptions : fallback.sshOptions,
    actions: saved?.actions?.length ? saved.actions : fallback.actions
  }
}

function parseSshOptions(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/\s*\\$/, '')
        .trim()
    )
    .filter(Boolean)
}

function parseLoginActions(value: string): string[] {
  return value.split(/\r?\n/).filter((line) => line.trim())
}

function parseProviderModels(value: string): AgentProviderModelConfig[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((id) => ({
      id,
      name: id,
      reasoning: isReasoningModelId(id)
    }))
}

function formatProviderModels(models: AgentProviderModelConfig[]): string {
  return models.map((model) => model.id).join('\n')
}

function isReasoningModelId(id: string): boolean {
  const normalized = id.toLowerCase()
  return normalized.includes('gpt-5') || normalized.includes('reasoner') || normalized.endsWith('-pro')
}

function parseCommandWhitelist(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function filterLocalSkills(skills: AgentSkillOption[], query: string): AgentSkillOption[] {
  const normalizedQuery = normalizeSkillSearchQuery(query)
  if (!normalizedQuery) return skills

  return skills.filter((skill) =>
    normalizeSkillSearchQuery([skill.name, skill.description].filter(Boolean).join(' ')).includes(
      normalizedQuery
    )
  )
}

function normalizeSkillSearchQuery(value: string): string {
  return value.toLowerCase().replace(/[\s"'`。，、,.:：;；/\\|()[\]{}_-]+/g, '')
}

function buildSkillInstallCommand(result: AgentSkillSearchResult): string {
  return [
    'npx',
    '-y',
    'skills',
    'add',
    shellQuote(result.installSource),
    '--yes',
    '--global',
    result.installSkill ? `--skill ${shellQuote(result.installSkill)}` : ''
  ]
    .filter(Boolean)
    .join(' ')
}

function flattenProviderModels(providers: AgentProviderConfig[]): AgentModelOption[] {
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      providerId: provider.id,
      providerName: provider.name || provider.id,
      reasoning: Boolean(model.reasoning)
    }))
  )
}

function resolveTabModelSelection(
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

function buildAvailableToolRefs(
  validation: AgentValidationResult | undefined
): AgentToolReference[] {
  const builtInToolNames = new Set(BUILT_IN_TOOL_CATALOG.map((tool) => tool.name))
  const builtInTools: AgentToolReference[] = BUILT_IN_TOOL_CATALOG.map((tool) => ({
    id: `built-in:${tool.name}`,
    name: tool.name,
    description: `${tool.method.toUpperCase()} ${tool.path} - ${tool.description}`,
    source: 'built-in'
  }))

  const dynamicTools =
    validation?.tools
      ?.filter((tool) => !builtInToolNames.has(tool.name))
      .map((tool) => ({
        id: `openapi:${tool.name}`,
        name: tool.name,
        description: `${tool.method.toUpperCase()} ${tool.path} - ${tool.description}`,
        source: 'openapi' as const
      })) ?? []

  const tools = new Map<string, AgentToolReference>()
  for (const tool of [...builtInTools, ...dynamicTools]) {
    tools.set(tool.id, tool)
  }

  return [...tools.values()]
}

function getSlashCommandQuery(value: string): string | undefined {
  if (!value.startsWith('/') || value.includes('\n')) return undefined

  return value.slice(1).trim().toLowerCase()
}

function matchesSlashCommand(command: SlashCommandOption, query: string | undefined): boolean {
  if (query === undefined) return false
  if (!query) return true

  const searchable = [command.id, command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(query)
}

function matchesSkillSlashCommand(command: SlashCommandOption, query: string): boolean {
  const skillQuery = query.slice('skill:'.length).trim()
  if (!skillQuery) return true

  const searchable = [command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(skillQuery)
}

function isToolSlashQuery(query: string | undefined): boolean {
  if (query === undefined) return false
  return query.startsWith('tool:')
}

function matchesToolSlashCommand(command: SlashCommandOption, query: string): boolean {
  const toolQuery = query
    .replace(/^tool:?/, '')
    .trim()
    .toLowerCase()
  if (!toolQuery) return true

  const searchable = [command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(toolQuery)
}

function isWikiSlashQuery(query: string | undefined): boolean {
  if (query === undefined) return false
  return query.startsWith('wiki:')
}

function matchesWikiSlashCommand(command: SlashCommandOption, query: string): boolean {
  const wikiQuery = query
    .replace(/^wiki:?/, '')
    .trim()
    .toLowerCase()
  if (!wikiQuery) return true

  const searchable = [command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(wikiQuery)
}

function isModeSlashQuery(query: string | undefined): boolean {
  if (query === undefined) return false
  return query.startsWith('mode:')
}

function matchesModeSlashCommand(command: SlashCommandOption, query: string): boolean {
  const modeQuery = query
    .replace(/^mode:?/, '')
    .trim()
    .toLowerCase()
  if (!modeQuery) return true

  const searchable = [command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(modeQuery)
}

function isConnectionSlashQuery(query: string | undefined): boolean {
  if (query === undefined) return false
  return query.startsWith('connection:')
}

function matchesConnectionSlashCommand(command: SlashCommandOption, query: string): boolean {
  const connectionQuery = query
    .replace(/^connection:?/, '')
    .trim()
    .toLowerCase()
  if (!connectionQuery) return true

  const searchable = [command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(connectionQuery)
}

function replaceSlashCommandInput(value: string, replacement: string): string {
  if (!value.startsWith('/')) return `${replacement}\n${value}`.trim()

  return `${replacement}\n${value.replace(/^\/[^\n]*/, '').replace(/^\n/, '')}`.trim()
}

function buildSlashCommandOptions(t: Dictionary): SlashCommandOption[] {
  return [
    {
      id: 'mode',
      title: t.input.slashMode,
      description: t.input.slashModeDescription,
      value: '/mode:',
      keywords: ['mode', 'agent', 'react', 'plan', '模式', '对话模式']
    },
    {
      id: 'connection',
      title: t.input.slashConnection,
      description: t.input.slashConnectionDescription,
      value: '/connection:',
      keywords: ['connection', 'ssh', 'host', '连接', '主机']
    },
    {
      id: 'file',
      title: t.input.referenceFile,
      description: t.input.slashFileDescription,
      value: '',
      keywords: ['file', 'reference', 'context', '文件', '引用'],
      pathReferenceKind: 'file'
    },
    {
      id: 'folder',
      title: t.input.referenceDirectory,
      description: t.input.slashFolderDescription,
      value: '',
      keywords: ['folder', 'directory', 'reference', 'context', '文件夹', '目录', '引用'],
      pathReferenceKind: 'directory'
    },
    {
      id: 'tool',
      title: t.input.slashTool,
      description: t.input.slashToolDescription,
      value: '/tool:',
      keywords: ['tool', 'tools', '工具']
    },
    {
      id: 'wiki',
      title: t.input.slashWiki,
      description: t.input.slashWikiDescription,
      value: '/wiki:',
      keywords: ['wiki', 'knowledge', 'sop', '知识库', '最佳实践']
    },
    {
      id: 'skill',
      title: t.input.slashSkill,
      description: t.input.slashSkillDescription,
      value: '/skill:',
      keywords: ['skill', 'skills', '技能']
    }
  ]
}

function buildSkillSlashCommand(skill: AgentSkillOption, t: Dictionary): SlashCommandOption {
  return {
    id: `skill:${skill.name}`,
    title: skill.name,
    description: skill.description || t.input.slashSkillDescription,
    value: '',
    keywords: ['skill', 'skills', skill.name, skill.description, skill.source],
    skill
  }
}

function buildToolSlashCommand(tool: AgentToolReference): SlashCommandOption {
  return {
    id: `tool:${tool.name}`,
    title: tool.name,
    description: tool.description,
    value: '',
    keywords: ['tool', 'tools', tool.name, tool.description, tool.source],
    toolRef: tool
  }
}

function buildWikiSlashCommand(document: WikiDocumentSummary, t: Dictionary): SlashCommandOption {
  return {
    id: `wiki:${document.id}`,
    title: document.title,
    description: document.excerpt || t.input.slashWikiDescription,
    value: '',
    keywords: ['wiki', 'knowledge', 'sop', document.title, document.excerpt, document.path],
    wikiDocument: document
  }
}

function buildModeSlashCommands(t: Dictionary): SlashCommandOption[] {
  return [
    {
      id: 'mode:react',
      title: 'ReAct',
      description: t.settings.planExecuteHint,
      value: '',
      keywords: ['mode', 'agent', 'react', '模式'],
      agentMode: 'react'
    },
    {
      id: 'mode:plan-execute',
      title: 'Plan-and-Execute',
      description: t.settings.planExecuteHint,
      value: '',
      keywords: ['mode', 'agent', 'plan', 'execute', 'plan-execute', '规划', '执行'],
      agentMode: 'plan-execute'
    }
  ]
}

function buildConnectionSlashCommand(
  connection: ConnectionConfig,
  t: Dictionary
): SlashCommandOption {
  return {
    id: `connection:${connection.id}`,
    title: connection.name,
    description: formatConnectionTarget(connection),
    value: '',
    keywords: [
      'connection',
      'ssh',
      connection.name,
      connection.host,
      connection.user,
      connection.description,
      connection.source === 'ssh-config' ? '~/.ssh/config' : t.connections.customConnectionName
    ].filter((value): value is string => Boolean(value)),
    connection
  }
}

function addUniqueSkillRef(
  skillRefs: AgentSkillOption[],
  skill: AgentSkillOption
): AgentSkillOption[] {
  if (skillRefs.some((current) => current.id === skill.id)) return skillRefs

  return [...skillRefs, skill]
}

function addUniqueToolRef(
  toolRefs: AgentToolReference[],
  tool: AgentToolReference
): AgentToolReference[] {
  if (toolRefs.some((current) => current.id === tool.id)) return toolRefs

  return [...toolRefs, tool]
}

function addUniqueWikiRef(
  wikiRefs: AgentWikiReference[],
  wiki: AgentWikiReference
): AgentWikiReference[] {
  if (wikiRefs.some((current) => current.id === wiki.id)) return wikiRefs

  return [...wikiRefs, wiki]
}

function addUniquePathRef(
  pathRefs: AgentPathReference[],
  reference: AgentPathReference
): AgentPathReference[] {
  if (pathRefs.some((current) => current.id === reference.id)) return pathRefs

  return [...pathRefs, reference]
}

function buildAgentInputWithReferences(
  input: string,
  skillRefs: AgentSkillOption[],
  pathRefs: AgentPathReference[],
  toolRefs: AgentToolReference[],
  wikiRefs: AgentWikiReference[],
  t: Dictionary
): string {
  const toolLines = toolRefs.flatMap((tool) => [
    `- ${t.input.slashToolUseLabel}: ${tool.name}`,
    tool.description ? `  ${t.input.slashToolDescriptionLabel}: ${tool.description}` : '',
    `  ${t.input.slashToolRequirement}`
  ])

  const skillLines = skillRefs.flatMap((skill) => [
    `- ${t.input.slashSkillUseLabel}: ${skill.name}`,
    `  ${t.input.slashSkillPathLabel}: ${skill.path}`,
    skill.description ? `  ${t.input.slashSkillDescriptionLabel}: ${skill.description}` : '',
    `  ${t.input.slashSkillRequirement}`
  ])

  const pathLines = pathRefs.map((reference) => {
    const label =
      reference.kind === 'directory' ? t.input.referencedDirectory : t.input.referencedFile
    return `- ${label}: ${reference.path}`
  })
  const wikiLines = wikiRefs.flatMap((wiki) => [
    `- ${t.input.slashWikiUseLabel}: ${wiki.title}`,
    `  ${t.input.slashSkillPathLabel}: ${wiki.path}`,
    '  ```markdown',
    wiki.content,
    '  ```'
  ])

  const referenceSections = [
    ...(toolRefs.length > 0 ? [`${t.input.referencedTools}:`, ...toolLines.filter(Boolean)] : []),
    ...(skillRefs.length > 0
      ? [
          ...(toolRefs.length > 0 ? [''] : []),
          `${t.input.referencedSkills}:`,
          ...skillLines.filter(Boolean)
        ]
      : []),
    ...(pathRefs.length > 0
      ? [
          ...(toolRefs.length > 0 || skillRefs.length > 0 ? [''] : []),
          `${t.input.referencedPaths}:`,
          ...pathLines,
          t.input.pathReferenceRequirement
        ]
      : []),
    ...(wikiRefs.length > 0
      ? [
          ...(toolRefs.length > 0 || skillRefs.length > 0 || pathRefs.length > 0 ? [''] : []),
          `${t.input.referencedWikiDocuments}:`,
          ...wikiLines,
          t.input.slashWikiRequirement
        ]
      : [])
  ]

  if (referenceSections.length === 0) return input

  return [...referenceSections, '', `${t.input.slashSkillTaskLabel}:`, input].join('\n')
}

function formatVisibleInputWithReferences(
  input: string,
  skillRefs: AgentSkillOption[],
  pathRefs: AgentPathReference[],
  toolRefs: AgentToolReference[],
  wikiRefs: AgentWikiReference[],
  t: Dictionary
): string {
  const visibleReferences = [
    toolRefs.length > 0
      ? `${t.input.referencedTools}: ${toolRefs.map((tool) => `\`${tool.name}\``).join(', ')}`
      : '',
    skillRefs.length > 0
      ? `${t.input.referencedSkills}: ${skillRefs.map((skill) => `\`${skill.name}\``).join(', ')}`
      : '',
    pathRefs.length > 0
      ? `${t.input.referencedPaths}: ${pathRefs
          .map((reference) => `\`${reference.name}\``)
          .join(', ')}`
      : '',
    wikiRefs.length > 0
      ? `${t.input.referencedWikiDocuments}: ${wikiRefs
          .map((wiki) => `\`${wiki.title}\``)
          .join(', ')}`
      : ''
  ].filter(Boolean)

  if (visibleReferences.length === 0) return input

  return `${visibleReferences.join('\n')}\n\n${input}`
}

function buildPostLoginAgentInput(
  input: string,
  connection: ConnectionConfig,
  t: Dictionary
): string {
  return [
    t.terminal.postLoginAgentInstruction,
    `${t.terminal.connectionTarget}: ${connection.name} (${formatConnectionTarget(connection)})`,
    '',
    buildUserRequirementBreakdown(input, connection, t),
    '',
    t.terminal.postLoginOriginalTask,
    input
  ].join('\n')
}

function buildCurrentTerminalAgentInput(
  input: string,
  terminalContext: { cwd: string; mode: string; output: string; shell: string },
  t: Dictionary
): string {
  return [
    t.terminal.currentTerminalInstruction,
    `${t.terminal.terminalMode}: ${terminalContext.mode}`,
    `${t.app.workingDirectory}: ${terminalContext.cwd || '-'}`,
    '',
    t.terminal.postLoginOriginalTask,
    input
  ].join('\n')
}

function buildUserRequirementBreakdown(
  input: string,
  connection: ConnectionConfig,
  t: Dictionary
): string {
  const artifactDestination = extractArtifactDestination(input)
  const targetSystem = extractTargetSystem(input)
  const requestedActions = extractRequestedActions(input)
  const lines = [
    t.terminal.requirementBreakdown,
    `1. ${t.terminal.breakdownTargetConnection}: ${connection.name} (${formatConnectionTarget(connection)})`,
    `2. ${t.terminal.breakdownTargetSystem}: ${targetSystem || t.terminal.breakdownInferFromTask}`,
    `3. ${t.terminal.breakdownActions}: ${requestedActions.join(' -> ')}`,
    `4. ${t.terminal.breakdownArtifact}: ${
      artifactDestination
        ? `${t.terminal.breakdownArtifactDestination}: ${artifactDestination}`
        : t.terminal.breakdownNoExplicitArtifact
    }`,
    '',
    t.terminal.breakdownExecutionRules,
    `- ${t.terminal.breakdownRuleUseCurrentTerminal}`,
    `- ${t.terminal.breakdownRuleUseSubterminal}`,
    `- ${t.terminal.breakdownRulePreserveDestination}`,
    `- ${t.terminal.breakdownRuleNoFabrication}`
  ]

  return lines.join('\n')
}

function extractTargetSystem(input: string): string {
  return (
    input.match(
      /(?:检查|查看|巡检|排查|处理|获取|统计|增加|新增|创建|添加|开通|配置|修改|变更|授权)\s*([A-Za-z0-9_.-]+|[\u4e00-\u9fa5A-Za-z0-9_.-]+)/i
    )?.[1] ??
    input.match(
      /([A-Za-z0-9_.-]+|[\u4e00-\u9fa5A-Za-z0-9_.-]+)\s*(?:健康|状态|巡检|检查|账号|账户|用户|管理员|权限|角色)/i
    )?.[1] ??
    ''
  )
}

function extractArtifactDestination(input: string): string {
  const pathMatch = input.match(
    /(?:放在|保存到|写到|写入|输出到|导出到|存到)\s*([~./$A-Za-z0-9_\-\u4e00-\u9fa5][^\s，。；,;]*)/i
  )
  if (pathMatch?.[1]) return normalizeArtifactDestination(pathMatch[1])

  const loosePathMatch = input.match(/((?:~|\/|\$HOME)[^\s，。；,;]*)/)
  return loosePathMatch?.[1] ? normalizeArtifactDestination(loosePathMatch[1]) : ''
}

function normalizeArtifactDestination(value: string): string {
  return value.replace(/(?:目录下|目录|路径下|路径|下)$/u, '')
}

function extractRequestedActions(input: string): string[] {
  const actions: string[] = []
  if (/(登录|登陆|连接|进入|\bssh\b)/i.test(input)) actions.push('login')
  if (/(检查|查看|巡检|排查|健康|状态|统计|获取)/i.test(input)) actions.push('inspect')
  if (
    /(增加|新增|创建|添加|开通|授权).*(账号|账户|用户|管理员|权限|角色)|账号|账户|用户|管理员|权限|角色/i.test(
      input
    )
  ) {
    actions.push('change-account-or-permission')
  }
  if (/(配置|修改|变更|处理|执行)/i.test(input)) actions.push('operate')
  if (/(总结|生成|报告|文档|记录)/i.test(input)) actions.push('summarize')
  if (/(保存|写入|写到|放在|输出|导出|存到)/i.test(input)) actions.push('write-artifact')

  return actions.length ? actions : ['complete-request']
}

function buildConnectionCommands(connection: ConnectionConfig): string[] {
  if (!connection.host) return []

  return [buildSshCommand(connection), ...buildConnectionLoginActions(connection)]
}

function buildConnectionLoginActions(connection: ConnectionConfig): string[] {
  const password = connection.password || connection.resolvedPassword
  const passwordActions = password ? [password] : []
  return [...passwordActions, ...(connection.actions ?? [])]
}

function isPasswordEnvVarMissing(connection: ConnectionConfig): boolean {
  return Boolean(connection.passwordEnvVar && !connection.password && !connection.resolvedPassword)
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

function extractPasswordPromptLine(output: string): string | null {
  const lines = stripTerminalControlSequences(output)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isPasswordPromptLine(lines[index])) return lines[index]
  }

  return null
}

function isTerminalCurrentlyAtPasswordPrompt(output: string): boolean {
  const lines = stripTerminalControlSequences(output)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const lastLine = lines[lines.length - 1]
  return Boolean(lastLine && isPasswordPromptLine(lastLine))
}

function isPasswordPromptLine(line: string): boolean {
  return (
    /(?:password|passphrase|verification code|one-time password|otp)\b.*[:：]\s*$/i.test(
      line
    ) || /(?:验证码|动态口令|一次性密码|密码).*[:：]\s*$/i.test(line)
  )
}

function hasOutputBeyondEcho(output: string, echo: string): boolean {
  const compactOutput = compactTerminalText(output)
  const compactEcho = compactTerminalText(echo)
  const echoIndex = compactOutput.indexOf(compactEcho)

  if (echoIndex === -1) return compactOutput.length > 0

  return compactOutput.slice(echoIndex + compactEcho.length).length > 0
}

function hasInteractivePrompt(output: string): boolean {
  const normalizedOutput = stripTerminalControlSequences(output).replace(/\r/g, '\n')
  const lines = normalizedOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-6)

  return lines.some((line) => {
    if (/(yes\/no|continue connecting)/i.test(line)) return true

    return /(?:password|passphrase|verification code|one-time password|otp|验证码|密码)\s*[:：]\s*$/i.test(
      line
    )
  })
}

function compactTerminalText(value: string): string {
  return stripTerminalControlSequences(value).replace(/\s+/g, '')
}

function sendTerminalInput(value: string, tabId: string): void {
  window.api.terminal.write(`${value}\r`, tabId)
}

function formatConnectionActionLog(command: string, actionIndex: number, t: Dictionary): string {
  return `${t.terminal.connectionAction} ${actionIndex}\n${maskPotentialSecret(command)}`
}

function maskPotentialSecret(value: string): string {
  if (value.length <= 2) return '<hidden>'
  if (/^\S+$/.test(value) && !looksLikeCommand(value)) return '<hidden>'

  return value
}

function looksLikeCommand(value: string): boolean {
  return /^(ssh|sudo|su|cd|ls|pwd|kubectl|docker|systemctl|journalctl|cat|tail|grep|vim|vi|export)\b/.test(
    value.trim()
  )
}

function createCustomConnectionId(): string {
  return `custom-${crypto.randomUUID()}`
}

function buildSshCommand(connection: ConnectionConfig): string {
  if (connection.source === 'ssh-config') return `ssh ${shellQuote(connection.name)}`

  return [
    'ssh',
    connection.port ? `-p ${connection.port}` : '',
    connection.identityFile ? `-i ${shellQuote(connection.identityFile)}` : '',
    ...(connection.sshOptions ?? []),
    connection.user ? `-l ${shellQuote(connection.user)}` : '',
    shellQuote(connection.host)
  ]
    .filter(Boolean)
    .join(' ')
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    return
  } catch {
    const textArea = document.createElement('textarea')
    textArea.value = value
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.top = '0'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
  }
}

function MarkdownContent({ value, t }: { value: string; t: Dictionary }): React.JSX.Element {
  return (
    <div className="select-text min-w-0 space-y-2 overflow-hidden leading-relaxed break-words">
      {renderMarkdownBlocks(value, t)}
    </div>
  )
}

function renderMarkdownBlocks(value: string, t: Dictionary): React.ReactNode[] {
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  const nodes: React.ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    if (/^\s*---+\s*$/.test(line)) {
      nodes.push(<Separator key={nodes.length} />)
      index += 1
      continue
    }

    if (line.trim() === '<details>') {
      index += 1
      let summary = 'Details'
      const contentLines: string[] = []

      if (lines[index]?.trim().startsWith('<summary>')) {
        summary = lines[index]
          .trim()
          .replace(/^<summary>/, '')
          .replace(/<\/summary>$/, '')
        index += 1
      }

      while (index < lines.length && lines[index].trim() !== '</details>') {
        contentLines.push(lines[index])
        index += 1
      }
      index += 1
      nodes.push(
        <details key={nodes.length} className="min-w-0 overflow-hidden rounded-md border bg-muted/20 p-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            {summary}
          </summary>
          <div className="mt-2 min-w-0 space-y-2 overflow-hidden">
            {renderMarkdownBlocks(contentLines.join('\n'), t)}
          </div>
        </details>
      )
      continue
    }

    if (isMarkdownTableStart(lines, index)) {
      const tableLines: string[] = []
      while (index < lines.length && isMarkdownTableLine(lines[index])) {
        tableLines.push(lines[index])
        index += 1
      }
      nodes.push(<MarkdownTable key={nodes.length} lines={tableLines} />)
      continue
    }

    const fence = line.match(/^```([\w-]+)?\s*$/)
    if (fence) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      index += 1
      nodes.push(
        <MarkdownCodeBlock
          key={nodes.length}
          code={codeLines.join('\n')}
          language={fence[1] ?? ''}
          t={t}
        />
      )
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const className =
        level === 1
          ? 'text-base font-semibold'
          : level === 2
            ? 'text-sm font-semibold'
            : 'text-sm font-medium'

      nodes.push(
        <div key={nodes.length} className={`${className} min-w-0 break-words`}>
          {renderInlineMarkdown(heading[2])}
        </div>
      )
      index += 1
      continue
    }

    if (/^>\s+/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      nodes.push(
        <blockquote
          key={nodes.length}
          className="min-w-0 break-words border-l-2 border-border pl-3 text-muted-foreground"
        >
          {renderInlineMarkdown(quoteLines.join(' '))}
        </blockquote>
      )
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ''))
        index += 1
      }
      nodes.push(
        <ul key={nodes.length} className="min-w-0 list-disc space-y-1 pl-5 break-words">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ''))
        index += 1
      }
      nodes.push(
        <ol key={nodes.length} className="min-w-0 list-decimal space-y-1 pl-5 break-words">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      )
      continue
    }

    const paragraphLines = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index])
      index += 1
    }
    nodes.push(
      <p key={nodes.length} className="min-w-0 break-words">
        {renderInlineMarkdown(paragraphLines.join(' '))}
      </p>
    )
  }

  return nodes
}

function MarkdownCodeBlock({
  code,
  language,
  t
}: {
  code: string
  language: string
  t: Dictionary
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const label = language || 'text'

  async function copyCode(): Promise<void> {
    await copyText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-md border bg-[#111111] text-zinc-100">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-white/10 bg-white/5 px-3 py-1.5">
        <span className="min-w-0 truncate font-mono text-[11px] text-zinc-400">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="h-6 w-6 shrink-0 text-zinc-300 hover:bg-white/10 hover:text-white"
          aria-label={copied ? t.common.copied : t.common.copy}
          title={copied ? t.common.copied : t.common.copy}
          onClick={() => void copyCode()}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        </Button>
      </div>
      <pre className="min-w-0 overflow-hidden whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed">
        <code className="break-words">{code}</code>
      </pre>
    </div>
  )
}

function isMarkdownBlockStart(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^\s*---+\s*$/.test(line) ||
    isMarkdownTableLine(line) ||
    /^<details>$/.test(line.trim()) ||
    /^(#{1,4})\s+/.test(line) ||
    /^>\s+/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line)
  )
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  return Boolean(
    lines[index] &&
    lines[index + 1] &&
    isMarkdownTableLine(lines[index]) &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  )
}

function isMarkdownTableLine(line: string): boolean {
  return line.includes('|') && line.trim().split('|').filter(Boolean).length >= 2
}

function MarkdownTable({ lines }: { lines: string[] }): React.JSX.Element {
  const [headerLine, , ...bodyLines] = lines
  const headers = splitMarkdownTableRow(headerLine)
  const rows = bodyLines.map(splitMarkdownTableRow)

  return (
    <div className="min-w-0 overflow-hidden rounded-md border">
      <table className="w-full table-fixed border-collapse text-left text-xs">
        <thead className="bg-muted/40">
          <tr>
            {headers.map((header, index) => (
              <th key={index} className="break-words border-b px-2 py-1.5 font-medium">
                {renderInlineMarkdown(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b last:border-b-0">
              {headers.map((_, cellIndex) => (
                <td key={cellIndex} className="break-words px-2 py-1.5 align-top">
                  {renderInlineMarkdown(row[cellIndex] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function renderInlineMarkdown(value: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) nodes.push(value.slice(lastIndex, match.index))

    const token = match[0]
    if (token.startsWith('`')) {
      nodes.push(
        <code
          key={nodes.length}
          className="break-all rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={nodes.length}>{renderInlineMarkdown(token.slice(2, -2))}</strong>)
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      const href = link ? safeHref(link[2]) : ''
      nodes.push(
        href ? (
          <a
            key={nodes.length}
            href={href}
            className="break-words text-cyan-300 underline underline-offset-2"
            rel="noreferrer"
            target="_blank"
          >
            {link?.[1]}
          </a>
        ) : (
          token
        )
      )
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < value.length) nodes.push(value.slice(lastIndex))
  return nodes
}

function safeHref(value: string): string {
  return /^(https?:|mailto:)/i.test(value) ? value : ''
}

function buildWikiContentFromHistory(detail: StoredSessionHistoryDetail, t: Dictionary): string {
  const title = `${detail.title} SOP`
  const logs = detail.logs
    .filter((log) => log.kind === 'user' || log.kind === 'assistant' || log.kind === 'error')
    .slice(-20)
  const sourceLines = [
    `- ${t.wiki.sourceSession}: ${detail.title}`,
    detail.connectionName ? `- ${t.terminal.connectionTarget}: ${detail.connectionName}` : '',
    detail.terminalCwd ? `- ${t.app.workingDirectory}: ${detail.terminalCwd}` : '',
    `- ${t.history.runs}: ${detail.runCount}`,
    `- ${t.wiki.savedAt}: ${new Date().toISOString()}`
  ].filter(Boolean)

  const conversationLines = logs.flatMap((log) => [
    `### ${formatWikiLogKind(log.kind, t)} · ${log.createdAt}`,
    '',
    truncateWikiContent(log.text.trim(), 6000),
    ''
  ])

  return [
    `# ${title}`,
    '',
    `## ${t.wiki.overview}`,
    '',
    t.wiki.generatedFromHistory,
    '',
    `## ${t.wiki.sourceInfo}`,
    '',
    ...sourceLines,
    '',
    `## ${t.wiki.bestPracticeDraft}`,
    '',
    `- ${t.wiki.fillInPurpose}`,
    `- ${t.wiki.fillInPrerequisites}`,
    `- ${t.wiki.fillInSteps}`,
    `- ${t.wiki.fillInRollback}`,
    '',
    `## ${t.wiki.historyTranscript}`,
    '',
    ...conversationLines
  ].join('\n')
}

function formatWikiLogKind(kind: string, t: Dictionary): string {
  if (kind === 'user') return t.common.user
  if (kind === 'assistant') return t.common.assistant
  if (kind === 'error') return t.common.error
  return kind
}

function truncateWikiContent(content: string, maxChars: number): string {
  return content.length > maxChars ? `${content.slice(0, maxChars)}\n...[truncated]` : content
}

function upsertWikiSummary(
  documents: WikiDocumentSummary[],
  document: WikiDocument
): WikiDocumentSummary[] {
  const summary: WikiDocumentSummary = {
    id: document.id,
    title: document.title,
    path: document.path,
    updatedAt: document.updatedAt,
    excerpt: document.excerpt
  }

  return [summary, ...documents.filter((candidate) => candidate.id !== document.id)]
}

function filterWikiDocuments(
  documents: WikiDocumentSummary[],
  query: string
): WikiDocumentSummary[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return documents

  return documents.filter((document) =>
    [document.title, document.excerpt, document.path]
      .join('\n')
      .toLowerCase()
      .includes(normalized)
  )
}

export default App
