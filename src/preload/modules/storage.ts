import { ipcRenderer } from 'electron'
import type {
  OpsHistoryRecord,
  SessionTokenUsage,
  StoredAgentLogEntry,
  StoredAgentRun,
  StoredSessionHistoryDetail,
  StoredSessionHistoryItem,
  StoredSessionSummaryUpdate,
  StoredSessionTab,
  SubmitOpsFeedbackInput,
  SubmitOpsFeedbackResult,
  UpdateOpsFeedbackInput,
  UpdateOpsFeedbackResult
} from '../../shared/agent-types'

export const storageApi = {
  saveTabs: (tabs: StoredSessionTab[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('storage:save-tabs', tabs),
  saveAgentLog: (entry: StoredAgentLogEntry): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('storage:save-agent-log', entry),
  updateAgentLog: (
    input: Pick<StoredAgentLogEntry, 'tabId' | 'logId' | 'text'>
  ): Promise<{ ok: boolean }> => ipcRenderer.invoke('storage:update-agent-log', input),
  getAgentLog: (input: {
    tabId: string
    logId: number
  }): Promise<StoredAgentLogEntry | undefined> =>
    ipcRenderer.invoke('storage:get-agent-log', input),
  deleteAgentLogs: (input: {
    tabId: string
    logIds: number[]
  }): Promise<{ ok: boolean; removed: number }> =>
    ipcRenderer.invoke('storage:delete-agent-logs', input),
  saveAgentRun: (run: StoredAgentRun): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('storage:save-agent-run', run),
  getAgentRun: (runId: string): Promise<StoredAgentRun | undefined> =>
    ipcRenderer.invoke('storage:get-agent-run', runId),
  listAgentRuns: (input: { tabId: string; limit?: number }): Promise<StoredAgentRun[]> =>
    ipcRenderer.invoke('storage:list-agent-runs', input),
  listAllAgentRuns: (tabId: string): Promise<StoredAgentRun[]> =>
    ipcRenderer.invoke('storage:list-all-agent-runs', tabId),
  getSessionTokenUsage: (tabId: string): Promise<SessionTokenUsage> =>
    ipcRenderer.invoke('storage:get-session-token-usage', tabId),
  listAgentLogs: (input: {
    tabId: string
    beforeLogId?: number
    limit?: number
  }): Promise<StoredAgentLogEntry[]> => ipcRenderer.invoke('storage:list-agent-logs', input),
  countAgentLogs: (tabId: string): Promise<number> =>
    ipcRenderer.invoke('storage:count-agent-logs', tabId),
  listSessionHistory: (limit?: number): Promise<StoredSessionHistoryItem[]> =>
    ipcRenderer.invoke('storage:list-session-history', limit),
  getSessionHistory: (tabId: string): Promise<StoredSessionHistoryDetail | undefined> =>
    ipcRenderer.invoke('storage:get-session-history', tabId),
  renameSessionHistory: (input: { tabId: string; title: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('storage:rename-session-history', input),
  deleteSessionHistory: (tabId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('storage:delete-session-history', tabId),
  submitOpsFeedback: (input: SubmitOpsFeedbackInput): Promise<SubmitOpsFeedbackResult> =>
    ipcRenderer.invoke('storage:submit-ops-feedback', input),
  getOpsFeedback: (runId: string): Promise<OpsHistoryRecord | undefined> =>
    ipcRenderer.invoke('storage:get-ops-feedback', runId),
  listOpsFeedback: (input: {
    connectionId?: string
    limit?: number
  }): Promise<OpsHistoryRecord[]> => ipcRenderer.invoke('storage:list-ops-feedback', input),
  updateOpsFeedback: (input: UpdateOpsFeedbackInput): Promise<UpdateOpsFeedbackResult> =>
    ipcRenderer.invoke('storage:update-ops-feedback', input),
  deleteOpsFeedback: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('storage:delete-ops-feedback', id),
  onSessionSummaryUpdated: (
    callback: (event: StoredSessionSummaryUpdate) => void
  ): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: StoredSessionSummaryUpdate): void =>
      callback(event)

    ipcRenderer.on('storage:session-summary-updated', listener)
    return () => ipcRenderer.removeListener('storage:session-summary-updated', listener)
  }
}
