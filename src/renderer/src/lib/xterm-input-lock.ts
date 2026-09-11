import type { Terminal } from '@xterm/xterm'

/** Apply stdin lock without remounting the xterm instance. */
export function applyXtermInputLock(terminal: Terminal, locked: boolean): void {
  terminal.options.disableStdin = locked
  terminal.options.cursorBlink = !locked
}
