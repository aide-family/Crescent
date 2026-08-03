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

/** Observe host size and push cols/rows to the PTY for the given tab. */
export function observeTerminalHostResize(
  host: HTMLElement,
  fitAddon: FitAddon,
  tabId: string
): ResizeObserver {
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit()
    const dimensions = fitAddon.proposeDimensions()
    if (dimensions) {
      window.api.terminal.resize({ cols: dimensions.cols, rows: dimensions.rows, tabId })
    }
  })
  resizeObserver.observe(host)
  return resizeObserver
}
