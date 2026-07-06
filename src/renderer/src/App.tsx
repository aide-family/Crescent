import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import {
  ArrowUpIcon,
  BotIcon,
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  PlusIcon,
  ServerIcon,
  SettingsIcon,
  TerminalIcon,
  TestTube2Icon
} from 'lucide-react'

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
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import type {
  AgentConfig,
  AgentEvent,
  AgentModelOption,
  AgentValidationResult,
  ConnectionConfig,
  ConnectionInput
} from '../../main/agent/types'

const emptyConfig: AgentConfig = {
  openAiApiKey: '',
  openAiBaseUrl: '',
  model: 'azure/gpt-5.5',
  agentMode: 'react',
  maxActiveTools: 5,
  openApiBaseUrl: '',
  openApiDocument: ''
}

type AgentLogEntry =
  | { id: number; kind: 'user' | 'assistant' | 'error'; text: string; createdAt: string }
  | {
      id: number
      kind: 'status' | 'thought' | 'tool' | 'plan' | 'command'
      text: string
      createdAt: string
    }

interface AgentTerminalTab {
  id: string
  title: string
  connectionId?: string
  connectionName?: string
  isSsh: boolean
  sessionId?: number
  terminalReady: boolean
  terminalCwd: string
  terminalMode: 'pty' | 'pipe'
  terminalOutput: string
  agentInput: string
  agentBusy: boolean
  copiedLogId: number | null
  agentLog: AgentLogEntry[]
}

const defaultAgentLogEntry: AgentLogEntry = {
  id: 0,
  kind: 'status',
  text: 'Ready. Configure a model and OpenAPI document, then ask the agent to call your API.',
  createdAt: new Date().toISOString()
}

function createTerminalTab(input?: Partial<AgentTerminalTab>): AgentTerminalTab {
  return {
    id: input?.id ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: input?.title ?? 'Local',
    connectionId: input?.connectionId,
    connectionName: input?.connectionName,
    isSsh: input?.isSsh ?? false,
    sessionId: input?.sessionId,
    terminalReady: input?.terminalReady ?? false,
    terminalCwd: input?.terminalCwd ?? '',
    terminalMode: input?.terminalMode ?? 'pty',
    terminalOutput: input?.terminalOutput ?? '',
    agentInput: input?.agentInput ?? '',
    agentBusy: input?.agentBusy ?? false,
    copiedLogId: input?.copiedLogId ?? null,
    agentLog: input?.agentLog ?? [defaultAgentLogEntry]
  }
}

function formatPipePrompt(cwd: string): string {
  const home = cwd.replace(/^\/Users\/[^/]+/, '~')

  return `\x1b[38;5;45m${home}\x1b[0m $ `
}

function App(): React.JSX.Element {
  const terminalHostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const terminalSessionIdRef = useRef<number | null>(null)
  const terminalModeRef = useRef<'pty' | 'pipe'>('pty')
  const terminalCwdRef = useRef('')
  const pipeInputBufferRef = useRef('')
  const pipeCursorRef = useRef(0)
  const pipeHistoryRef = useRef<string[]>([])
  const pipeHistoryIndexRef = useRef<number | null>(null)
  const nextLogIdRef = useRef(1)
  const agentLogRef = useRef<HTMLDivElement | null>(null)
  const activeTabIdRef = useRef('default')
  const tabsRef = useRef<AgentTerminalTab[]>([])
  const pendingSshRef = useRef(new Map<string, ConnectionConfig>())
  const [config, setConfig] = useState<AgentConfig>(emptyConfig)
  const [models, setModels] = useState<AgentModelOption[]>([])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [validation, setValidation] = useState<AgentValidationResult | undefined>()
  const [validating, setValidating] = useState(false)
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [connectionModalOpen, setConnectionModalOpen] = useState(false)
  const [connectionForm, setConnectionForm] = useState<ConnectionInput>({
    name: '',
    host: '',
    user: '',
    port: 22,
    identityFile: '',
    sshOptions: [],
    description: '',
    actions: []
  })
  const [connectionSshOptionsText, setConnectionSshOptionsText] = useState('')
  const [connectionActionsText, setConnectionActionsText] = useState('')
  const [tabs, setTabs] = useState<AgentTerminalTab[]>([
    createTerminalTab({ id: 'default', title: 'Local' })
  ])
  const [activeTabId, setActiveTabId] = useState('default')
  const [tabMenu, setTabMenu] = useState<{
    tabId: string
    x: number
    y: number
  } | null>(null)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

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

  const updateTab = useCallback(
    (tabId: string, updater: (tab: AgentTerminalTab) => AgentTerminalTab): void => {
      setTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)))
    },
    []
  )

  const appendLog = useCallback(
    (entry: Omit<AgentLogEntry, 'id' | 'createdAt'>, tabId = activeTabIdRef.current): void => {
      const id = nextLogIdRef.current
      nextLogIdRef.current += 1
      updateTab(tabId, (tab) => ({
        ...tab,
        agentLog: [...tab.agentLog, { id, ...entry, createdAt: new Date().toISOString() }].slice(
          -120
        )
      }))
    },
    [updateTab]
  )

  const appendAgentEvent = useCallback(
    (event: AgentEvent, tabId = activeTabIdRef.current): void => {
      if (event.type === 'token' || event.type === 'done') return

      if (event.type === 'plan') {
        appendLog(
          {
            kind: 'plan',
            text: event.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
          },
          tabId
        )
        return
      }

      if (event.type === 'tool') {
        appendLog({ kind: 'tool', text: `${event.name}: ${event.message}` }, tabId)
        return
      }

      appendLog({ kind: event.type, text: event.message }, tabId)
    },
    [appendLog]
  )

  const executeConnectionCommands = useCallback(
    (connection: ConnectionConfig, targetTabId: string): void => {
      const commands = buildConnectionCommands(connection)
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
        title: connection.name,
        connectionId: connection.id,
        connectionName: connection.name,
        isSsh: true
      }))
      appendLog(
        {
          kind: connection.actions?.length ? 'status' : 'error',
          text: connection.actions?.length
            ? `Starting connection with ${connection.actions.length} login action${connection.actions.length === 1 ? '' : 's'}.`
            : 'Starting SSH connection without login actions. Password prompts will wait for manual input.'
        },
        targetTabId
      )
      void runConnectionCommandSequence(commands, targetTabId, appendLog)
    },
    [appendLog, updateTab]
  )

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

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

  const redrawPipeInput = useCallback((terminal: Terminal): void => {
    const buffer = pipeInputBufferRef.current
    const cursor = pipeCursorRef.current

    terminal.write(`\r\x1b[2K${formatPipePrompt(terminalCwdRef.current)}${buffer}`)
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
    document.documentElement.classList.add('dark')

    window.api.agent
      .getConfig()
      .then(setConfig)
      .catch((error) => {
        writeLine(`\x1b[31mFailed to load config: ${String(error)}\x1b[0m`)
      })
    window.api.agent
      .getModels()
      .then(setModels)
      .catch((error) => {
        writeLine(`\x1b[31mFailed to load models: ${String(error)}\x1b[0m`)
      })
    window.api.connections
      .list()
      .then((items) => {
        setConnections(items)
      })
      .catch((error) => {
        writeLine(`\x1b[31mFailed to load connections: ${String(error)}\x1b[0m`)
      })
  }, [writeLine])

  useEffect(() => {
    const unsubscribe = window.api.agent.onEvent((event) => {
      appendAgentEvent(event)
    })

    return unsubscribe
  }, [appendAgentEvent])

  useEffect(() => {
    agentLogRef.current?.scrollTo({ top: agentLogRef.current.scrollHeight })
  }, [activeTab?.agentLog])

  useEffect(() => {
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

    if (tab.terminalOutput) {
      terminal.write(tab.terminalOutput)
    } else {
      terminal.writeln('\x1b[1mCrescent Shell\x1b[0m')
      terminal.writeln('Starting local shell in your home directory...')
    }

    const terminalDataDisposable = terminal.onData((data) => {
      if (terminalModeRef.current === 'pipe') {
        handlePipeTerminalInput(terminal, data)
        return
      }

      window.api.terminal.write(data, activeTabIdRef.current)
    })
    const stopTerminalData = window.api.terminal.onData((event) => {
      updateTab(event.tabId, (current) => ({
        ...current,
        terminalOutput: `${current.terminalOutput}${event.data}`.slice(-200_000)
      }))
      if (event.tabId === activeTabIdRef.current) terminal.write(event.data)
    })
    const stopTerminalPrompt = window.api.terminal.onPrompt(({ tabId, cwd }) => {
      updateTab(tabId, (current) => ({ ...current, terminalCwd: cwd }))
      if (tabId === activeTabIdRef.current) {
        terminalCwdRef.current = cwd
        terminal.write(`\r\n${formatPipePrompt(cwd)}`)
      }
    })
    const stopTerminalExit = window.api.terminal.onExit((event) => {
      updateTab(event.tabId, (current) => ({ ...current, terminalReady: false }))
      if (event.tabId === activeTabIdRef.current) {
        terminal.writeln(`\r\n\x1b[31mShell exited with code ${event.exitCode}.\x1b[0m`)
      }
    })

    const startShell = async (): Promise<void> => {
      if (tab.sessionId) {
        terminalSessionIdRef.current = tab.sessionId
        terminalModeRef.current = tab.terminalMode
        terminalCwdRef.current = tab.terminalCwd
        return
      }

      const dimensions = fitAddon.proposeDimensions()
      const session = await window.api.terminal.start({
        cols: dimensions?.cols ?? 80,
        rows: dimensions?.rows ?? 24,
        tabId: tab.id
      })

      terminalSessionIdRef.current = session.sessionId
      terminalModeRef.current = session.mode
      terminalCwdRef.current = session.cwd
      updateTab(tab.id, (current) => ({
        ...current,
        sessionId: session.sessionId,
        terminalMode: session.mode,
        terminalCwd: session.cwd,
        terminalReady: true
      }))
      terminal.writeln(
        `\r\n\x1b[2mTerminal mode: ${session.mode.toUpperCase()}${session.mode === 'pipe' ? ' (limited fallback; SSH/password prompts are disabled)' : ''}\x1b[0m`
      )
      const pendingConnection = pendingSshRef.current.get(tab.id)
      if (pendingConnection) {
        pendingSshRef.current.delete(tab.id)
        executeConnectionCommands(pendingConnection, tab.id)
      }
    }

    void startShell().catch((error) => {
      terminal.writeln(`\r\n\x1b[31mFailed to start shell: ${String(error)}\x1b[0m`)
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
  }, [activeTabId, appendLog, executeConnectionCommands, handlePipeTerminalInput, updateTab])

  async function saveConfig(): Promise<void> {
    const nextConfig = await window.api.agent.saveConfig(config)
    setConfig(nextConfig)
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
  }

  async function validateConfig(): Promise<void> {
    setValidating(true)
    setValidation(undefined)

    try {
      const result = await window.api.agent.validateConfig(config)
      setValidation(result)
    } finally {
      setValidating(false)
    }
  }

  async function getTerminalContextForAgent(): Promise<string> {
    const context = await window.api.terminal.getContext(activeTabIdRef.current)
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

  function connectToConnection(connection: ConnectionConfig): void {
    const currentTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
    let targetTabId = currentTab?.id ?? 'default'

    if (currentTab?.isSsh) {
      const nextTab = createTerminalTab({
        title: connection.name,
        connectionId: connection.id,
        connectionName: connection.name,
        isSsh: true
      })
      targetTabId = nextTab.id
      setTabs((current) => [...current, nextTab])
      setActiveTabId(nextTab.id)
    }

    const targetTab = tabsRef.current.find((tab) => tab.id === targetTabId)
    if (targetTab?.sessionId) {
      executeConnectionCommands(connection, targetTabId)
    } else {
      pendingSshRef.current.set(targetTabId, connection)
    }
  }

  async function saveConnection(connectAfterSave = false): Promise<void> {
    const normalizedInput = normalizeConnectionInputForSave()
    if (!normalizedInput) return

    const input = normalizedInput.id
      ? normalizedInput
      : { ...normalizedInput, id: createCustomConnectionId() }

    const nextConnections = await window.api.connections.save(input)
    setConnections(nextConnections)
    const fallbackConnection: ConnectionConfig = { ...input, id: input.id ?? '', source: 'custom' }
    const savedConnection = mergeConnectionInput(
      nextConnections.find((connection) => connection.id === input.id),
      fallbackConnection
    )

    if (connectAfterSave && savedConnection) {
      connectToConnection(savedConnection)
      setConnectionModalOpen(false)
      resetConnectionForm()
      return
    }

    if (savedConnection) {
      editConnection(savedConnection)
    }
  }

  async function deleteConnection(id: string): Promise<void> {
    const nextConnections = await window.api.connections.delete(id)
    setConnections(nextConnections)
    if (connectionForm.id === id) resetConnectionForm()
  }

  async function submitAgent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    const tabId = activeTabIdRef.current
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
    const input = tab?.agentInput.trim() ?? ''
    if (!input || tab?.agentBusy) return

    updateTab(tabId, (current) => ({ ...current, agentInput: '', agentBusy: true }))
    appendLog({ kind: 'user', text: input }, tabId)

    try {
      const terminalContext = await getTerminalContextForAgent()
      const result = await window.api.agent.run({
        input,
        terminalContext,
        connectionId: tab?.connectionId || undefined,
        tabId
      })

      if (result.ok) {
        const text = result.text || 'Done.'
        appendLog({ kind: 'assistant', text }, tabId)
      } else {
        appendLog({ kind: 'error', text: result.error || 'Agent run failed.' }, tabId)
      }
    } catch (error) {
      appendLog(
        { kind: 'error', text: error instanceof Error ? error.message : String(error) },
        tabId
      )
    } finally {
      updateTab(tabId, (current) => ({ ...current, agentBusy: false }))
    }
  }

  function handleAgentInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey) return

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  function updateConfig<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]): void {
    setConfig((current) => ({ ...current, [key]: value }))
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
      port: 22,
      identityFile: '',
      sshOptions: [],
      description: '',
      actions: []
    })
    setConnectionSshOptionsText('')
    setConnectionActionsText('')
  }

  function editConnection(connection: ConnectionConfig): void {
    setConnectionForm({
      id: connection.id,
      name: connection.name,
      host: connection.host,
      user: connection.user,
      port: connection.port ?? 22,
      identityFile: connection.identityFile,
      sshOptions: connection.sshOptions,
      description: connection.description,
      actions: connection.actions
    })
    setConnectionSshOptionsText(connection.sshOptions?.join('\n') ?? '')
    setConnectionActionsText(connection.actions?.join('\n') ?? '')
  }

  function closeTab(tabId: string): void {
    if (tabId === 'default') return

    window.api.terminal.stop(tabId)
    pendingSshRef.current.delete(tabId)
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== tabId)
      if (activeTabIdRef.current === tabId) {
        const fallback = next.find((tab) => tab.id !== 'default') ?? next[0]
        setActiveTabId(fallback?.id ?? 'default')
      }
      return next.length ? next : [createTerminalTab({ id: 'default', title: 'Local' })]
    })
    setTabMenu(null)
  }

  function closeOtherTabs(tabId: string): void {
    const keepIds = new Set(['default', tabId])
    for (const tab of tabsRef.current) {
      if (!keepIds.has(tab.id)) {
        window.api.terminal.stop(tab.id)
        pendingSshRef.current.delete(tab.id)
      }
    }

    setTabs((current) => current.filter((tab) => keepIds.has(tab.id)))
    setActiveTabId(tabId)
    setTabMenu(null)
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

  return (
    <main className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <TerminalIcon aria-hidden="true" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Crescent</span>
            <span className="text-xs text-muted-foreground">
              Terminal + SSH + AI command workbench
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={configured ? 'secondary' : 'outline'}>
            {config.model.trim() ? 'AI ready' : 'Needs model'}
          </Badge>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <SettingsIcon data-icon="inline-start" />
                Settings
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-xl">
              <SheetHeader>
                <SheetTitle>Agent settings</SheetTitle>
                <SheetDescription>
                  Configure the model provider and the OpenAPI document used to generate tools.
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-auto px-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="open-ai-api-key">OpenAI API key</FieldLabel>
                    <Input
                      id="open-ai-api-key"
                      type="password"
                      value={config.openAiApiKey}
                      onChange={(event) => updateConfig('openAiApiKey', event.target.value)}
                      placeholder="sk-... or leave blank when env key is available"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="open-ai-base-url">OpenAI-compatible base URL</FieldLabel>
                    <Input
                      id="open-ai-base-url"
                      value={config.openAiBaseUrl}
                      onChange={(event) => updateConfig('openAiBaseUrl', event.target.value)}
                      placeholder="https://api.openai.com/v1"
                    />
                    <FieldDescription>
                      Leave blank to use the selected built-in provider default.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="model">Model</FieldLabel>
                    <Select
                      value={config.model}
                      onValueChange={(value) => updateConfig('model', value)}
                    >
                      <SelectTrigger id="model" className="w-full">
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>OpenClaw-compatible defaults</SelectLabel>
                          {models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.name} · {model.providerId}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      Defaults mirror the OpenClaw provider layout; API keys stay local.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Agent mode</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={config.agentMode}
                      onValueChange={(value) => {
                        if (value === 'react' || value === 'plan-execute') {
                          updateConfig('agentMode', value)
                        }
                      }}
                      className="justify-start"
                    >
                      <ToggleGroupItem value="react">ReAct</ToggleGroupItem>
                      <ToggleGroupItem value="plan-execute">Plan-and-Execute</ToggleGroupItem>
                    </ToggleGroup>
                    <FieldDescription>
                      Use Plan-and-Execute for longer workflows that may need replanning.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="max-active-tools">Dynamic tool limit</FieldLabel>
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
                    <FieldDescription>
                      Only the most relevant OpenAPI tools are sent to the model.
                    </FieldDescription>
                  </Field>
                  <Separator />
                  <Field>
                    <FieldLabel htmlFor="open-api-base-url">REST API base URL</FieldLabel>
                    <Input
                      id="open-api-base-url"
                      value={config.openApiBaseUrl}
                      onChange={(event) => updateConfig('openApiBaseUrl', event.target.value)}
                      placeholder="https://api.example.com"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="open-api-document">OpenAPI URL or JSON</FieldLabel>
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
                            Loaded {validation.toolCount} OpenAPI tools.
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
                  onClick={validateConfig}
                  disabled={validating}
                >
                  {validating ? (
                    <Loader2Icon className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <TestTube2Icon data-icon="inline-start" />
                  )}
                  {validating ? 'Validating' : 'Validate tools'}
                </Button>
                <Button onClick={saveConfig}>
                  {saved ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : (
                    <BotIcon data-icon="inline-start" />
                  )}
                  {saved ? 'Saved' : 'Save settings'}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </header>
      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="flex min-h-0 flex-col border-r bg-[#111111]">
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/10 bg-background px-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`h-7 rounded px-2 text-xs ${tab.id === activeTabId ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted/40'}`}
                onClick={() => setActiveTabId(tab.id)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setTabMenu({ tabId: tab.id, x: event.clientX, y: event.clientY })
                }}
              >
                {tab.title}
              </button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Add SSH connection"
              title="Add SSH connection"
              onClick={() => setConnectionModalOpen(true)}
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
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={tabMenu.tabId === 'default'}
                  onClick={() => closeTab(tabMenu.tabId)}
                >
                  Close tab
                </button>
                <button
                  type="button"
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => closeOtherTabs(tabMenu.tabId)}
                >
                  Close other tabs
                </button>
              </div>
            )}
          </div>
          <div ref={terminalHostRef} className="h-full min-h-0" />
        </div>
        <aside className="flex min-h-0 flex-col bg-card">
          <div className="border-b p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Agent run panel</h2>
                <p className="text-xs text-muted-foreground">
                  Chat with AI, generate shell commands, and inject them into the terminal.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={activeTab.terminalMode === 'pty' ? 'secondary' : 'destructive'}>
                  {activeTab.terminalMode.toUpperCase()}
                </Badge>
                <Badge variant={activeTab.agentBusy ? 'secondary' : 'outline'}>
                  {activeTab.agentBusy ? 'Running' : config.agentMode}
                </Badge>
              </div>
            </div>
          </div>
          <div ref={agentLogRef} className="min-h-0 flex-1 space-y-3 overflow-auto p-4 text-sm">
            {activeTab.agentLog.map((entry) => (
              <div key={entry.id} className={logClassName(entry.kind)}>
                <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-medium uppercase tracking-wide">
                      {logRoleLabel(entry.kind)}
                    </span>
                    <time dateTime={entry.createdAt}>{formatLogTime(entry.createdAt)}</time>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Copy message"
                    title="Copy message"
                    onClick={() => copyLogEntry(entry)}
                  >
                    {activeTab.copiedLogId === entry.id ? (
                      <CheckIcon aria-hidden="true" />
                    ) : (
                      <CopyIcon aria-hidden="true" />
                    )}
                  </Button>
                </div>
                <MarkdownContent value={entry.text} />
              </div>
            ))}
          </div>
          <div className="space-y-3 border-t p-4">
            <form onSubmit={submitAgent} className="space-y-2">
              <div className="rounded-lg border bg-background p-2 shadow-sm">
                <Textarea
                  value={activeTab.agentInput}
                  onChange={(event) =>
                    updateTab(activeTab.id, (tab) => ({ ...tab, agentInput: event.target.value }))
                  }
                  onKeyDown={handleAgentInputKeyDown}
                  placeholder="Ask AI, or type /command check disk usage in the current terminal"
                  className="max-h-40 min-h-20 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
                  disabled={activeTab.agentBusy}
                />
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2 text-xs text-muted-foreground">
                  <span>Commands run through the agent in the current terminal.</span>
                  <div className="flex items-center gap-2">
                    <span>
                      {configured ? 'Tools configured' : 'Chat works without OpenAPI tools'}
                    </span>
                    <Button
                      type="submit"
                      size="icon"
                      aria-label="Send message"
                      disabled={activeTab.agentBusy || !activeTab.agentInput.trim()}
                    >
                      {activeTab.agentBusy ? (
                        <Loader2Icon className="animate-spin" aria-hidden="true" />
                      ) : (
                        <ArrowUpIcon aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </aside>
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
                  SSH connections
                </h2>
                <p className="text-xs text-muted-foreground">
                  Choose an existing connection or create a custom command sequence.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConnectionModalOpen(false)}
              >
                Close
              </Button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.9fr)_minmax(360px,1.1fr)] overflow-hidden">
              <div className="min-h-0 overflow-auto border-r p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    Existing
                  </h3>
                  <Badge variant="outline">{connections.length}</Badge>
                </div>
                <div className="space-y-2">
                  {connections.length === 0 ? (
                    <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                      No connections found.
                    </p>
                  ) : (
                    connections.map((connection) => (
                      <div key={connection.id} className="rounded-md border bg-card p-3 text-xs">
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
                                {connection.sshOptions?.length || 0} SSH options ·{' '}
                                {connection.actions?.length || 0} login actions
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              connectToConnection(connection)
                              setConnectionModalOpen(false)
                            }}
                          >
                            <ServerIcon data-icon="inline-start" />
                            Connect
                          </Button>
                        </div>
                        {connection.source === 'custom' && (
                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => editConnection(connection)}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteConnection(connection.id)}
                            >
                              Delete
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
                    <FieldLabel>Custom connection name</FieldLabel>
                    <Input
                      value={connectionForm.name}
                      onChange={(event) => updateConnectionForm('name', event.target.value)}
                      placeholder="production"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <FieldLabel>Host</FieldLabel>
                      <Input
                        value={connectionForm.host}
                        onChange={(event) => updateConnectionForm('host', event.target.value)}
                        placeholder="10.0.0.8"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Port</FieldLabel>
                      <Input
                        type="number"
                        value={connectionForm.port ?? 22}
                        onChange={(event) =>
                          updateConnectionForm('port', Number(event.target.value))
                        }
                        placeholder="22"
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel>User</FieldLabel>
                    <Input
                      value={connectionForm.user ?? ''}
                      onChange={(event) => updateConnectionForm('user', event.target.value)}
                      placeholder="root"
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Identity file</FieldLabel>
                    <Input
                      value={connectionForm.identityFile ?? ''}
                      onChange={(event) => updateConnectionForm('identityFile', event.target.value)}
                      placeholder="~/.ssh/id_rsa"
                    />
                  </Field>
                  <Field>
                    <FieldLabel>SSH options</FieldLabel>
                    <Textarea
                      className="min-h-28 resize-y font-mono text-xs"
                      value={connectionSshOptionsText}
                      onChange={(event) => setConnectionSshOptionsText(event.target.value)}
                      placeholder={
                        '-o HostKeyAlgorithms=+ssh-rsa\n-o PubkeyAcceptedAlgorithms=+ssh-rsa\n-t\n-o PreferredAuthentications=keyboard-interactive,password\n-o PubkeyAuthentication=no'
                      }
                    />
                    <FieldDescription>
                      One SSH argument per line. Crescent appends these to the generated ssh command
                      before the host.
                    </FieldDescription>
                    {connectionCommandPreview && (
                      <pre className="overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs text-muted-foreground">
                        {connectionCommandPreview}
                      </pre>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel>Login actions</FieldLabel>
                    <Textarea
                      className="min-h-32 resize-y font-mono text-xs"
                      value={connectionActionsText}
                      onChange={(event) => setConnectionActionsText(event.target.value)}
                      placeholder={'your_password\ncd /srv/app\nkubectl get pods'}
                    />
                    <FieldDescription>
                      One line per terminal input after ssh starts, such as password, confirmation,
                      or commands after login.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Description</FieldLabel>
                    <Input
                      value={connectionForm.description ?? ''}
                      onChange={(event) => updateConnectionForm('description', event.target.value)}
                      placeholder="Optional note"
                    />
                    <FieldDescription>
                      Custom connections are stored in ~/.crescent/config.json.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3">
              <Button type="button" variant="outline" onClick={resetConnectionForm}>
                Clear
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveConnection(false)}
                  disabled={!connectionFormReady}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  onClick={() => saveConnection(true)}
                  disabled={!connectionFormReady}
                >
                  <ServerIcon data-icon="inline-start" />
                  Save and connect
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      <footer className="flex h-9 shrink-0 items-center justify-between border-t px-4 text-xs text-muted-foreground">
        <span>Shell cwd: {activeTab.terminalCwd || 'starting...'}</span>
        <span className="inline-flex items-center gap-2">
          {!activeTab.terminalReady && <Loader2Icon className="animate-spin" aria-hidden="true" />}
          {activeTab.terminalReady
            ? `Shell ready · ${activeTab.terminalMode.toUpperCase()}`
            : 'Starting shell'}
        </span>
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

function logRoleLabel(kind: AgentLogEntry['kind']): string {
  switch (kind) {
    case 'user':
      return 'You'
    case 'assistant':
      return 'Crescent'
    case 'error':
      return 'Error'
    case 'tool':
      return 'Tool'
    case 'command':
      return 'Command'
    case 'plan':
      return 'Plan'
    case 'thought':
      return 'Thought'
    default:
      return 'System'
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

function formatConnectionTarget(connection: ConnectionConfig): string {
  const user = connection.user ? `${connection.user}@` : ''
  const port = connection.port ? `:${connection.port}` : ''

  return `${user}${connection.host}${port}`
}

function mergeConnectionInput(
  saved: ConnectionConfig | undefined,
  fallback: ConnectionConfig
): ConnectionConfig {
  return {
    ...fallback,
    ...saved,
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

function buildConnectionCommands(connection: ConnectionConfig): string[] {
  if (!connection.host) return []

  return [buildSshCommand(connection), ...(connection.actions ?? [])]
}

async function runConnectionCommandSequence(
  commands: string[],
  tabId: string,
  appendLog: (entry: Omit<AgentLogEntry, 'id' | 'createdAt'>, tabId?: string) => void
): Promise<void> {
  const [sshCommand, ...loginActions] = commands
  if (!sshCommand) return

  window.api.terminal.pasteCommand(sshCommand, true, tabId)
  appendLog({ kind: 'command', text: `Executed: ${sshCommand}` }, tabId)

  for (let index = 0; index < loginActions.length; index += 1) {
    const action = loginActions[index]
    const ready = await waitForTerminalIdle(tabId)
    if (!ready) {
      appendLog(
        {
          kind: 'error',
          text: `Timed out waiting for terminal output to settle before login action ${index + 1}. Automatic login actions stopped.`
        },
        tabId
      )
      return
    }

    sendTerminalInput(action, tabId)
    appendLog(
      {
        kind: 'command',
        text: formatConnectionActionLog(action, index + 1)
      },
      tabId
    )
  }
}

function waitForTerminalIdle(tabId: string, idleMs = 900, timeoutMs = 30_000): Promise<boolean> {
  return new Promise((resolve) => {
    let receivedData = false
    let settled = false
    let idleTimer: number | undefined
    const timeout = window.setTimeout(() => settle(false), timeoutMs)

    const unsubscribe = window.api.terminal.onData((event) => {
      if (event.tabId !== tabId) return

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

function sendTerminalInput(value: string, tabId: string): void {
  window.api.terminal.write(`${value}\r`, tabId)
}

function formatConnectionActionLog(command: string, actionIndex: number): string {
  return `Typed login action ${actionIndex}: ${maskPotentialSecret(command)}`
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

function MarkdownContent({ value }: { value: string }): React.JSX.Element {
  return <div className="select-text space-y-2 leading-relaxed">{renderMarkdownBlocks(value)}</div>
}

function renderMarkdownBlocks(value: string): React.ReactNode[] {
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  const nodes: React.ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^```(\w+)?\s*$/)
    if (fence) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      index += 1
      nodes.push(
        <pre
          key={nodes.length}
          className="overflow-auto rounded-md border bg-[#111111] p-3 font-mono text-xs leading-relaxed text-zinc-100"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
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
        <div key={nodes.length} className={className}>
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
          className="border-l-2 border-border pl-3 text-muted-foreground"
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
        <ul key={nodes.length} className="list-disc space-y-1 pl-5">
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
        <ol key={nodes.length} className="list-decimal space-y-1 pl-5">
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
      <p key={nodes.length} className="break-words">
        {renderInlineMarkdown(paragraphLines.join(' '))}
      </p>
    )
  }

  return nodes
}

function isMarkdownBlockStart(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^(#{1,4})\s+/.test(line) ||
    /^>\s+/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line)
  )
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
        <code key={nodes.length} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
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
            className="text-cyan-300 underline underline-offset-2"
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

export default App
