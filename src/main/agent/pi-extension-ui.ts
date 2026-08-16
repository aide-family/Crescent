import type { WebContents } from 'electron'
import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'

import { safeWebContentsSend } from '../safe-ipc-send'
import type {
  AgentEvent,
  ExtensionUiDecision,
  ExtensionUiNotifyType,
  ExtensionUiRequest
} from './types'

const DEFAULT_DIALOG_TIMEOUT_MS = 60_000

export interface ExtensionUiBinding {
  webContents: WebContents
  runId?: string
  tabId?: string
  emit?: (event: AgentEvent) => void
}

interface PendingExtensionUi {
  request: ExtensionUiRequest
  webContents: WebContents
  resolve: (decision: ExtensionUiDecision) => void
  timeout: NodeJS.Timeout
}

const bindingsBySessionKey = new Map<string, ExtensionUiBinding>()
const pendingUi = new Map<string, PendingExtensionUi>()

export function setExtensionUiBinding(sessionKey: string, binding: ExtensionUiBinding): void {
  bindingsBySessionKey.set(sessionKey, binding)
}

export function clearExtensionUiBinding(sessionKey: string): void {
  bindingsBySessionKey.delete(sessionKey)
}

export function rejectPendingExtensionUiForRun(
  runId: string,
  rejectionReason = 'Agent run was canceled.'
): void {
  for (const [requestId, pending] of [...pendingUi.entries()]) {
    if (pending.request.runId !== runId) continue
    settleExtensionUiDecision(
      requestId,
      { requestId, cancelled: true },
      { reason: rejectionReason }
    )
  }
}

export function rejectPendingExtensionUiForTab(
  tabId: string,
  rejectionReason = 'Session was closed.'
): void {
  for (const [requestId, pending] of [...pendingUi.entries()]) {
    if (pending.request.tabId !== tabId) continue
    settleExtensionUiDecision(
      requestId,
      { requestId, cancelled: true },
      { reason: rejectionReason }
    )
  }
}

export function resolveExtensionUiDecision(decision: ExtensionUiDecision): { ok: boolean } {
  const requestId = decision?.requestId?.trim()
  if (!requestId) return { ok: false }
  return { ok: settleExtensionUiDecision(requestId, decision) }
}

export function resetExtensionUiForTests(): void {
  bindingsBySessionKey.clear()
  for (const [requestId, pending] of [...pendingUi.entries()]) {
    clearTimeout(pending.timeout)
    pendingUi.delete(requestId)
    pending.resolve({ requestId, cancelled: true })
  }
}

export function createCrescentExtensionUi(sessionKey: string): ExtensionUIContext {
  const dialog = <T>(
    buildRequest: (id: string, binding: ExtensionUiBinding) => ExtensionUiRequest,
    readValue: (decision: ExtensionUiDecision) => T,
    fallback: T,
    opts?: { signal?: AbortSignal; timeout?: number }
  ): Promise<T> => {
    const binding = bindingsBySessionKey.get(sessionKey)
    if (!binding || binding.webContents.isDestroyed()) return Promise.resolve(fallback)

    const requestId = `ext-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const request = buildRequest(requestId, binding)
    const timeoutMs = opts?.timeout && opts.timeout > 0 ? opts.timeout : DEFAULT_DIALOG_TIMEOUT_MS

    return new Promise((resolve) => {
      const finish = (decision: ExtensionUiDecision): void => {
        opts?.signal?.removeEventListener('abort', onAbort)
        resolve(readValue(decision))
      }
      const timeout = setTimeout(() => {
        settleExtensionUiDecision(requestId, { requestId, cancelled: true })
      }, timeoutMs)
      const onAbort = (): void => {
        settleExtensionUiDecision(requestId, { requestId, cancelled: true })
      }

      pendingUi.set(requestId, {
        request,
        webContents: binding.webContents,
        resolve: finish,
        timeout
      })
      opts?.signal?.addEventListener('abort', onAbort, { once: true })
      if (opts?.signal?.aborted) {
        onAbort()
        return
      }
      safeWebContentsSend(binding.webContents, 'agent:extension-ui-request', request)
    })
  }

  return {
    select: (title, options, opts) =>
      dialog(
        (id, binding) => ({
          id,
          method: 'select',
          title,
          options,
          timeoutMs: opts?.timeout,
          runId: binding.runId,
          tabId: binding.tabId
        }),
        (decision) => (decision.cancelled ? undefined : decision.value),
        undefined,
        opts
      ),
    confirm: (title, message, opts) =>
      dialog(
        (id, binding) => ({
          id,
          method: 'confirm',
          title,
          message,
          timeoutMs: opts?.timeout,
          runId: binding.runId,
          tabId: binding.tabId
        }),
        (decision) => Boolean(decision.confirmed) && !decision.cancelled,
        false,
        opts
      ),
    input: (title, placeholder, opts) =>
      dialog(
        (id, binding) => ({
          id,
          method: 'input',
          title,
          placeholder,
          timeoutMs: opts?.timeout,
          runId: binding.runId,
          tabId: binding.tabId
        }),
        (decision) => (decision.cancelled ? undefined : decision.value),
        undefined,
        opts
      ),
    editor: (title, prefill) =>
      dialog(
        (id, binding) => ({
          id,
          method: 'editor',
          title,
          prefill,
          runId: binding.runId,
          tabId: binding.tabId
        }),
        (decision) => (decision.cancelled ? undefined : decision.value),
        undefined
      ),
    notify: (message, type) => {
      const binding = bindingsBySessionKey.get(sessionKey)
      if (!binding || binding.webContents.isDestroyed()) return
      const request: ExtensionUiRequest = {
        id: `ext-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        method: 'notify',
        message,
        notifyType: normalizeNotifyType(type),
        runId: binding.runId,
        tabId: binding.tabId
      }
      safeWebContentsSend(binding.webContents, 'agent:extension-ui-request', request)
    },
    onTerminalInput: () => () => {},
    setStatus: (key, text) => {
      const binding = bindingsBySessionKey.get(sessionKey)
      if (!text?.trim() || !binding?.emit) return
      binding.emit({
        type: 'status',
        message: `[${key}] ${text}`,
        runId: binding.runId,
        tabId: binding.tabId
      })
    },
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: async () => undefined,
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => '',
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    theme: stubTheme(),
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Themes are not available in Crescent.' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {}
  } as ExtensionUIContext
}

function settleExtensionUiDecision(
  requestId: string,
  decision: ExtensionUiDecision,
  options?: { reason?: string }
): boolean {
  const pending = pendingUi.get(requestId)
  if (!pending) return false
  clearTimeout(pending.timeout)
  pendingUi.delete(requestId)
  if (!pending.webContents.isDestroyed()) {
    safeWebContentsSend(pending.webContents, 'agent:extension-ui-dismiss', {
      requestId,
      runId: pending.request.runId
    })
  }
  void options
  pending.resolve({ ...decision, requestId })
  return true
}

function normalizeNotifyType(type?: string): ExtensionUiNotifyType {
  if (type === 'warning' || type === 'error') return type
  return 'info'
}

function stubTheme(): ExtensionUIContext['theme'] {
  const passthrough = (_color: unknown, text: string): string => text
  return {
    name: 'crescent',
    fg: passthrough,
    bg: passthrough,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    inverse: (text: string) => text,
    strikethrough: (text: string) => text,
    getFgAnsi: () => '',
    getBgAnsi: () => '',
    getColorMode: () => 'truecolor',
    getThinkingBorderColor: () => (text: string) => text,
    getBashModeBorderColor: () => (text: string) => text
  } as unknown as ExtensionUIContext['theme']
}
