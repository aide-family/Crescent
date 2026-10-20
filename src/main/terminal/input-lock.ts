/** Whether renderer-originated PTY writes should be dropped during an agent run. */

let executionTabChecker: ((tabId: string) => boolean) | undefined

export function registerPtyExecutionTabChecker(fn: (tabId: string) => boolean): void {
  executionTabChecker = fn
}

export function isPtyExecutionTabLocked(tabId: string): boolean {
  const id = tabId.trim()
  if (!id) return false
  return executionTabChecker?.(id) === true
}

export function shouldBlockTerminalUserInput(input: {
  hasPendingCommand: boolean
  isAgentExecutionTab: boolean
}): boolean {
  return input.hasPendingCommand || input.isAgentExecutionTab
}

/**
 * Drop keystrokes only on the pane that owns the in-flight command.
 * Password submit and root-password autofill are automation and must reach a
 * PTY that is waiting on sudo. A lock on another pane must not swallow Enter.
 */
export function shouldDropTerminalUserWrite(input: {
  writeSource: 'user' | 'automation'
  hasPendingCommand: boolean
  isAgentExecutionTab: boolean
  otherPaneHasPendingCommand: boolean
}): boolean {
  if (input.writeSource === 'automation') return false
  if (input.hasPendingCommand) return true
  if (!input.isAgentExecutionTab) return false
  if (input.otherPaneHasPendingCommand) return false
  return true
}

/**
 * Ctrl+C belongs to the pane that is actually running a command.
 * When that pane is not the focused one, the caller must not also write ETX
 * to the focused PTY — that redraws the idle shell's previous line.
 */
export function resolveCtrlCTabId(input: {
  requestedTabId: string
  pendingTabIds: readonly string[]
}): string {
  const requested = input.requestedTabId.trim()
  const pending = [...new Set(input.pendingTabIds.map((id) => id.trim()).filter(Boolean))]
  if (requested && pending.includes(requested)) return requested
  if (pending.length === 1) return pending[0]
  if (pending.length > 1) {
    const marker = '::subterminal::'
    const child = requested
      ? pending.find((id) => {
          const index = id.indexOf(marker)
          return index > 0 && id.slice(0, index) === requested
        })
      : undefined
    return child ?? pending[pending.length - 1]
  }
  return requested
}

/** Ctrl+C / ETX must reach the PTY even while other user input is locked. */
export function isTerminalInterruptPayload(data: string): boolean {
  return data.includes('\x03')
}

/**
 * User Ctrl+C: interrupt an in-flight waiter when one exists. Never aborts the Pi session.
 * The PTY still receives SIGINT even when no waiter is pending.
 */
export function resolveUserCommandInterrupt(input: {
  hasPendingCommand: boolean
}): 'interrupt' | 'noop' {
  return input.hasPendingCommand ? 'interrupt' : 'noop'
}
