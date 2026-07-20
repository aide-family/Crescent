import { ipcMain, type WebContents } from 'electron'

import {
  deleteSessionHistory,
  listSessionHistory,
  readSessionLogsForSummary,
  readSessionHistoryDetail,
  renameSessionHistory,
  saveAgentLog,
  saveAgentRun,
  saveSessionTabs,
  updateAgentLog,
  updateSessionHistorySummary
} from '../crescent-sqlite'
import { AgentBrain } from '../agent/brain'
import { readAgentConfig } from '../crescent-store'
import type {
  StoredAgentLogEntry,
  StoredAgentRun,
  StoredSessionSummaryUpdate,
  StoredSessionTab
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

  ipcMain.handle('storage:save-agent-run', (_, run: StoredAgentRun) => {
    saveAgentRun(run)
    return { ok: true }
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
    .map((entry) => `${entry.kind}: ${entry.text}`)
    .join('\n\n')
    .slice(-12_000)

  if (logs.trim().length < 40) return

  try {
    const completion = await new AgentBrain(readAgentConfig()).chat({
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Summarize a terminal-agent conversation for history review. Return strict JSON only: {"title":"short title","summary":"two-line concise summary"}. The title must be 6-24 Chinese characters or 3-8 English words. The summary must mention the goal and current outcome/status. Do not include markdown.'
        },
        {
          role: 'user',
          content: logs
        }
      ]
    })
    const parsed = parseSessionSummary(completion.choices[0]?.message.content ?? '')
    if (!parsed) return

    const updated = updateSessionHistorySummary({
      tabId,
      title: parsed.title,
      summary: parsed.summary
    })
    if (!updated.ok || webContents.isDestroyed()) return

    const event: StoredSessionSummaryUpdate = {
      tabId,
      title: updated.title,
      summary: updated.summary,
      updatedAt: updated.updatedAt
    }
    webContents.send('storage:session-summary-updated', event)
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
    // Fall through to text parsing.
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^(title|summary|标题|摘要)\s*[:：]\s*/i, '').trim())
    .filter(Boolean)
  if (lines.length < 2) return undefined

  return {
    title: lines[0].slice(0, 80),
    summary: lines.slice(1).join(' ').slice(0, 260)
  }
}
