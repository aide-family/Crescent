import type { AgentConfig } from '../../../shared/agent-types'

export type PaneOrder = 'terminal-chat' | 'chat-terminal'

export const CLOSE_TERMINAL_CONFIRM_STORAGE_KEY = 'crescent.closeTerminalConfirmEnabled'
export const PANE_ORDER_STORAGE_KEY = 'crescent.paneOrder'

export function hasConfiguredModelSelection(config: AgentConfig): boolean {
  return Boolean(config.providerId?.trim() && config.model.trim() && config.providers.length > 0)
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
