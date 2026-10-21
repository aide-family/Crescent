import { terminalClient } from '@renderer/clients'
import type { AttentionNotifyOptions } from '@renderer/lib/pending-attention-notify'
import type { Dictionary } from '@renderer/i18n'
import { type PasswordPromptRequest } from '@renderer/components/AppModals'
import { type ComposerInputHandle } from '@renderer/components/ComposerEditor'
import { sendTerminalInput } from '@renderer/lib/app-controller-support'
import { decideRootPasswordAutofill } from '@renderer/lib/root-password-autofill'
import { resolveSessionChatTabId, type AgentTerminalTab } from '@renderer/lib/terminal-tabs'
import {
  extractPasswordPromptLine,
  isTerminalCurrentlyAtPasswordPrompt
} from '@renderer/lib/terminal-text'
import type { RefObject } from 'react'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { type ConnectionConfig } from '../../../shared/agent-types'

interface Parameters {
  agentInputRef: RefObject<ComposerInputHandle | null>
  automatedLoginTabsRef: RefObject<Set<string>>
  tabsRef: RefObject<AgentTerminalTab[]>
  connectionsRef: RefObject<ConnectionConfig[]>
  pendingAttentionNotifierRef: RefObject<{
    notifyIfUnfocused: (
      pendingId: string,
      title: string,
      body: string,
      options?: AttentionNotifyOptions
    ) => void
    notifyRunComplete: (
      runId: string,
      title: string,
      body: string,
      options?: Omit<AttentionNotifyOptions, 'runId'>
    ) => void
    clear: (pendingId: string) => void
    clearApproval: (requestId: string) => void
    clearRunAttention: (runId: string) => void
    clearAll: () => void
  }>
  t: Dictionary
  activeTabIdRef: RefObject<string>
}

export function usePasswordPrompt({
  agentInputRef,
  automatedLoginTabsRef,
  tabsRef,
  connectionsRef,
  pendingAttentionNotifierRef,
  t,
  activeTabIdRef
}: Parameters) {
  const passwordPromptsByTabRef = useRef(new Map<string, PasswordPromptRequest>())

  const [passwordAttentionTabIds, setPasswordAttentionTabIds] = useState<string[]>([])

  const passwordPromptInputRef = useRef<HTMLInputElement | null>(null)

  const passwordPromptBuffersRef = useRef(new Map<string, string>())

  const passwordPromptOpenTabsRef = useRef(new Set<string>())

  const rootPasswordAutoSubmittedTabsRef = useRef(new Set<string>())

  const passwordPromptRequestRef = useRef<PasswordPromptRequest | null>(null)

  const passwordFocusTabIdRef = useRef<string | null>(null)

  const [passwordPromptRequest, setPasswordPromptRequest] = useState<PasswordPromptRequest | null>(
    null
  )

  const [passwordPromptValue, setPasswordPromptValue] = useState('')

  const [passwordPromptError, setPasswordPromptError] = useState('')

  useEffect(() => {
    if (!passwordPromptRequest) {
      passwordFocusTabIdRef.current = null
      return
    }

    passwordPromptRequestRef.current = passwordPromptRequest
    if (passwordFocusTabIdRef.current === passwordPromptRequest.tabId) return
    passwordFocusTabIdRef.current = passwordPromptRequest.tabId
    agentInputRef.current?.blur()
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.closest('.app-composer-body')) {
      focused.blur()
    }
    window.requestAnimationFrame(() => {
      const input = passwordPromptInputRef.current
      if (!input || document.activeElement === input) return
      input.focus()
    })
  }, [agentInputRef, passwordPromptRequest])

  const maybeRequestTerminalPassword = useCallback(
    (tabId: string, data: string): void => {
      const nextBuffer = `${passwordPromptBuffersRef.current.get(tabId) ?? ''}${data}`.slice(-4000)
      passwordPromptBuffersRef.current.set(tabId, nextBuffer)

      const promptLine = extractPasswordPromptLine(nextBuffer)
      if (!promptLine) {
        rootPasswordAutoSubmittedTabsRef.current.delete(tabId)
        return
      }
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

      const connection = tab.connectionId
        ? connectionsRef.current.find((item) => item.id === tab.connectionId)
        : undefined
      const autofill = decideRootPasswordAutofill({
        rootPassword: connection?.rootPassword,
        alreadyAttempted: rootPasswordAutoSubmittedTabsRef.current.has(tabId),
        isAutomatedLogin: false,
        promptLine
      })
      if (autofill.action === 'auto-submit') {
        rootPasswordAutoSubmittedTabsRef.current.add(tabId)
        passwordPromptBuffersRef.current.set(tabId, '')
        sendTerminalInput(autofill.password, tabId)
        return
      }

      passwordPromptOpenTabsRef.current.add(tabId)
      const request = {
        tabId,
        title: tab.title,
        prompt: promptLine
      }
      passwordPromptsByTabRef.current.set(tabId, request)
      setPasswordAttentionTabIds((current) =>
        current.includes(tabId) ? current : [...current, tabId]
      )
      passwordPromptBuffersRef.current.set(tabId, '')

      const chatTabId = resolveSessionChatTabId(tabsRef.current, tabId)
      if (!passwordPromptRequestRef.current) {
        passwordPromptRequestRef.current = request
        setPasswordPromptValue('')
        setPasswordPromptError('')
        setPasswordPromptRequest(request)
        pendingAttentionNotifierRef.current.notifyIfUnfocused(
          `password:${tabId}`,
          t.notifications.passwordTitle,
          t.notifications.passwordBody,
          { tabId, chatTabId }
        )
        return
      }

      const activeSession = resolveSessionChatTabId(
        tabsRef.current,
        passwordPromptRequestRef.current.tabId
      )
      const requestSession = chatTabId
      // Prefer keeping the currently shown prompt; queue others by tab until it closes.
      if (activeSession === requestSession && passwordPromptRequestRef.current.tabId === tabId) {
        passwordPromptRequestRef.current = request
        setPasswordPromptRequest(request)
      }
    },
    [
      automatedLoginTabsRef,
      connectionsRef,
      pendingAttentionNotifierRef,
      t.notifications.passwordBody,
      t.notifications.passwordTitle,
      tabsRef
    ]
  )

  useEffect(() => {
    return terminalClient.onData((event) => {
      maybeRequestTerminalPassword(event.tabId, event.data)
    })
  }, [maybeRequestTerminalPassword])

  async function submitPasswordPrompt(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!passwordPromptRequest) return

    const context = await terminalClient.getContext(passwordPromptRequest.tabId)
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
    rootPasswordAutoSubmittedTabsRef.current.delete(passwordPromptRequest.tabId)
    pendingAttentionNotifierRef.current.clear(`password:${passwordPromptRequest.tabId}`)
    setPasswordAttentionTabIds((current) =>
      current.filter((id) => id !== passwordPromptRequest.tabId)
    )
    setPasswordPromptValue('')
    setPasswordPromptError('')
    showNextPasswordPrompt(passwordPromptRequest.tabId)
  }

  function cancelPasswordPrompt(): void {
    if (passwordPromptRequest) {
      passwordPromptBuffersRef.current.set(passwordPromptRequest.tabId, '')
      passwordPromptOpenTabsRef.current.delete(passwordPromptRequest.tabId)
      passwordPromptsByTabRef.current.delete(passwordPromptRequest.tabId)
      rootPasswordAutoSubmittedTabsRef.current.delete(passwordPromptRequest.tabId)
      pendingAttentionNotifierRef.current.clear(`password:${passwordPromptRequest.tabId}`)
      setPasswordAttentionTabIds((current) =>
        current.filter((id) => id !== passwordPromptRequest.tabId)
      )
    }
    setPasswordPromptValue('')
    setPasswordPromptError('')
    showNextPasswordPrompt(passwordPromptRequest?.tabId)
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
  return {
    passwordPromptsByTabRef,
    passwordAttentionTabIds,
    setPasswordAttentionTabIds,
    passwordPromptInputRef,
    passwordPromptBuffersRef,
    passwordPromptOpenTabsRef,
    rootPasswordAutoSubmittedTabsRef,
    passwordPromptRequestRef,
    passwordFocusTabIdRef,
    passwordPromptRequest,
    setPasswordPromptRequest,
    passwordPromptValue,
    setPasswordPromptValue,
    passwordPromptError,
    setPasswordPromptError,
    maybeRequestTerminalPassword,
    submitPasswordPrompt,
    cancelPasswordPrompt,
    showNextPasswordPrompt
  }
}
