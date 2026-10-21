import type { WebContents } from 'electron'
import { safeWebContentsSend } from '../../safe-ipc-send'

/** Owns coalescing timers so closing a terminal cannot leave a delayed frame. */
export class TerminalRendererEvents {
  private readonly pending = new Map<
    string,
    {
      webContents: WebContents
      tabId: string
      chunks: string[]
      timer: ReturnType<typeof setTimeout>
    }
  >()
  constructor(private readonly appendContext: (key: string, data: string) => void) {}
  send(webContents: WebContents, tabId: string, key: string, data: string): void {
    if (!data) return
    this.appendContext(key, data)
    const existing = this.pending.get(key)
    if (existing) {
      existing.chunks.push(data)
      existing.webContents = webContents
      existing.tabId = tabId
      return
    }
    this.pending.set(key, {
      webContents,
      tabId,
      chunks: [data],
      timer: setTimeout(() => this.flush(key), 24)
    })
  }
  flush(key: string): void {
    const pending = this.pending.get(key)
    if (!pending) return
    this.pending.delete(key)
    clearTimeout(pending.timer)
    const data = pending.chunks.join('')
    if (data)
      safeWebContentsSend(pending.webContents, 'terminal:data', { tabId: pending.tabId, data })
  }
  flushAll(): void {
    for (const key of this.pending.keys()) this.flush(key)
  }
}
