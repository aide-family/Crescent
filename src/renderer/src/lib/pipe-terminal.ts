import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'

import { getPipePrompt } from './app-shell'

export interface PipeTerminalState {
  inputBuffer: string
  cursor: number
  history: string[]
  historyIndex: number | null
  prompt: string
  cwd: string
}

export function redrawPipeInput(terminal: Terminal, state: PipeTerminalState): void {
  const buffer = state.inputBuffer
  const cursor = state.cursor

  terminal.write(`\r\x1b[2K${getPipePrompt(state.prompt, state.cwd)}${buffer}`)
  const left = buffer.length - cursor
  if (left > 0) terminal.write(`\x1b[${left}D`)
}

export function setPipeBuffer(
  terminal: Terminal,
  state: PipeTerminalState,
  value: string,
  cursor = value.length
): PipeTerminalState {
  const next: PipeTerminalState = {
    ...state,
    inputBuffer: value,
    cursor: Math.max(0, Math.min(cursor, value.length))
  }
  redrawPipeInput(terminal, next)
  return next
}

export function commitPipeCommand(
  terminal: Terminal,
  state: PipeTerminalState,
  tabId: string
): PipeTerminalState {
  const command = state.inputBuffer
  const history = command.trim() ? [...state.history, command].slice(-200) : state.history

  terminal.write('\r\n')
  window.api.terminal.write(`${command}\n`, tabId)

  return {
    ...state,
    inputBuffer: '',
    cursor: 0,
    historyIndex: null,
    history
  }
}

export function handlePipeEscape(
  terminal: Terminal,
  state: PipeTerminalState,
  sequence: string
): PipeTerminalState {
  if (sequence === '\x1b[D') {
    if (state.cursor > 0) {
      terminal.write('\x1b[D')
      return { ...state, cursor: state.cursor - 1 }
    }
    return state
  }

  if (sequence === '\x1b[C') {
    if (state.cursor < state.inputBuffer.length) {
      terminal.write('\x1b[C')
      return { ...state, cursor: state.cursor + 1 }
    }
    return state
  }

  if (sequence === '\x1b[A') {
    const history = state.history
    if (history.length === 0) return state
    const current = state.historyIndex
    const next = current === null ? history.length - 1 : Math.max(0, current - 1)
    return setPipeBuffer(terminal, { ...state, historyIndex: next }, history[next])
  }

  if (sequence === '\x1b[B') {
    const history = state.history
    const current = state.historyIndex
    if (current === null) return state
    const next = current + 1
    if (next >= history.length) {
      return setPipeBuffer(terminal, { ...state, historyIndex: null }, '')
    }
    return setPipeBuffer(terminal, { ...state, historyIndex: next }, history[next])
  }

  return state
}

export function handlePipeTerminalInput(
  terminal: Terminal,
  state: PipeTerminalState,
  data: string,
  tabId: string
): PipeTerminalState {
  let next = state

  for (let index = 0; index < data.length; index += 1) {
    const char = data[index]

    if (char === '\x1b') {
      const sequence = data.slice(index, index + 3)
      if (sequence[0] === '\x1b' && sequence[1] === '[' && 'ABCD'.includes(sequence[2])) {
        next = handlePipeEscape(terminal, next, sequence)
        index += 2
      }
      continue
    }

    if (char === '\x03') {
      void window.api.terminal.interrupt(tabId)
      continue
    }

    if (char === '\r') {
      next = commitPipeCommand(terminal, next, tabId)
      continue
    }

    if (char === '\t') {
      terminal.write('\x07')
      continue
    }

    if (char === '\u007f') {
      const cursor = next.cursor
      if (cursor > 0) {
        const buffer = next.inputBuffer
        next = setPipeBuffer(
          terminal,
          next,
          buffer.slice(0, cursor - 1) + buffer.slice(cursor),
          cursor - 1
        )
      }
      continue
    }

    if (char >= ' ') {
      const cursor = next.cursor
      const buffer = next.inputBuffer
      next = setPipeBuffer(
        terminal,
        next,
        buffer.slice(0, cursor) + char + buffer.slice(cursor),
        cursor + 1
      )
    }
  }

  return next
}

export function isUsableTerminalSize(cols: number, rows: number): boolean {
  return Number.isFinite(cols) && Number.isFinite(rows) && cols >= 1 && rows >= 1
}

/** LF→CRLF belongs on PIPE sessions only; a PTY already applies ONLCR. */
export function applyTerminalConvertEol(terminal: Terminal, mode: 'pty' | 'pipe'): void {
  terminal.options.convertEol = mode === 'pipe'
}

/** Last text row may sit at most this far above the terminal box's bottom edge. */
export const TERMINAL_MAX_BOTTOM_GAP_PX = 8

const baseLineHeights = new WeakMap<Terminal, number>()

function baseLineHeightFor(terminal: Terminal): number {
  const stored = baseLineHeights.get(terminal)
  if (stored != null) return stored
  const base = terminal.options?.lineHeight ?? 1
  baseLineHeights.set(terminal, base)
  return base
}

function terminalCellHeight(terminal: Terminal): number {
  const core = (
    terminal as Terminal & {
      _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } }
    }
  )._core
  const height = core?._renderService?.dimensions?.css?.cell?.height ?? 0
  return Number.isFinite(height) ? height : 0
}

function terminalBottomGap(terminal: Terminal): number | undefined {
  const parent = terminal.element?.parentElement
  const cellHeight = terminalCellHeight(terminal)
  if (!parent || cellHeight <= 0 || terminal.rows < 1) return undefined
  return parent.clientHeight - terminal.rows * cellHeight
}

/**
 * Grow line height just enough that the unused strip under the last row is at most `maxGap`.
 * Returns the base height when the gap is already within the limit.
 */
export function resolveLineHeightForBottomGap(input: {
  baseLineHeight: number
  parentHeight: number
  rows: number
  cellHeight: number
  maxGap?: number
}): number {
  const maxGap = input.maxGap ?? TERMINAL_MAX_BOTTOM_GAP_PX
  const { baseLineHeight, parentHeight, rows, cellHeight } = input
  if (rows < 1 || cellHeight <= 0 || parentHeight <= maxGap || baseLineHeight <= 0) {
    return baseLineHeight
  }
  const used = rows * cellHeight
  const gap = parentHeight - used
  if (gap <= maxGap) return baseLineHeight
  const next = baseLineHeight * ((parentHeight - maxGap) / used)
  if (!Number.isFinite(next) || next <= baseLineHeight) return baseLineHeight
  return next
}

/** Fit the xterm grid, then push the same cols/rows to the PTY. */
export function fitAndSyncPty(terminal: Terminal, fitAddon: FitAddon, tabId: string): void {
  const baseLineHeight = baseLineHeightFor(terminal)
  if (terminal.options && terminal.options.lineHeight !== baseLineHeight) {
    terminal.options.lineHeight = baseLineHeight
  }
  fitAddon.fit()
  const parentHeight = terminal.element?.parentElement?.clientHeight ?? 0
  const cellHeight = terminalCellHeight(terminal)
  const nextLineHeight = resolveLineHeightForBottomGap({
    baseLineHeight,
    parentHeight,
    rows: terminal.rows,
    cellHeight
  })
  if (terminal.options && nextLineHeight !== baseLineHeight) {
    terminal.options.lineHeight = nextLineHeight
    fitAddon.fit()
    const gap = terminalBottomGap(terminal)
    if (gap == null || gap > TERMINAL_MAX_BOTTOM_GAP_PX || gap < 0) {
      terminal.options.lineHeight = baseLineHeight
      fitAddon.fit()
    }
  }
  const { cols, rows } = terminal
  if (!isUsableTerminalSize(cols, rows)) return
  window.api.terminal.resize({ cols, rows, tabId })
}

/** Observe host size and push cols/rows to the PTY for the given tab. */
export function observeTerminalHostResize(
  host: HTMLElement,
  terminal: Terminal,
  fitAddon: FitAddon,
  tabId: string,
  onAfterFit?: () => void
): ResizeObserver {
  let frame = 0
  let fallback = 0
  const fit = (): void => {
    if (frame) window.cancelAnimationFrame(frame)
    if (fallback) window.clearTimeout(fallback)
    frame = 0
    fallback = 0
    fitAndSyncPty(terminal, fitAddon, tabId)
    onAfterFit?.()
  }
  const resizeObserver = new ResizeObserver(() => {
    if (frame || fallback) return
    frame = window.requestAnimationFrame(fit)
    // Background windows may pause animation frames while their PTY remains
    // live. Keep a bounded timer so the next command sees the final grid.
    fallback = window.setTimeout(fit, 120)
  })
  resizeObserver.observe(host)
  // Callers disconnect the observer on unmount; a pending frame must not fit a
  // disposed terminal after that. Keeping this method on the observer makes
  // existing lifecycle cleanup sufficient.
  const disconnect = resizeObserver.disconnect.bind(resizeObserver)
  resizeObserver.disconnect = () => {
    if (frame) window.cancelAnimationFrame(frame)
    if (fallback) window.clearTimeout(fallback)
    disconnect()
  }
  return resizeObserver
}
