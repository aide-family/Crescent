import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from 'react'
import { flushSync } from 'react-dom'

import {
  createTerminalTab,
  getNextTerminalTitle,
  getSessionChatTab,
  getSessionGroupId,
  getSessionTerminals,
  listSessionChatTabs,
  toStoredSessionTabs,
  type AgentTerminalTab
} from '../lib/terminal-tabs'
import type { StoredSessionTab } from '../../../shared/agent-types'

export interface CloseTabPromotionPlan {
  closingTab: AgentTerminalTab | undefined
  groupId: string
  peers: AgentTerminalTab[]
  shouldPromote: boolean
  nextRoot: AgentTerminalTab | undefined
}

/** Compute promotion metadata when closing a tab (agent-run remapping stays in App). */
export function planCloseTabPromotion(
  tabs: AgentTerminalTab[],
  tabId: string
): CloseTabPromotionPlan {
  const closingTab = tabs.find((tab) => tab.id === tabId)
  const groupId = closingTab ? getSessionGroupId(closingTab) : tabId
  const peers = getSessionTerminals(tabs, groupId).filter((tab) => tab.id !== tabId)
  const shouldPromote = Boolean(closingTab && closingTab.id === groupId && peers.length > 0)
  const nextRoot = shouldPromote ? peers[0] : undefined
  return { closingTab, groupId, peers, shouldPromote, nextRoot }
}

/** Move chat ownership from a closing session root onto the next peer. */
export function reassignSessionRootOnClose(
  tabs: AgentTerminalTab[],
  closingTab: AgentTerminalTab,
  nextRoot: AgentTerminalTab,
  groupId: string,
  closingTabId: string
): AgentTerminalTab[] {
  return tabs.map((tab) => {
    if (tab.id === nextRoot.id) {
      return {
        ...tab,
        sessionGroupId: nextRoot.id,
        agentInput: closingTab.agentInput,
        skillRefs: closingTab.skillRefs,
        activeWikiIds: closingTab.activeWikiIds ?? [],
        pathRefs: closingTab.pathRefs,
        toolRefs: closingTab.toolRefs,
        wikiRefs: closingTab.wikiRefs,
        agentBusy: closingTab.agentBusy,
        agentThinking: closingTab.agentThinking,
        thinkingMessage: closingTab.thinkingMessage,
        copiedLogId: closingTab.copiedLogId,
        agentLog: closingTab.agentLog,
        pendingClarification: closingTab.pendingClarification,
        providerId: closingTab.providerId ?? tab.providerId,
        model: closingTab.model ?? tab.model
      }
    }
    if (getSessionGroupId(tab) === groupId && tab.id !== closingTabId) {
      return { ...tab, sessionGroupId: nextRoot.id }
    }
    return tab
  })
}

interface UseTerminalTabsInput {
  tabs: AgentTerminalTab[]
  setTabs: Dispatch<SetStateAction<AgentTerminalTab[]>>
  activeTabId: string
  setActiveTabId: Dispatch<SetStateAction<string>>
  activeTabIdRef: MutableRefObject<string>
  tabsRef: MutableRefObject<AgentTerminalTab[]>
  terminalPage: 'terminal' | 'connections'
  setTerminalPage: Dispatch<SetStateAction<'terminal' | 'connections'>>
  setHiddenPane: Dispatch<SetStateAction<'terminal' | 'chat' | null>>
  emptyLocalTab: AgentTerminalTab
  updateTab: (tabId: string, updater: (tab: AgentTerminalTab) => AgentTerminalTab) => void
  localTerminalTitle: string
  providerId?: string
}

export function useTerminalTabs({
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
  localTerminalTitle,
  providerId
}: UseTerminalTabsInput): {
  activeTab: AgentTerminalTab
  sessionChatTab: AgentTerminalTab
  sessionTerminals: AgentTerminalTab[]
  sessionChatTabs: AgentTerminalTab[]
  terminalTabs: AgentTerminalTab[]
  activeAgentPending: boolean
  selectSessionTab: (tabId: string) => void
  openLocalTerminal: () => void
} {
  // Intentional: keep tabsRef aligned during render and fall back to the ref
  // snapshot during flushSync tab switches (same pattern as prior App.tsx).
  /* eslint-disable react-hooks/refs -- sync tab selection during flushSync transitions */
  tabsRef.current = tabs
  const activeTab =
    tabs.find((tab) => tab.id === activeTabId) ??
    (activeTabIdRef.current === activeTabId
      ? tabsRef.current.find((tab) => tab.id === activeTabId)
      : undefined) ??
    emptyLocalTab
  /* eslint-enable react-hooks/refs */
  const sessionChatTab = getSessionChatTab(tabs, activeTab.id) ?? activeTab
  const sessionTerminals = getSessionTerminals(tabs, getSessionGroupId(activeTab))
  const sessionChatTabs = useMemo(() => listSessionChatTabs(tabs), [tabs])
  const activeAgentPending = sessionChatTab.agentBusy || sessionChatTab.agentThinking
  const terminalTabs = useMemo(
    () =>
      tabs.filter(
        (tab) =>
          terminalPage === 'terminal' || tab.sessionId || tab.terminalOutput || tab.terminalReady
      ),
    [tabs, terminalPage]
  )

  const pendingTabsSaveRef = useRef<{
    key: string
    timer: number
    tabs: StoredSessionTab[]
  } | null>(null)
  const lastSavedTabsKeyRef = useRef('')

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId, activeTabIdRef])

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs, tabsRef])

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

  const selectSessionTab = useCallback(
    (tabId: string): void => {
      activeTabIdRef.current = tabId
      flushSync(() => {
        setActiveTabId(tabId)
        setTerminalPage('terminal')
        setHiddenPane(null)
      })
    },
    [activeTabIdRef, setActiveTabId, setHiddenPane, setTerminalPage]
  )

  const openLocalTerminal = useCallback((): void => {
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
        title: getNextTerminalTitle(localTerminalTitle, tabsRef.current),
        connectionId: undefined,
        connectionName: undefined,
        isSsh: false
      }))
    } else {
      const nextTab = createTerminalTab({
        id: targetTabId,
        title: getNextTerminalTitle(localTerminalTitle, tabsRef.current),
        providerId,
        isSsh: false
      })
      setTabs((current) => [...current, nextTab])
    }

    setActiveTabId(targetTabId)
  }, [
    activeTabIdRef,
    localTerminalTitle,
    providerId,
    setActiveTabId,
    setHiddenPane,
    setTabs,
    setTerminalPage,
    tabsRef,
    updateTab
  ])

  return {
    activeTab,
    sessionChatTab,
    sessionTerminals,
    sessionChatTabs,
    terminalTabs,
    activeAgentPending,
    selectSessionTab,
    openLocalTerminal
  }
}
