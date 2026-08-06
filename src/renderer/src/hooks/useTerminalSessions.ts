import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

import { formatReadableSubterminalOutput, getSubterminalWidths } from '@renderer/lib/terminal-text'
import type { AgentTerminalTab, TemporarySubterminal } from '@renderer/lib/terminal-tabs'

interface UseTerminalSessionsInput {
  tabsRef: MutableRefObject<AgentTerminalTab[]>
  setTabs: Dispatch<SetStateAction<AgentTerminalTab[]>>
}

export function useTerminalSessions({ tabsRef, setTabs }: UseTerminalSessionsInput): {
  updateTab: (tabId: string, updater: (tab: AgentTerminalTab) => AgentTerminalTab) => void
  updateSubterminalOutput: (parentTabId: string, name: string, id: string, data: string) => void
  updateSubterminalCwd: (parentTabId: string, name: string, id: string, cwd: string) => void
  updateSubterminalStatus: (
    parentTabId: string,
    name: string,
    id: string,
    status: TemporarySubterminal['status']
  ) => void
  ensureSubterminal: (parentTabId: string, subterminal: TemporarySubterminal) => void
  closeSubterminal: (parentTabId: string, subterminalId: string) => void
  closeAllSubterminals: (parentTabId: string) => void
  resizeSubterminalPair: (
    tabId: string,
    leftId: string,
    rightId: string,
    leftWidth: number,
    rightWidth: number
  ) => void
} {
  const updateTab = useCallback(
    (tabId: string, updater: (tab: AgentTerminalTab) => AgentTerminalTab): void => {
      setTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)))
    },
    [setTabs]
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
          status: 'active',
          terminalReady: true
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

  const ensureSubterminal = useCallback(
    (
      parentTabId: string,
      subterminal: TemporarySubterminal
    ): void => {
      upsertSubterminal(parentTabId, subterminal.name, subterminal.id, (current) => ({
        ...current,
        ...subterminal,
        output: subterminal.output || current.output,
        rawOutput: subterminal.rawOutput || current.rawOutput
      }))
    },
    [upsertSubterminal]
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
    [tabsRef, updateTab]
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

  return {
    updateTab,
    updateSubterminalOutput,
    updateSubterminalCwd,
    updateSubterminalStatus,
    ensureSubterminal,
    closeSubterminal,
    closeAllSubterminals,
    resizeSubterminalPair
  }
}
