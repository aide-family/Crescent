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
