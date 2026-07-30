import { describe, expect, it } from 'vitest'

import {
  createTerminalTab,
  getSessionChatTab,
  getSessionDisplayTitle,
  getSessionGroupId,
  getSessionTerminals,
  getTerminalDisplayTitle,
  getTerminalSessionBaseName,
  listSessionChatTabs,
  resolveSessionChatTabId
} from './terminal-tabs'

describe('getTerminalDisplayTitle', () => {
  it('shows the session base name when the name is unique', () => {
    const local = createTerminalTab({ id: 'a', title: 'Local', isSsh: false })
    const ssh = createTerminalTab({
      id: 'b',
      title: 'zhangke',
      connectionId: 'c1',
      connectionName: 'zhangke',
      isSsh: true
    })

    expect(getTerminalDisplayTitle(local, [local, ssh])).toBe('Local')
    expect(getTerminalDisplayTitle(ssh, [local, ssh])).toBe('zhangke')
  })

  it('adds 1-based indexes when multiple tabs share the same base name', () => {
    const first = createTerminalTab({
      id: 'a',
      title: 'zhangke',
      connectionId: 'c1',
      connectionName: 'zhangke',
      isSsh: true
    })
    const second = createTerminalTab({
      id: 'b',
      title: 'zhangke 1',
      connectionId: 'c1',
      connectionName: 'zhangke',
      isSsh: true
    })
    const localA = createTerminalTab({ id: 'c', title: 'Local', isSsh: false })
    const localB = createTerminalTab({ id: 'd', title: 'Local 1', isSsh: false })
    const tabs = [first, second, localA, localB]

    expect(getTerminalSessionBaseName(first)).toBe('zhangke')
    expect(getTerminalSessionBaseName(second)).toBe('zhangke')
    expect(getTerminalDisplayTitle(first, tabs)).toBe('zhangke 1')
    expect(getTerminalDisplayTitle(second, tabs)).toBe('zhangke 2')
    expect(getTerminalDisplayTitle(localA, tabs)).toBe('Local 1')
    expect(getTerminalDisplayTitle(localB, tabs)).toBe('Local 2')
  })
})

describe('session groups', () => {
  it('defaults sessionGroupId to the tab id', () => {
    const tab = createTerminalTab({ id: 'root', title: 'Local' })
    expect(getSessionGroupId(tab)).toBe('root')
  })

  it('groups peer terminals under one chat owner', () => {
    const root = createTerminalTab({
      id: 'root',
      title: 'prod',
      isSsh: true,
      connectionName: 'prod'
    })
    const peer = createTerminalTab({
      id: 'peer',
      title: 'staging',
      sessionGroupId: 'root',
      isSsh: true,
      connectionName: 'staging'
    })
    const other = createTerminalTab({ id: 'other', title: 'Local' })
    const tabs = [root, peer, other]

    expect(getSessionTerminals(tabs, 'root')).toEqual([root, peer])
    expect(getSessionChatTab(tabs, 'peer')).toBe(root)
    expect(resolveSessionChatTabId(tabs, 'peer')).toBe('root')
    expect(listSessionChatTabs(tabs)).toEqual([root, other])
    expect(getSessionDisplayTitle(peer, tabs)).toBe('prod · 2')
  })
})
