import { describe, expect, it } from 'vitest'

import { buildLocalOnlyConnectionIntentResult } from './connection-intent'

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
})
