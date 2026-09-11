import { isAgentProviderEnabled } from '../../../shared/agent-providers'
import type { AgentConfig } from '../../../shared/agent-types'
import {
  DEFAULT_WORKBENCH_LAYOUT,
  isWorkbenchLayout,
  parseWorkbenchLayout,
  type WorkbenchLayout
} from '../../../shared/workbench-layout'

export type PaneOrder = 'terminal-chat' | 'chat-terminal'
export { isWorkbenchLayout, parseWorkbenchLayout, type WorkbenchLayout }

export const CLOSE_TERMINAL_CONFIRM_STORAGE_KEY = 'crescent.closeTerminalConfirmEnabled'
export const PANE_ORDER_STORAGE_KEY = 'crescent.paneOrder'
export const WORKBENCH_LAYOUT_STORAGE_KEY = 'crescent.workbenchLayout'

/** Durable sqlite value wins; otherwise the same-origin localStorage cache; else terminal-only. */
export function resolveInitialWorkbenchLayout(durable?: WorkbenchLayout | null): WorkbenchLayout {
  if (isWorkbenchLayout(durable)) return durable
  const stored = localStorage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY)
  if (isWorkbenchLayout(stored)) return stored
  return DEFAULT_WORKBENCH_LAYOUT
}

/** Persist only on explicit user choice (settings / layout toggle), not connect-time reveal. */
export function persistWorkbenchLayout(layout: WorkbenchLayout): void {
  localStorage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, layout)
}

/** Opening a connection from terminal-only reveals chat; chat-only / split stay put. */
export function revealChatFromTerminalLayout(layout: WorkbenchLayout): WorkbenchLayout {
  return layout === 'terminal' ? 'split' : layout
}

export function hasConfiguredModelSelection(config: AgentConfig): boolean {
  const providerId = config.providerId?.trim()
  const model = config.model.trim()
  if (!providerId || !model) return false

  return config.providers.some(
    (provider) =>
      isAgentProviderEnabled(provider) &&
      provider.id === providerId &&
      provider.models.some((candidate) => candidate.id === model)
  )
}

export function resolveInitialPaneOrder(): PaneOrder {
  return localStorage.getItem(PANE_ORDER_STORAGE_KEY) === 'chat-terminal'
    ? 'chat-terminal'
    : 'terminal-chat'
}

export function formatPipePrompt(cwd: string): string {
  const home = cwd.replace(/^\/Users\/[^/]+/, '~')

  return `\x1b[38;5;45m${home}\x1b[0m $ `
}

export function getPipePrompt(prompt: string, cwd: string): string {
  return prompt || formatPipePrompt(cwd)
}
