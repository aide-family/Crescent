import { describe, expect, it } from 'vitest'

import { createTerminalTab } from '../lib/terminal-tabs'
import { planCloseTabPromotion, reassignSessionRootOnClose } from './useTerminalTabs'

describe('close-tab promotion helpers', () => {
  it('plans promotion when closing the session root with peers', () => {
    const root = createTerminalTab({
      id: 'root',
      sessionGroupId: 'root',
      title: 'Root',
      agentInput: 'hello'
    })
    const peer = createTerminalTab({
      id: 'peer',
      sessionGroupId: 'root',
      title: 'Peer'
    })

    const plan = planCloseTabPromotion([root, peer], 'root')
    expect(plan.shouldPromote).toBe(true)
    expect(plan.nextRoot?.id).toBe('peer')
    expect(plan.peers).toHaveLength(1)
  })

  it('reassigns chat ownership onto the next root', () => {
    const root = createTerminalTab({
      id: 'root',
      sessionGroupId: 'root',
      title: 'Root',
      agentInput: 'hello',
      agentLog: [{ id: 1, kind: 'user', text: 'hi', createdAt: 't' }]
    })
    const peer = createTerminalTab({
      id: 'peer',
      sessionGroupId: 'root',
      title: 'Peer'
    })
    const next = reassignSessionRootOnClose([root, peer], root, peer, 'root', 'root')

    expect(next.find((tab) => tab.id === 'peer')).toMatchObject({
      sessionGroupId: 'peer',
      agentInput: 'hello',
      agentLog: root.agentLog
    })
  })
})
