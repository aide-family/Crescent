import { describe, expect, it } from 'vitest'

import {
  actionLogClassName,
  connectionFailureMarkers,
  isConnectionFailureLog,
  isConversationLog,
  logClassName,
  logListItemSpacingClass
} from './agent-log'
import { dictionaries } from '../i18n'

const t = dictionaries.en

describe('agent-log hierarchy helpers', () => {
  it('treats user/assistant/error as conversation and keeps action kinds quieter', () => {
    expect(isConversationLog('user')).toBe(true)
    expect(isConversationLog('assistant')).toBe(true)
    expect(isConversationLog('error')).toBe(true)
    expect(isConversationLog('command')).toBe(false)

    expect(logClassName('user')).toContain('border-l-primary')
    expect(logClassName('assistant')).toContain('bg-card')
    expect(logClassName('error')).toContain('border-l-destructive')
    expect(actionLogClassName('plan')).toContain('border-l-primary/40')
    expect(actionLogClassName('plan')).not.toContain('purple')
    expect(actionLogClassName('command')).toContain('bg-muted/10')
  })

  it('packs consecutive action rows tighter than conversation turns', () => {
    expect(logListItemSpacingClass('command', 'tool', false)).toBe('mt-1')
    expect(logListItemSpacingClass('user', 'assistant', false)).toBe('mt-3')
    expect(logListItemSpacingClass('assistant', 'command', false)).toBe('mt-4')
    expect(logListItemSpacingClass('user', undefined, true)).toBe('mt-4')
  })

  it('detects connection-failure copy for recovery CTAs', () => {
    const markers = connectionFailureMarkers(t)
    expect(isConnectionFailureLog(`${t.terminal.postLoginTaskAborted}\nMissing env`, markers)).toBe(
      true
    )
    expect(isConnectionFailureLog('ordinary assistant reply', markers)).toBe(false)
  })
})
