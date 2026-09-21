import type { Terminal } from '@xterm/xterm'

/** Apply stdin lock without remounting the xterm instance. */
export function applyXtermInputLock(terminal: Terminal, locked: boolean): void {
  terminal.options.disableStdin = locked
  terminal.options.cursorBlink = !locked
}

export function isTerminalCtrlCData(data: string): boolean {
  return data.includes('\x03')
}

export function isTerminalCtrlCKeyEvent(event: KeyboardEvent): boolean {
  return (
    event.type === 'keydown' &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key.toLowerCase() === 'c'
  )
}

/** Keep SIGINT available while disableStdin blocks other keys. */
export function attachLockedCtrlCHandler(
  terminal: Terminal,
  shouldForward: () => boolean,
  onCtrlC: () => void
): void {
  terminal.attachCustomKeyEventHandler((event) => {
    if (!isTerminalCtrlCKeyEvent(event)) return true
    if (!shouldForward()) return true
    onCtrlC()
    return false
  })
}
