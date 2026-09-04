import { isAgentProviderEnabled } from '../../../shared/agent-providers'
import type { AgentConfig } from '../../../shared/agent-types'

export type PaneOrder = 'terminal-chat' | 'chat-terminal'

export const CLOSE_TERMINAL_CONFIRM_STORAGE_KEY = 'crescent.closeTerminalConfirmEnabled'
export const PANE_ORDER_STORAGE_KEY = 'crescent.paneOrder'

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
