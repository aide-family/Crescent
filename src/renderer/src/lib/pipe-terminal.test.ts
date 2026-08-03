import { describe, expect, it, vi } from 'vitest'

import {
  commitPipeCommand,
  handlePipeEscape,
  setPipeBuffer,
  type PipeTerminalState
} from './pipe-terminal'

function createTerminalMock(): {
  write: ReturnType<typeof vi.fn>
  writeln: ReturnType<typeof vi.fn>
} {
  return {
    write: vi.fn(),
    writeln: vi.fn()
  }
}

function baseState(overrides: Partial<PipeTerminalState> = {}): PipeTerminalState {
  return {
    inputBuffer: '',
    cursor: 0,
    history: [],
    historyIndex: null,
    prompt: '$ ',
    cwd: '/tmp',
    ...overrides
  }
}

describe('pipe-terminal helpers', () => {
  it('updates the buffer and clamps the cursor', () => {
    const terminal = createTerminalMock()
    const next = setPipeBuffer(terminal as never, baseState(), 'echo hi', 2)
    expect(next.inputBuffer).toBe('echo hi')
    expect(next.cursor).toBe(2)
    expect(terminal.write).toHaveBeenCalled()
  })

  it('commits a command and records history', () => {
    const terminal = createTerminalMock()
    const writeApi = vi.fn()
    vi.stubGlobal('window', {
      api: {
        terminal: {
          write: writeApi
        }
      }
    })

    const next = commitPipeCommand(
      terminal as never,
      baseState({ inputBuffer: 'ls', cursor: 2 }),
      'tab-1'
    )

    expect(next.inputBuffer).toBe('')
    expect(next.cursor).toBe(0)
    expect(next.history).toEqual(['ls'])
    expect(writeApi).toHaveBeenCalledWith('ls\n', 'tab-1')
    vi.unstubAllGlobals()
  })

  it('walks history with up/down escape sequences', () => {
    const terminal = createTerminalMock()
    const withHistory = baseState({ history: ['one', 'two'] })

    const up = handlePipeEscape(terminal as never, withHistory, '\x1b[A')
    expect(up.inputBuffer).toBe('two')
    expect(up.historyIndex).toBe(1)

    const down = handlePipeEscape(terminal as never, up, '\x1b[B')
    expect(down.inputBuffer).toBe('')
    expect(down.historyIndex).toBeNull()
  })
})
