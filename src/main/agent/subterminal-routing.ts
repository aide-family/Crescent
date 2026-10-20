const SUBTERMINAL_MARKER = '::subterminal::'

const BARE_SESSION_EXIT_RE = /^(?:sudo\s+)?(?:exit|logout)(?:\s+-?\d+)?\s*$/i

const REMOTE_TASK_COMMAND_RE =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:sudo\s+)?(?:kubectl|kubeadm|helm|ssh|scp)\b/i

export function parentTabIdFromExecutionTab(tabId: string): string {
  const trimmed = tabId.trim()
  const markerIndex = trimmed.indexOf(SUBTERMINAL_MARKER)
  if (markerIndex === -1) return trimmed
  return trimmed.slice(0, markerIndex)
}

export function isSubterminalExecutionTab(tabId: string): boolean {
  const parent = parentTabIdFromExecutionTab(tabId)
  return Boolean(parent) && parent !== tabId.trim()
}

export function subterminalNameFromTabId(tabId: string): string {
  const markerIndex = tabId.indexOf(SUBTERMINAL_MARKER)
  if (markerIndex === -1) return 'subterminal'
  const encoded = tabId.slice(markerIndex + SUBTERMINAL_MARKER.length)
  try {
    return decodeURIComponent(encoded) || 'subterminal'
  } catch {
    return encoded || 'subterminal'
  }
}

/** Bare `exit` / `logout` peels nested SSH hops. Only the current remote pane is blocked. */
export function isRemoteSessionExitCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false
  const parts = trimmed.split(/(?:&&|\|\||;|\n|\r)/)
  return parts.some((part) => BARE_SESSION_EXIT_RE.test(part.trim()))
}

export function shouldBlockRemoteSessionExit(input: {
  command: string
  isSsh?: boolean
  parentConnectionId?: string
}): boolean {
  if (!input.isSsh) return false
  return isRemoteSessionExitCommand(input.command)
}

/** Local subterminal `exit` must not close the shell; the model calls close_subterminal. */
export function shouldRedirectLocalSubterminalExit(input: {
  command: string
  isSsh?: boolean
  executionTabId: string
  fromSubagent?: boolean
}): boolean {
  if (input.fromSubagent || input.isSsh) return false
  if (!isSubterminalExecutionTab(input.executionTabId)) return false
  return isRemoteSessionExitCommand(input.command)
}

export function commandContinuesRemoteTask(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false
  const parts = trimmed.split(/(?:&&|\|\||;|\n|\r)/)
  return parts.some((part) => REMOTE_TASK_COMMAND_RE.test(part.trim()))
}

/**
 * A local subterminal opened from an SSH parent is for client-machine work.
 * Cluster and nested SSH commands belong back on the main pane.
 */
export function shouldBlockRemoteTaskOnLocalSubterminal(input: {
  command: string
  isSsh?: boolean
  executionTabId: string
  parentConnectionId?: string
  fromSubagent?: boolean
}): boolean {
  if (input.fromSubagent || input.isSsh) return false
  if (!input.parentConnectionId?.trim()) return false
  if (!isSubterminalExecutionTab(input.executionTabId)) return false
  return commandContinuesRemoteTask(input.command)
}

export function formatBashPaneEnvironment(input: {
  isSsh?: boolean
  cwd?: string
  executionTabId: string
}): string {
  const mode = input.isSsh ? 'ssh' : 'local'
  const cwd = input.cwd?.trim() || '-'
  const subterminal = isSubterminalExecutionTab(input.executionTabId) ? 'yes' : 'no'
  return `[pane mode=${mode} cwd=${cwd} subterminal=${subterminal}]`
}

export interface BashRouteSnapshot {
  executionTabId: string
  isSsh?: boolean
  connectionId?: string
  parentConnectionId?: string
  fromSubagent?: boolean
}

/** Where bash should run after close_subterminal. Pure so tests can cover the route. */
export function planBashRouteAfterCloseSubterminal(state: BashRouteSnapshot):
  | { ok: false; error: string }
  | { ok: true; alreadyOnMain: true; parentTabId: string }
  | {
      ok: true
      alreadyOnMain: false
      parentTabId: string
      closedTabId: string
      isSsh: boolean
      connectionId?: string
    } {
  if (state.fromSubagent) {
    return { ok: false, error: 'Child subagent bash stays on its own pane.' }
  }
  const parentTabId = parentTabIdFromExecutionTab(state.executionTabId)
  const current = state.executionTabId.trim()
  if (!parentTabId || parentTabId === current) {
    return { ok: true, alreadyOnMain: true, parentTabId: parentTabId || current }
  }
  const parentConnectionId = state.parentConnectionId?.trim()
  return {
    ok: true,
    alreadyOnMain: false,
    parentTabId,
    closedTabId: current,
    isSsh: Boolean(parentConnectionId),
    connectionId: parentConnectionId || undefined
  }
}
