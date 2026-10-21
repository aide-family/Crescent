import { ipcRenderer } from 'electron'
import type { CommandDirectory } from '../../shared/command-directory'
import type { TerminalExecutionTarget, TerminalCommandResult } from '../../shared/agent-types'
export interface CommandPreview {
  command: string
  binding: string
  target: TerminalExecutionTarget
  risk: 'low' | 'high' | 'gray'
}
export const commandsApi = {
  cancel: (tabId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('commands:cancel', tabId),
  list: (): Promise<CommandDirectory> => ipcRenderer.invoke('commands:list'),
  save: (value: CommandDirectory): Promise<CommandDirectory> =>
    ipcRenderer.invoke('commands:save', value),
  undo: (): Promise<CommandDirectory> => ipcRenderer.invoke('commands:undo'),
  preview: (payload: {
    entryId: string
    values: Record<string, string>
    tabId: string
  }): Promise<CommandPreview> => ipcRenderer.invoke('commands:preview', payload),
  execute: (payload: {
    entryId: string
    values: Record<string, string>
    tabId: string
    binding: string
    command: string
    chatTabId: string
    executionMode: 'planned' | 'immediate'
    mutationPolicy: 'confirm' | 'manual-execution'
  }): Promise<TerminalCommandResult> => ipcRenderer.invoke('commands:execute', payload)
}
