import type { WebContents } from 'electron'

import { safeWebContentsSend } from '../safe-ipc-send'
import type { CommandApprovalDecision, CommandApprovalRequest, CommandAuditResult } from './types'

export interface CommandApprovalDecisionResult {
  approved: boolean
  note?: string
  rejectionReason?: string
}

interface PendingCommandApproval {
  runId: string
  tabId?: string
  chatTabId?: string
  webContents: WebContents
  resolve: (decision: CommandApprovalDecisionResult) => void
  timeout: NodeJS.Timeout
}

const pendingCommandApprovals = new Map<string, PendingCommandApproval>()

export function dismissCommandApprovalRequest(
  webContents: WebContents,
  requestId: string,
  runId: string
): void {
  safeWebContentsSend(webContents, 'agent:command-approval-dismiss', { requestId, runId })
}

export function settlePendingCommandApproval(
  requestId: string,
  decision: CommandApprovalDecisionResult,
  options?: { dismiss?: boolean }
): boolean {
  const pending = pendingCommandApprovals.get(requestId)
  if (!pending) return false

  clearTimeout(pending.timeout)
  pendingCommandApprovals.delete(requestId)
  if (options?.dismiss !== false) {
    dismissCommandApprovalRequest(pending.webContents, requestId, pending.runId)
  }
  pending.resolve(decision)
  return true
}

export function rejectPendingApprovalsForRun(
  runId: string,
  rejectionReason = 'Agent run was canceled.'
): void {
  for (const [requestId, pending] of [...pendingCommandApprovals.entries()]) {
    if (pending.runId !== runId) continue
    settlePendingCommandApproval(requestId, { approved: false, rejectionReason })
  }
}

export function rejectPendingApprovalsForTab(
  tabId: string,
  rejectionReason = 'Session was closed.'
): void {
  for (const [requestId, pending] of [...pendingCommandApprovals.entries()]) {
    if (pending.tabId !== tabId && pending.chatTabId !== tabId) continue
    settlePendingCommandApproval(requestId, { approved: false, rejectionReason })
  }
}

export function resolveCommandApprovalDecision(decision: CommandApprovalDecision): { ok: boolean } {
  const requestId = decision?.requestId?.trim()
  if (!requestId) return { ok: false }
  const settled = settlePendingCommandApproval(
    requestId,
    {
      approved: Boolean(decision.approved),
      note: typeof decision.note === 'string' ? decision.note : undefined,
      rejectionReason:
        typeof decision.rejectionReason === 'string' ? decision.rejectionReason : undefined
    },
    { dismiss: true }
  )
  return { ok: settled }
}

export function requestCommandApproval(input: {
  webContents: WebContents
  runId: string
  tabId?: string
  chatTabId?: string
  command: string
  timeoutMs?: number
  audit: CommandAuditResult
  signal?: AbortSignal
}): Promise<CommandApprovalDecisionResult> {
  if (input.webContents.isDestroyed()) return Promise.resolve({ approved: false })

  const requestId = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const request: CommandApprovalRequest = {
    id: requestId,
    runId: input.runId,
    tabId: input.tabId,
    chatTabId: input.chatTabId,
    command: input.command,
    timeoutMs: input.timeoutMs,
    audit: input.audit
  }

  return new Promise((resolve) => {
    const finish = (decision: CommandApprovalDecisionResult): void => {
      input.signal?.removeEventListener('abort', onAbort)
      resolve(decision)
    }
    const timeout = setTimeout(
      () => {
        settlePendingCommandApproval(requestId, { approved: false })
      },
      60 * 1000
    )
    const onAbort = (): void => {
      settlePendingCommandApproval(requestId, {
        approved: false,
        rejectionReason: 'Agent run was canceled.'
      })
    }

    pendingCommandApprovals.set(requestId, {
      runId: input.runId,
      tabId: input.tabId,
      chatTabId: input.chatTabId,
      webContents: input.webContents,
      resolve: finish,
      timeout
    })
    input.signal?.addEventListener('abort', onAbort, { once: true })
    if (input.signal?.aborted) {
      onAbort()
      return
    }
    safeWebContentsSend(input.webContents, 'agent:command-approval-request', request)
  })
}
