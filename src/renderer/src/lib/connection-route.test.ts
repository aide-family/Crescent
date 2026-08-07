import { describe, expect, it } from 'vitest'

import type { ConnectionConfig } from '../../../shared/agent-types'
import {
  formatConnectionClarifyOptions,
  formatSuggestionsForInput,
  isExecutionTerminalReadyForAgent,
  looksLikeRemoteOpsIntent,
  routeConnection,
  resolveAtMention
} from './connection-route'
import { createTerminalTab } from './terminal-tabs'

const aide: ConnectionConfig = {
  id: 'conn-aide',
  source: 'custom',
  name: 'aide',
  host: '192.168.10.168',
  user: 'aide',
  port: 22,
  actions: [],
  sshOptions: []
}

const prod: ConnectionConfig = {
  id: 'conn-prod',
  source: 'custom',
  name: 'prod',
  host: '10.0.0.1',
  user: 'root',
  port: 22,
  actions: [],
  sshOptions: []
}

describe('routeConnection', () => {
  it('reuses the active connected tab without LLM (layer B)', () => {
    const active = createTerminalTab({
      id: 'tab-1',
      title: 'aide',
      connectionId: aide.id,
      connectionName: aide.name,
      isSsh: true
    })

    const result = routeConnection({
      message: '再看一下 pod 状态',
      activeTabId: active.id,
      activeTab: active,
      sessionTabs: [active],
      connections: [aide, prod]
    })

    expect(result.action).toBe('reuse')
    expect(result.targetTabId).toBe(active.id)
    expect(result.connectionId).toBe(aide.id)
  })

  it('switches to a peer tab when @mention or name points elsewhere (layer A)', () => {
    const aideTab = createTerminalTab({
      id: 'tab-aide',
      title: 'aide',
      connectionId: aide.id,
      connectionName: aide.name,
      isSsh: true,
      sessionGroupId: 'session-1'
    })
    const prodTab = createTerminalTab({
      id: 'tab-prod',
      title: 'prod',
      connectionId: prod.id,
      connectionName: prod.name,
      isSsh: true,
      sessionGroupId: 'session-1'
    })

    const byAt = routeConnection({
      message: '@prod 查一下磁盘',
      activeTabId: aideTab.id,
      activeTab: aideTab,
      sessionTabs: [aideTab, prodTab],
      connections: [aide, prod]
    })
    expect(byAt.action).toBe('switch')
    expect(byAt.targetTabId).toBe(prodTab.id)

    const byName = routeConnection({
      message: '检查 prod 集群状态',
      activeTabId: aideTab.id,
      activeTab: aideTab,
      sessionTabs: [aideTab, prodTab],
      connections: [aide, prod]
    })
    expect(byName.action).toBe('switch')
    expect(byName.targetTabId).toBe(prodTab.id)
  })

  it('auto-connects the unique configured cluster on remote intent with no active SSH', () => {
    const local = createTerminalTab({ id: 'tab-local', title: 'Terminal', isSsh: false })

    const result = routeConnection({
      message: '整理集群网络架构图',
      activeTabId: local.id,
      activeTab: local,
      sessionTabs: [local],
      connections: [aide]
    })

    expect(result.action).toBe('connect')
    expect(result.connectionId).toBe(aide.id)
    expect(result.executeAfterLogin).toBe(true)
    expect(result.reason).toBe('remote-unique-connect')
  })

  it('clarifies with structured options when multiple clusters and remote intent', () => {
    const local = createTerminalTab({ id: 'tab-local', title: 'Terminal', isSsh: false })

    const result = routeConnection({
      message: '检查集群健康状态',
      activeTabId: local.id,
      activeTab: local,
      sessionTabs: [local],
      connections: [aide, prod]
    })

    expect(result.action).toBe('clarify')
    expect(result.clarifyOptions).toEqual([
      { id: aide.id, label: aide.name },
      { id: prod.id, label: prod.name }
    ])
  })

  it('prefers lastUsedConnectionId when multiple clusters and remote intent', () => {
    const local = createTerminalTab({ id: 'tab-local', title: 'Terminal', isSsh: false })

    const result = routeConnection({
      message: 'kubectl get pods -A',
      activeTabId: local.id,
      activeTab: local,
      sessionTabs: [local],
      connections: [aide, prod],
      lastUsedConnectionId: prod.id
    })

    expect(result.action).toBe('connect')
    expect(result.connectionId).toBe(prod.id)
    expect(result.reason).toBe('remote-last-used-connect')
  })

  it('switches to the session connected tab for remote intent', () => {
    const local = createTerminalTab({
      id: 'tab-local',
      title: 'Terminal',
      isSsh: false,
      sessionGroupId: 'session-1'
    })
    const aideTab = createTerminalTab({
      id: 'tab-aide',
      title: 'aide',
      connectionId: aide.id,
      connectionName: aide.name,
      isSsh: true,
      sessionGroupId: 'session-1'
    })

    const result = routeConnection({
      message: '再巡检一遍集群',
      activeTabId: local.id,
      activeTab: local,
      sessionTabs: [local, aideTab],
      connections: [aide, prod]
    })

    expect(result.action).toBe('switch')
    expect(result.targetTabId).toBe(aideTab.id)
  })

  it('falls back to LLM only when connection is unknown (layer D)', () => {
    const local = createTerminalTab({ id: 'tab-local', title: 'Terminal', isSsh: false })

    const result = routeConnection({
      message: '帮我写一首诗',
      activeTabId: local.id,
      activeTab: local,
      sessionTabs: [local],
      connections: [aide, prod]
    })

    expect(result.action).toBe('reuse')
    expect(result.reason).toBe('active-local')
  })

  it('skips intent for continue / non-terminal / local-file flags', () => {
    const local = createTerminalTab({ id: 'tab-local', title: 'Terminal' })
    expect(
      routeConnection({
        message: '继续',
        activeTabId: local.id,
        activeTab: local,
        sessionTabs: [local],
        connections: [aide],
        resumeRequested: true
      }).action
    ).toBe('reuse')
  })
})

describe('resolveAtMention', () => {
  it('resolves @tab title and @connection name', () => {
    const tab = createTerminalTab({
      id: 't1',
      title: 'grafana',
      connectionId: aide.id,
      connectionName: aide.name
    })
    expect(resolveAtMention('请在 @grafana 上执行', [aide, prod], [tab])?.kind).toBe('tab')
    expect(resolveAtMention('到 @prod 上看看', [aide, prod], [tab])?.kind).toBe('connection')
  })
})

describe('looksLikeRemoteOpsIntent', () => {
  it('detects kubectl and cluster keywords', () => {
    expect(looksLikeRemoteOpsIntent('kubectl get pods')).toBe(true)
    expect(looksLikeRemoteOpsIntent('整理集群网络架构图')).toBe(true)
    expect(looksLikeRemoteOpsIntent('写一首诗')).toBe(false)
  })
})

describe('isExecutionTerminalReadyForAgent', () => {
  it('blocks mode none and terminalReady false', () => {
    expect(
      isExecutionTerminalReadyForAgent({
        tab: createTerminalTab({ terminalReady: false, isSsh: true, connectionId: aide.id }),
        terminalMode: 'pty'
      })
    ).toBe(false)
    expect(
      isExecutionTerminalReadyForAgent({
        tab: createTerminalTab({ terminalReady: true, isSsh: true, connectionId: aide.id }),
        terminalMode: 'none'
      })
    ).toBe(false)
    expect(
      isExecutionTerminalReadyForAgent({
        tab: createTerminalTab({ terminalReady: true, isSsh: true, connectionId: aide.id }),
        terminalMode: 'pty'
      })
    ).toBe(true)
  })
})

describe('formatSuggestionsForInput', () => {
  it('numbers selected suggestion texts', () => {
    expect(formatSuggestionsForInput(['重启 Loki', '2. 清理缓存'])).toBe(
      '1. 重启 Loki\n2. 清理缓存'
    )
  })
})

describe('formatConnectionClarifyOptions', () => {
  it('numbers connection labels', () => {
    expect(
      formatConnectionClarifyOptions([
        { id: 'a', label: 'aide' },
        { id: 'b', label: 'prod' }
      ])
    ).toBe('1. aide\n2. prod')
  })
})
