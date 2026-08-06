import { describe, expect, it } from 'vitest'

import {
  buildLocalOnlyConnectionIntentResult,
  parseConnectionIntentResponse
} from './connection-intent'
import type { ConnectionConfig } from './types'

const aideConnection: ConnectionConfig = {
  id: 'custom-aide',
  source: 'custom',
  name: 'aide',
  host: '192.168.10.168',
  user: 'aide',
  port: 22,
  actions: [],
  sshOptions: []
}

describe('connection intent guardrails', () => {
  it('bypasses SSH matching for local hosts file edits even when the file contains a configured host IP', () => {
    const result = buildLocalOnlyConnectionIntentResult(
      [
        '输入：',
        '➜  ~ cat /etc/hosts',
        '127.0.0.1       localhost',
        '192.168.10.168 grafana.moon.com',
        '',
        '把192.168.10.168全部改为192.168.10.169',
        '我的目的是把本地的hosts文件做一下调整'
      ].join('\n')
    )

    expect(result).toMatchObject({
      ok: false,
      shouldConnect: false,
      confidence: 100,
      matchBasis: 'none'
    })
    expect(result?.reason).toContain('IP addresses inside file contents are treated as data')
  })

  it('accepts a unique aide connection match from model JSON', () => {
    const result = parseConnectionIntentResponse(
      JSON.stringify({
        shouldConnect: true,
        connectionId: 'custom-aide',
        confidence: 92,
        executeAfterLogin: true,
        userGoal: 'check loki health',
        matchBasis: 'name',
        needsClarification: false,
        reason: 'matched aide by name'
      }),
      [aideConnection]
    )

    expect(result).toMatchObject({
      ok: true,
      shouldConnect: true,
      connectionId: 'custom-aide',
      executeAfterLogin: true,
      matchBasis: 'name'
    })
  })
})
