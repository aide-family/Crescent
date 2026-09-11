import { useEffect } from 'react'

import { createCrescentBootstrapFilter, parseSubterminalTabId } from '../lib/terminal-text'
import { appendTerminalOutputRing } from '../lib/terminal-output-ring'

/** Keep PTY output in the renderer ring even when the xterm pane is unmounted. */
export function useTerminalOutputRing(): void {
  useEffect(() => {
    const filters = new Map<string, ReturnType<typeof createCrescentBootstrapFilter>>()
    const filterFor = (tabId: string): ReturnType<typeof createCrescentBootstrapFilter> => {
      const existing = filters.get(tabId)
      if (existing) return existing
      const created = createCrescentBootstrapFilter()
      filters.set(tabId, created)
      return created
    }

    return window.api.terminal.onData((event) => {
      const subterminal = parseSubterminalTabId(event.tabId)
      if (subterminal) {
        appendTerminalOutputRing(event.tabId, event.data)
        return
      }
      const filtered = filterFor(event.tabId).push(event.data)
      if (filtered) appendTerminalOutputRing(event.tabId, filtered)
    })
  }, [])
}
