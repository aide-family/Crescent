import { getSessionGroupId, type AgentTerminalTab } from './terminal-tabs'
/** Keep the persistent terminal behind a temporary pane, including peer terminals in one chat. */
export function handoffParentTab(
  tabs: AgentTerminalTab[],
  chatId: string,
  executionPaneId?: string,
  activeTabId?: string
): AgentTerminalTab | undefined {
  const parentId = (executionPaneId || activeTabId || chatId).split('::subterminal::')[0]
  const selected = tabs.find((tab) => tab.id === parentId && getSessionGroupId(tab) === chatId)
  return selected ?? tabs.find((tab) => tab.id === chatId)
}
