import type { Terminal } from '@xterm/xterm'

import { writeXtermAndFollow, type XtermScrollFollow } from './xterm-scroll-follow'

/**
 * CSI / OSC queries that make xterm.js emit a reply through `onData`.
 * Replaying them into a new Terminal would inject DA/CPR/color reports into the live PTY.
 */
/* eslint-disable no-control-regex -- CSI/OSC device queries use ESC and BEL */
const DEVICE_QUERY_PATTERNS: readonly RegExp[] = [
  // DA1: CSI c / CSI 0c / CSI ?1;2c
  /\x1b\[\??[\d;]*c/g,
  // DA2: CSI > c / CSI >0;276;0c (first param 0 is treated as a query)
  /\x1b\[>[\d;]*c/g,
  // DSR: CSI 5n / 6n / ?6n (status / cursor position)
  /\x1b\[\??[56]n/g,
  // Window reports: CSI 14t / 16t / 18t / 21t
  /\x1b\[(?:14|16|18|21)t/g,
  // XTVERSION: CSI > q / CSI >0q
  /\x1b\[>\d*q/g,
  // OSC 10/11/12 color queries (BEL or ST)
  /\x1b\](?:10|11|12);\?(?:\x07|\x1b\\)/g
]
/* eslint-enable no-control-regex */

/** Remove terminal device queries from a history buffer. Live PTY chunks must not use this. */
export function stripTerminalDeviceQueries(data: string): string {
  if (!data || !data.includes('\x1b')) return data

  let output = data
  for (const pattern of DEVICE_QUERY_PATTERNS) {
    pattern.lastIndex = 0
    output = output.replace(pattern, '')
  }
  return output
}

/** Gate that blocks xterm `onData` until scrollback replay finishes. Starts closed. */
export function createXtermReplayGate(): {
  shouldForwardInput: () => boolean
  release: () => void
} {
  let pending = true
  return {
    shouldForwardInput: () => !pending,
    release: () => {
      pending = false
    }
  }
}

/**
 * Replay scrollback into xterm without letting DA/DSR replies reach the PTY.
 * `onComplete` fires after the write parser finishes (or immediately when there is nothing to write).
 */
export function hydrateXtermFromHistory(
  terminal: Pick<Terminal, 'write'>,
  data: string,
  follow: XtermScrollFollow,
  onComplete: () => void
): void {
  const cleaned = stripTerminalDeviceQueries(data)
  writeXtermAndFollow(terminal, cleaned, follow, onComplete)
}
