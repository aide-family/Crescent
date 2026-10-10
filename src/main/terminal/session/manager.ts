import type { WebContents } from 'electron'
import type { ConnectionState } from '../../../shared/connection-state'
import type {
  TemporarySubterminalEntry,
  TerminalAutomationFilterState,
  TerminalCommandExecutionResult,
  TerminalExitNotification,
  TerminalSession
} from './types'

export class TerminalSessionManager {
  readonly sessions = new Map<string, TerminalSession>()
  readonly terminalOutputBuffers = new Map<string, string>()
  readonly degradedRecoveryOutput = new Map<string, string>()
  readonly connectionStates = new Map<string, ConnectionState>()
  readonly manualInputLines = new Map<string, string>()
  readonly sessionWebContents = new Map<string, WebContents>()
  readonly automationEchoSuppressions = new Map<string, { echo: string; until: number }>()
  readonly terminalDataWaiters = new Map<string, Set<(data: string) => void>>()
  readonly terminalExitWaiters = new Map<string, Set<(event: TerminalExitNotification) => void>>()
  readonly terminalUserInterruptNotifiers = new Map<string, Set<() => void>>()
  readonly pendingCommandPromises = new Map<string, Promise<TerminalCommandExecutionResult>>()
  readonly terminalAutomationFilterStates = new Map<string, TerminalAutomationFilterState>()
  readonly temporarySubterminals = new Map<string, TemporarySubterminalEntry[]>()
  readonly restoringSessionKeys = new Set<string>()
  constructor(private readonly flushVisible: (key: string) => void) {}
  notifyExit(key: string, event: TerminalExitNotification): void {
    const listeners = this.terminalExitWaiters.get(key)
    this.terminalExitWaiters.delete(key)
    for (const listener of listeners ?? []) {
      try {
        listener(event)
      } catch (error) {
        console.warn('Terminal exit listener failed', error)
      }
    }
  }
  stop(key: string): void {
    this.flushVisible(key)
    this.notifyExit(key, { exitCode: 130 })
    try {
      this.sessions.get(key)?.kill()
    } finally {
      this.sessions.delete(key)
      this.terminalDataWaiters.delete(key)
      this.terminalUserInterruptNotifiers.delete(key)
      this.terminalOutputBuffers.delete(key)
      this.degradedRecoveryOutput.delete(key)
      this.manualInputLines.delete(key)
      this.terminalAutomationFilterStates.delete(key)
      this.automationEchoSuppressions.delete(key)
    }
  }
  finish(key: string, id: number): boolean {
    if (this.sessions.get(key)?.id !== id) return false
    this.flushVisible(key)
    this.sessions.delete(key)
    this.terminalDataWaiters.delete(key)
    this.terminalUserInterruptNotifiers.delete(key)
    this.terminalAutomationFilterStates.delete(key)
    this.automationEchoSuppressions.delete(key)
    this.manualInputLines.delete(key)
    return true
  }
  clear(): void {
    for (const key of new Set([...this.sessions.keys(), ...this.terminalExitWaiters.keys()]))
      try {
        this.stop(key)
      } catch (error) {
        console.warn('Terminal shutdown failed', error)
      }
    this.sessions.clear()
    this.terminalOutputBuffers.clear()
    this.degradedRecoveryOutput.clear()
    this.connectionStates.clear()
    this.manualInputLines.clear()
    this.sessionWebContents.clear()
    this.automationEchoSuppressions.clear()
    this.terminalDataWaiters.clear()
    this.terminalExitWaiters.clear()
    this.terminalUserInterruptNotifiers.clear()
    this.pendingCommandPromises.clear()
    this.terminalAutomationFilterStates.clear()
    this.temporarySubterminals.clear()
    this.restoringSessionKeys.clear()
  }
}
