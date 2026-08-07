import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

import { formatPipePrompt } from '../lib/app-shell'
import { resolveConnectionReconnectPolicy } from '../lib/connection-automation-policy'
import { appTerminalTheme } from '../lib/design-system'
import {
  handlePipeTerminalInput as applyPipeTerminalInput,
  observeTerminalHostResize,
  type PipeTerminalState
} from '../lib/pipe-terminal'
import { createCrescentBootstrapFilter, filterCrescentBootstrapOutput, parseSubterminalTabId } from '../lib/terminal-text'
import {
  resolveSessionChatTabId,
  type AgentLogEntry,
  type AgentTerminalTab
} from '../lib/terminal-tabs'
import type { ConnectionConfig } from '../../../shared/agent-types'

interface UseXtermLifecycleInput {
  terminalVisible: boolean
  activeTabId: string
  activeTabExists: boolean
  activeTabIdRef: MutableRefObject<string>
  tabsRef: MutableRefObject<AgentTerminalTab[]>
  terminalHostRef: RefObject<HTMLDivElement | null>
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  terminalSessionIdRef: MutableRefObject<number | null>
  terminalModeRef: MutableRefObject<'pty' | 'pipe'>
  terminalCwdRef: MutableRefObject<string>
  pipePromptRef: MutableRefObject<string>
  pendingSshRef: MutableRefObject<Map<string, ConnectionConfig>>
  suppressTerminalReconnectRef: MutableRefObject<Set<string>>
  automatedLoginTabsRef: MutableRefObject<Set<string>>
  passwordPromptBuffersRef: MutableRefObject<Map<string, string>>
  skipConnectionReconnectRef: MutableRefObject<Set<string>>
  restoreTerminalSessionRef: MutableRefObject<((tabId: string) => Promise<boolean>) | null>
  updateTab: (tabId: string, updater: (tab: AgentTerminalTab) => AgentTerminalTab) => void
  updateSubterminalOutput: (parentTabId: string, name: string, id: string, data: string) => void
  updateSubterminalCwd: (parentTabId: string, name: string, id: string, cwd: string) => void
  updateSubterminalStatus: (
    parentTabId: string,
    name: string,
    id: string,
    status: 'active' | 'exited'
  ) => void
  executeConnectionCommands: (connection: ConnectionConfig, targetTabId: string) => Promise<void>
  abortPostConnectionTasks: (tabId: string, reason: string) => void
  appendLog: (entry: Omit<AgentLogEntry, 'id' | 'createdAt'>, tabId?: string) => number | void
  shellExitedText: string
  failedToStartShellText: string
  postLoginTaskAbortedText: string
}

export function useXtermLifecycle({
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
  shellExitedText,
  failedToStartShellText,
  postLoginTaskAbortedText
}: UseXtermLifecycleInput): {
  handlePipeTerminalInput: (terminal: Terminal, data: string) => void
} {
  const pipeStateRef = useRef<PipeTerminalState>({
    inputBuffer: '',
    cursor: 0,
    history: [],
    historyIndex: null,
    prompt: '',
    cwd: ''
  })

  const syncPipeContext = useCallback((): PipeTerminalState => {
    const state = pipeStateRef.current
    return {
      ...state,
      prompt: pipePromptRef.current,
      cwd: terminalCwdRef.current
    }
  }, [pipePromptRef, terminalCwdRef])

  const handlePipeTerminalInput = useCallback(
    (terminal: Terminal, data: string): void => {
      const next = applyPipeTerminalInput(terminal, syncPipeContext(), data, activeTabIdRef.current)
      pipeStateRef.current = next
      pipePromptRef.current = next.prompt
      terminalCwdRef.current = next.cwd
    },
    [activeTabIdRef, pipePromptRef, syncPipeContext, terminalCwdRef]
  )

  useEffect(() => {
    if (!terminalVisible) return

    const host = terminalHostRef.current
    if (!host) return
    const tab = tabsRef.current.find((candidate) => candidate.id === activeTabId)
    if (!tab) {
      // Tab list may still be catching up after /new; retry on next tabs sync.
      return
    }

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

    if (tab.terminalOutput) terminal.write(filterCrescentBootstrapOutput(tab.terminalOutput))

    const bootstrapFilter = createCrescentBootstrapFilter()
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

      const filtered = bootstrapFilter.push(event.data)
      if (!filtered) return

      updateTab(event.tabId, (current) => ({
        ...current,
        terminalOutput: `${current.terminalOutput}${filtered}`.slice(-200_000)
      }))
      if (event.tabId === activeTabIdRef.current) terminal.write(filtered)
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
        terminal.writeln(`\r\n\x1b[31m${shellExitedText} ${event.exitCode}.\x1b[0m`)
      }
      const reconnectPolicy = resolveConnectionReconnectPolicy({
        suppressReconnect: suppressTerminalReconnectRef.current.has(event.tabId),
        automatedLoginInProgress: automatedLoginTabsRef.current.has(event.tabId)
      })
      if (reconnectPolicy === 'suppress') {
        suppressTerminalReconnectRef.current.delete(event.tabId)
        return
      }

      // SSH/login died mid-automation — fall back to a local shell instead of
      // immediately re-running the failed connection (which leaves input dead).
      if (reconnectPolicy === 'local-fallback') {
        automatedLoginTabsRef.current.delete(event.tabId)
        passwordPromptBuffersRef.current.set(event.tabId, '')
        const chatTabId = resolveSessionChatTabId(tabsRef.current, event.tabId)
        abortPostConnectionTasks(event.tabId, postLoginTaskAbortedText)
        appendLog(
          {
            kind: 'error',
            text: `${shellExitedText} ${event.exitCode}.`
          },
          chatTabId
        )
        skipConnectionReconnectRef.current.add(event.tabId)
        void restoreTerminalSessionRef.current?.(event.tabId)
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
        tabId: tab.id
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
        // Start a local shell first, then run SSH only after password/env checks pass.
        void executeConnectionCommands(pendingConnection, tab.id)
      }
    }

    void startShell().catch((error) => {
      terminal.writeln(`\r\n\x1b[31m${failedToStartShellText}: ${String(error)}\x1b[0m`)
    })

    const resizeObserver = observeTerminalHostResize(host, fitAddon, tab.id)

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
    abortPostConnectionTasks,
    activeTabExists,
    activeTabId,
    activeTabIdRef,
    appendLog,
    automatedLoginTabsRef,
    executeConnectionCommands,
    failedToStartShellText,
    fitAddonRef,
    handlePipeTerminalInput,
    passwordPromptBuffersRef,
    pendingSshRef,
    pipePromptRef,
    postLoginTaskAbortedText,
    restoreTerminalSessionRef,
    shellExitedText,
    skipConnectionReconnectRef,
    suppressTerminalReconnectRef,
    tabsRef,
    terminalCwdRef,
    terminalHostRef,
    terminalModeRef,
    terminalRef,
    terminalSessionIdRef,
    terminalVisible,
    updateSubterminalCwd,
    updateSubterminalOutput,
    updateSubterminalStatus,
    updateTab
  ])

  return { handlePipeTerminalInput }
}
