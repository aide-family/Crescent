import { isExecutionTerminalReadyForAgent } from './connection-route'
import type { AgentTerminalTab } from './terminal-tabs'

export interface EnsureLocalTerminalStartResult {
  ok: boolean
  tab: AgentTerminalTab
  error?: string
}

/**
 * Ensure a local execution tab has an active PTY/pipe session.
 * Used when the terminal pane is hidden (xterm lifecycle never started).
 */
export async function ensureLocalTerminalStarted(input: {
  tab: AgentTerminalTab
  getContext: () => Promise<{ mode: string }>
  start: () => Promise<{ sessionId: number; mode: 'pty' | 'pipe'; cwd: string }>
}): Promise<EnsureLocalTerminalStartResult> {
  let tab = input.tab
  const context = await input.getContext()
  if (isExecutionTerminalReadyForAgent({ tab, terminalMode: context.mode })) {
    return { ok: true, tab }
  }

  try {
    const session = await input.start()
    tab = {
      ...tab,
      sessionId: session.sessionId,
      terminalMode: session.mode,
      terminalCwd: session.cwd,
      terminalReady: true,
      terminalStartError: undefined
    }
    return { ok: true, tab }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    tab = {
      ...tab,
      sessionId: undefined,
      terminalReady: false,
      terminalStartError: message
    }
    return { ok: false, tab, error: message }
  }
}
