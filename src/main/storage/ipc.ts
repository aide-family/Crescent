import { ipcMain } from 'electron'

import {
  listSessionHistory,
  readSessionHistoryDetail,
  saveAgentLog,
  saveAgentRun,
  saveSessionTabs,
  updateAgentLog
} from '../crescent-sqlite'
import type { StoredAgentLogEntry, StoredAgentRun, StoredSessionTab } from '../agent/types'

export function registerStorageIpc(): void {
  ipcMain.handle('storage:save-tabs', (_, tabs: StoredSessionTab[]) => {
    saveSessionTabs(tabs)
    return { ok: true }
  })

  ipcMain.handle('storage:save-agent-log', (_, entry: StoredAgentLogEntry) => {
    saveAgentLog(entry)
    return { ok: true }
  })

  ipcMain.handle(
    'storage:update-agent-log',
    (_, input: Pick<StoredAgentLogEntry, 'tabId' | 'logId' | 'text'>) => {
      updateAgentLog(input)
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
}
