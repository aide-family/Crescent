import type { Terminal } from '@xterm/xterm'

export interface XtermScrollFollow {
  resetFollow: () => void
  followIfEnabled: () => void
  dispose: () => void
}

/** Track whether the user scrolled away from the bottom of an xterm viewport. */
export function attachXtermScrollFollow(terminal: Terminal): XtermScrollFollow {
  let userAway = false

  const disposable = terminal.onScroll(() => {
    const buffer = terminal.buffer.active
    userAway = buffer.viewportY < buffer.baseY
  })

  return {
    resetFollow: () => {
      userAway = false
    },
    followIfEnabled: () => {
      if (!userAway) terminal.scrollToBottom()
    },
    dispose: () => disposable.dispose()
  }
}

/** Write PTY output and scroll to bottom when auto-follow is enabled. */
export function writeXtermAndFollow(
  terminal: Terminal,
  data: string,
  follow: XtermScrollFollow
): void {
  if (!data) return
  terminal.write(data, () => follow.followIfEnabled())
}
