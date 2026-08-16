import { ipcMain, type WebContents } from 'electron'

import {
  deleteAgentLogs,
  deleteOpsHistoryRecord,
  deleteSessionHistory,
  getAgentLog,
  getAgentRun,
  getOpsHistoryByRunId,
  listAgentRunsForTab,
  listAllAgentRunsForTab,
  getSessionTokenUsage,
  listAgentLogs,
  countAgentLogs,
  listOpsHistoryForConnection,
  listSessionHistory,
  readSessionLogsForSummary,
  readSessionHistoryDetail,
  renameSessionHistory,
  saveAgentLog,
  saveAgentRun,
  saveSessionTabs,
  updateAgentLog,
  updateOpsHistoryRecord,
  updateSessionHistorySummary,
  upsertOpsHistoryRecord
} from '../crescent-sqlite'
import { AgentBrain } from '../agent/brain'
import { buildOpsFeedbackSummarizeSource, parseOpsFeedbackSummary } from '../agent/ops-history'
import { readAgentConfig } from '../crescent-store'
import { safeWebContentsSend } from '../safe-ipc-send'
import { resolveOpsConnectionId } from '../../shared/local-connection'
import type {
  OpsHistoryRating,
  StoredAgentLogEntry,
  StoredAgentRun,
  StoredSessionSummaryUpdate,
  StoredSessionTab,
  SubmitOpsFeedbackInput,
  SubmitOpsFeedbackResult,
  UpdateOpsFeedbackInput,
  UpdateOpsFeedbackResult
} from '../agent/types'

const pendingSessionSummaryTimers = new Map<string, NodeJS.Timeout>()

export function registerStorageIpc(): void {
  ipcMain.handle('storage:save-tabs', (_, tabs: StoredSessionTab[]) => {
    saveSessionTabs(tabs)
    return { ok: true }
  })

  ipcMain.handle('storage:save-agent-log', (event, entry: StoredAgentLogEntry) => {
    saveAgentLog(entry)
    scheduleSessionSummary(entry.tabId, event.sender)
    return { ok: true }
  })

  ipcMain.handle(
    'storage:update-agent-log',
    (event, input: Pick<StoredAgentLogEntry, 'tabId' | 'logId' | 'text'>) => {
      updateAgentLog(input)
      scheduleSessionSummary(input.tabId, event.sender)
      return { ok: true }
    }
  )

  ipcMain.handle(
    'storage:delete-agent-logs',
    (event, input: { tabId?: string; logIds?: number[] }) => {
      const tabId = input?.tabId?.trim() ?? ''
      const logIds = Array.isArray(input?.logIds) ? input.logIds : []
      const removed = deleteAgentLogs(tabId, logIds)
      if (removed > 0 && tabId) scheduleSessionSummary(tabId, event.sender)
      return { ok: true, removed }
    }
  )

  ipcMain.handle('storage:save-agent-run', (_, run: StoredAgentRun) => {
    saveAgentRun(run)
    return { ok: true }
  })

  ipcMain.handle('storage:get-agent-run', (_, runId: string) => {
    return getAgentRun(runId ?? '')
  })

  ipcMain.handle('storage:list-agent-runs', (_, payload?: { tabId?: string; limit?: number }) => {
    return listAgentRunsForTab(payload?.tabId ?? '', payload?.limit)
  })

  ipcMain.handle('storage:list-all-agent-runs', (_, tabId?: string) => {
    return listAllAgentRunsForTab(typeof tabId === 'string' ? tabId : '')
  })

  ipcMain.handle('storage:get-session-token-usage', (_, tabId?: string) => {
    return getSessionTokenUsage(typeof tabId === 'string' ? tabId : '')
  })

  ipcMain.handle('storage:get-agent-log', (_, payload?: { tabId?: string; logId?: number }) => {
    const tabId = payload?.tabId?.trim() ?? ''
    const logId = typeof payload?.logId === 'number' ? payload.logId : Number.NaN
    return getAgentLog(tabId, logId)
  })

  ipcMain.handle(
    'storage:list-agent-logs',
    (_, payload?: { tabId?: string; beforeLogId?: number; limit?: number }) => {
      return listAgentLogs(payload?.tabId ?? '', {
        beforeLogId: payload?.beforeLogId,
        limit: payload?.limit
      })
    }
  )

  ipcMain.handle('storage:count-agent-logs', (_, tabId?: string) => {
    return countAgentLogs(tabId ?? '')
  })

  ipcMain.handle('storage:list-session-history', (_, limit?: number) => {
    return listSessionHistory(limit)
  })

  ipcMain.handle('storage:get-session-history', (_, tabId: string) => {
    return readSessionHistoryDetail(tabId)
  })

  ipcMain.handle('storage:delete-session-history', (_, tabId: string) => {
    return { ok: deleteSessionHistory(tabId ?? '') }
  })

  ipcMain.handle(
    'storage:rename-session-history',
    (_, payload: { tabId?: string; title?: string }) => {
      return { ok: renameSessionHistory(payload?.tabId ?? '', payload?.title ?? '') }
    }
  )

  ipcMain.handle(
    'storage:submit-ops-feedback',
    async (_, payload: SubmitOpsFeedbackInput): Promise<SubmitOpsFeedbackResult> => {
      return submitOpsFeedback(payload)
    }
  )

  ipcMain.handle('storage:get-ops-feedback', (_, runId: string) => {
    return getOpsHistoryByRunId(runId ?? '')
  })

  ipcMain.handle(
    'storage:list-ops-feedback',
    (_, payload?: { connectionId?: string; tabId?: string; limit?: number }) => {
      return listOpsHistoryForConnection(
        resolveOpsConnectionId(payload?.connectionId),
        payload?.limit
      )
    }
  )

  ipcMain.handle(
    'storage:update-ops-feedback',
    (_, payload: UpdateOpsFeedbackInput): UpdateOpsFeedbackResult => {
      const id = payload?.id?.trim() ?? ''
      if (!id) return { ok: false, error: 'Invalid ops feedback id.' }

      const record = updateOpsHistoryRecord({
        id,
        rating: payload.rating,
        userGoal: payload.userGoal,
        pathSummary: payload.pathSummary,
        lesson: payload.lesson
      })
      if (!record) return { ok: false, error: 'Ops feedback not found or invalid.' }
      return { ok: true, record }
    }
  )

  ipcMain.handle('storage:delete-ops-feedback', (_, id: string) => {
    return { ok: deleteOpsHistoryRecord(id ?? '') }
  })
}

async function submitOpsFeedback(
  payload: SubmitOpsFeedbackInput
): Promise<SubmitOpsFeedbackResult> {
  const tabId = payload?.tabId?.trim() ?? ''
  const runId = payload?.runId?.trim() ?? ''
  const rating = payload?.rating
  if (!tabId || !runId || (rating !== 'like' && rating !== 'dislike')) {
    return { ok: false, error: 'Invalid ops feedback payload.' }
  }

  const run = getAgentRun(runId)
  if (!run) return { ok: false, error: 'Agent run not found.' }
  if (run.tabId !== tabId) return { ok: false, error: 'Run does not belong to this session.' }

  const connectionId = resolveOpsConnectionId(payload.connectionId || run.connectionId)

  const existing = getOpsHistoryByRunId(runId)
  if (existing) {
    if (existing.rating !== rating) {
      return {
        ok: false,
        error: 'Ops feedback already rated; like and dislike are mutually exclusive.'
      }
    }
    if (existing.connectionId === connectionId && existing.pathSummary.trim()) {
      return { ok: true, record: existing }
    }
  }

  try {
    const summarized = await summarizeOpsFeedback(run, rating)
    const record = upsertOpsHistoryRecord({
      id: existing?.id ?? `ops-${crypto.randomUUID()}`,
      tabId,
      connectionId,
      runId,
      rating,
      userGoal: run.input.trim().slice(0, 500),
      pathSummary: summarized.pathSummary,
      lesson: summarized.lesson
    })
    if (!record) return { ok: false, error: 'Failed to persist ops feedback.' }
    return { ok: true, record }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function summarizeOpsFeedback(
  run: StoredAgentRun,
  rating: OpsHistoryRating
): Promise<{ pathSummary: string; lesson: string }> {
  const source = buildOpsFeedbackSummarizeSource(run)
  const completion = await new AgentBrain(readAgentConfig()).chat({
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: [
          'You distill a Crescent ops run into a short path reference for the SAME connection/terminal (SSH when connected, otherwise local terminal).',
          'This is NOT an SOP or wiki document — only a concise ops path + lesson for later guidance.',
          'Return strict JSON only: {"pathSummary":"...","lesson":"..."}.',
          'pathSummary: concise ordered ops path (what was checked/changed and in what order).',
          rating === 'like'
            ? 'lesson: why this approach is a good reference for similar future goals on this connection/terminal.'
            : 'lesson: why this approach failed or should be avoided as a cautionary example on this connection/terminal.',
          'Use the same natural language as the user goal. Keep pathSummary under 80 words and lesson under 40 words.'
        ].join('\n')
      },
      {
        role: 'user',
        content: `Rating: ${rating}\n\n${source}`
      }
    ]
  })

  const parsed = parseOpsFeedbackSummary(completion.choices[0]?.message.content ?? '')
  if (parsed) return parsed

  return {
    pathSummary: (run.trace?.resultSummary || run.output || run.input).trim().slice(0, 1200),
    lesson:
      rating === 'like'
        ? 'User marked this ops path as a positive reference for this connection/terminal.'
        : 'User marked this ops path as a cautionary example for this connection/terminal.'
  }
}

function scheduleSessionSummary(tabId: string, webContents: WebContents): void {
  const normalizedTabId = tabId.trim()
  if (!normalizedTabId) return

  const existing = pendingSessionSummaryTimers.get(normalizedTabId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    pendingSessionSummaryTimers.delete(normalizedTabId)
    void summarizeSessionHistory(normalizedTabId, webContents)
  }, 2500)
  pendingSessionSummaryTimers.set(normalizedTabId, timer)
}

async function summarizeSessionHistory(tabId: string, webContents: WebContents): Promise<void> {
  const logs = readSessionLogsForSummary(tabId)
    .filter(
      (entry) => entry.kind === 'user' || entry.kind === 'assistant' || entry.kind === 'error'
    )
    .slice(-80)

  if (logs.length === 0) return

  const transcript = logs
    .map((entry) => `${entry.kind}: ${entry.text}`)
    .join('\n')
    .slice(0, 12000)

  try {
    const completion = await new AgentBrain(readAgentConfig()).chat({
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Summarize this Crescent chat session. Return strict JSON only: {"title":"...","summary":"..."}. Title <= 40 chars. Summary <= 180 chars.'
        },
        { role: 'user', content: transcript }
      ]
    })
    const parsed = parseSessionSummary(completion.choices[0]?.message.content ?? '')
    if (!parsed) return

    const updated = updateSessionHistorySummary({
      tabId,
      title: parsed.title,
      summary: parsed.summary
    })
    if (!updated.ok) return

    const event: StoredSessionSummaryUpdate = {
      tabId,
      title: updated.title,
      summary: updated.summary,
      updatedAt: updated.updatedAt
    }
    safeWebContentsSend(webContents, 'storage:session-summary-updated', event)
  } catch {
    // History summaries are best-effort and should not interrupt chat or terminal work.
  }
}

function parseSessionSummary(content: string): { title: string; summary: string } | undefined {
  try {
    const parsed = JSON.parse(content) as { title?: unknown; summary?: unknown }
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
    if (title && summary) return { title: title.slice(0, 80), summary: summary.slice(0, 260) }
  } catch {
    // fall through
  }

  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return undefined

  return {
    title: lines[0].slice(0, 80),
    summary: lines.slice(1).join(' ').slice(0, 260)
  }
}
