import { ipcRenderer } from 'electron'
import type {
  CodeIndexStatus,
  MemorySnapshot,
  MemoryInput,
  MemorySettings,
  MemoryItem,
  MemoryRelation,
  MemoryModelSelection,
  MemoryLearningTarget,
  MemoryLearnOptions
} from '../../shared/knowledge'
export const knowledgeApi = {
  codeStatus: (root?: string): Promise<CodeIndexStatus> =>
    ipcRenderer.invoke('knowledge:code-status', root),
  codeIndex: (root?: string): Promise<CodeIndexStatus> =>
    ipcRenderer.invoke('knowledge:code-index', root),
  codeCancel: (): Promise<void> => ipcRenderer.invoke('knowledge:code-cancel'),
  codeClear: (root?: string): Promise<void> => ipcRenderer.invoke('knowledge:code-clear', root),
  codeSearch: (root: string, query: string, mode: string): Promise<unknown> =>
    ipcRenderer.invoke('knowledge:code-search', { root, query, mode }),
  memorySnapshot: (): Promise<MemorySnapshot> => ipcRenderer.invoke('knowledge:memory-snapshot'),
  memorySave: (input: MemoryInput): Promise<MemoryItem> =>
    ipcRenderer.invoke('knowledge:memory-save', input),
  memoryDelete: (id: string): Promise<void> => ipcRenderer.invoke('knowledge:memory-delete', id),
  memoryClear: (): Promise<void> => ipcRenderer.invoke('knowledge:memory-clear'),
  memorySettings: (value: MemorySettings): Promise<void> =>
    ipcRenderer.invoke('knowledge:memory-settings', value),
  memoryRelate: (value: MemoryRelation): Promise<void> =>
    ipcRenderer.invoke('knowledge:memory-relate', value),
  memoryUnrelate: (value: MemoryRelation): Promise<void> =>
    ipcRenderer.invoke('knowledge:memory-unrelate', value),
  memoryTarget: (selection?: MemoryModelSelection): Promise<MemoryLearningTarget> =>
    ipcRenderer.invoke('knowledge:memory-target', selection),
  memoryConsent: (selection: MemoryModelSelection, targetKey: string): Promise<void> =>
    ipcRenderer.invoke('knowledge:memory-consent', { selection, targetKey }),
  memoryRevokeConsent: (): Promise<void> => ipcRenderer.invoke('knowledge:memory-revoke-consent'),
  memoryLearn: (tabId: string, options?: MemoryLearnOptions): Promise<{ count: number }> =>
    ipcRenderer.invoke('knowledge:memory-learn', tabId, options),
  memoryCancel: (): Promise<void> => ipcRenderer.invoke('knowledge:memory-cancel')
}
