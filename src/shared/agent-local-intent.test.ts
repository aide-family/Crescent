import { describe, expect, it } from 'vitest'

import { hasExplicitLocalFileOperationIntent } from './agent-local-intent'

describe('agent local intent detection', () => {
  it('classifies pasted local /etc/hosts edits as local file work', () => {
    const input = [
      '输入：',
      '➜  ~ cat /etc/hosts',
      '127.0.0.1       localhost',
      '192.168.10.168 grafana.moon.com',
      '',
      '把192.168.10.168全部改为192.168.10.169',
      '',
      '我的目的是把本地的hosts文件做一下调整'
    ].join('\n')

    expect(hasExplicitLocalFileOperationIntent(input)).toBe(true)
  })

  it('does not classify explicit remote connection work as local file work', () => {
    expect(
      hasExplicitLocalFileOperationIntent('连接 aide 后把远程 /etc/hosts 里的 192.168.10.168 改掉')
    ).toBe(false)
  })
})
