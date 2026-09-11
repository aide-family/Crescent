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

/** User Ctrl+C: interrupt only an in-flight waiter. Never aborts the Pi session. */
export function resolveUserCommandInterrupt(input: {
  hasPendingCommand: boolean
}): 'interrupt' | 'noop' {
  return input.hasPendingCommand ? 'interrupt' : 'noop'
}
