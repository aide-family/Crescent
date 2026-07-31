import type { WebContents } from 'electron'

/**
 * Send an IPC message only when the renderer frame is still alive.
 * Electron can report `isDestroyed() === false` while the guest frame is
 * already disposed (reload / HMR / window teardown), and `webContents.send`
 * then floods stderr with "Render frame was disposed…".
 */
export function safeWebContentsSend(
  webContents: WebContents | null | undefined,
  channel: string,
  ...args: unknown[]
): boolean {
  if (!webContents || webContents.isDestroyed()) return false

  try {
    // mainFrame is null/undefined once the guest document is gone.
    if (webContents.mainFrame == null) return false
    webContents.send(channel, ...args)
    return true
  } catch {
    return false
  }
}
