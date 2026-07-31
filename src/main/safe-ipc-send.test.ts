import { describe, expect, it, vi } from 'vitest'

import { safeWebContentsSend } from './safe-ipc-send'

function mockWebContents(
  overrides: Partial<{
    isDestroyed: () => boolean
    mainFrame: unknown
    send: ReturnType<typeof vi.fn>
  }> = {}
) {
  return {
    isDestroyed: overrides.isDestroyed ?? (() => false),
    mainFrame: 'mainFrame' in overrides ? overrides.mainFrame : {},
    send: overrides.send ?? vi.fn()
  }
}

describe('safeWebContentsSend', () => {
  it('skips send when webContents is missing or destroyed', () => {
    expect(safeWebContentsSend(null, 'ch', 1)).toBe(false)
    expect(safeWebContentsSend(undefined, 'ch', 1)).toBe(false)

    const destroyed = mockWebContents({ isDestroyed: () => true, send: vi.fn() })
    expect(safeWebContentsSend(destroyed as never, 'ch', 1)).toBe(false)
    expect(destroyed.send).not.toHaveBeenCalled()
  })

  it('skips send when mainFrame is already gone', () => {
    const wc = mockWebContents({ mainFrame: null, send: vi.fn() })
    expect(safeWebContentsSend(wc as never, 'terminal:data', { tabId: '1' })).toBe(false)
    expect(wc.send).not.toHaveBeenCalled()
  })

  it('sends when the frame is alive', () => {
    const send = vi.fn()
    const wc = mockWebContents({ send })
    expect(safeWebContentsSend(wc as never, 'terminal:data', { tabId: '1', data: 'x' })).toBe(true)
    expect(send).toHaveBeenCalledWith('terminal:data', { tabId: '1', data: 'x' })
  })

  it('swallows send errors from a disposed frame', () => {
    const send = vi.fn(() => {
      throw new Error('Render frame was disposed before WebFrameMain could be accessed')
    })
    const wc = mockWebContents({ send })
    expect(safeWebContentsSend(wc as never, 'agent:event', { type: 'done' })).toBe(false)
  })
})
