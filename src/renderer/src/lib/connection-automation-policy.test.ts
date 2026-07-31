import { describe, expect, it } from 'vitest'

import {
  formatConnectionAutomationFailure,
  resolveConnectionReconnectPolicy,
  shouldDrainPostConnectionTasks
} from './connection-automation-policy'

describe('connection-automation-policy', () => {
  it('suppresses reconnect when explicitly requested', () => {
    expect(
      resolveConnectionReconnectPolicy({
        suppressReconnect: true,
        automatedLoginInProgress: true
      })
    ).toBe('suppress')
  })

  it('falls back to local shell when automation is in progress', () => {
    expect(
      resolveConnectionReconnectPolicy({
        automatedLoginInProgress: true
      })
    ).toBe('local-fallback')
  })

  it('uses default reconnect outside automation failures', () => {
    expect(resolveConnectionReconnectPolicy({})).toBe('default')
  })

  it('only drains post-login tasks after successful automation', () => {
    expect(shouldDrainPostConnectionTasks(true)).toBe(true)
    expect(shouldDrainPostConnectionTasks(false)).toBe(false)
  })

  it('formats abort messages with original user task for the chat pane', () => {
    expect(
      formatConnectionAutomationFailure({
        abortLabel: 'Connection did not finish',
        detail: 'Missing env: BLJ_PASSWORD',
        originalTaskLabel: 'Original user task',
        originalTask: 'check disk on prod'
      })
    ).toBe(
      [
        'Connection did not finish',
        'Missing env: BLJ_PASSWORD',
        'Original user task: check disk on prod'
      ].join('\n')
    )
  })
})
