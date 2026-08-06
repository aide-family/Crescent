import { describe, expect, it } from 'vitest'

import type { ConnectionConfig } from '../../../shared/agent-types'
import { findDirectlyMentionedConnection } from './agent-input'

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

describe('agent input connection matching', () => {
  it('does not match a connection from IPs inside pasted local hosts file content', () => {
    const input = [
      '➜  ~ cat /etc/hosts',
      '127.0.0.1       localhost',
      '192.168.10.168 grafana.moon.com',
      '',
      '把192.168.10.168全部改为192.168.10.169',
      '我的目的是把本地的hosts文件做一下调整'
    ].join('\n')

    expect(findDirectlyMentionedConnection(input, [aideConnection])).toBeUndefined()
  })

  it('requires explicit connection wording before matching host or user tokens directly', () => {
    expect(
      findDirectlyMentionedConnection('检查 192.168.10.168 的状态', [aideConnection])
    ).toBeUndefined()
    expect(findDirectlyMentionedConnection('ssh 192.168.10.168', [aideConnection])).toEqual(
      aideConnection
    )
    expect(findDirectlyMentionedConnection('连接 192.168.10.168', [aideConnection])).toEqual(
      aideConnection
    )
  })

  it('still matches a unique connection by name for remote operation shorthand', () => {
    expect(findDirectlyMentionedConnection('检查 aide 集群状态', [aideConnection])).toEqual(
      aideConnection
    )
  })

  it('matches 登录aide集群 without a space after 登录', () => {
    expect(
      findDirectlyMentionedConnection('登录aide集群，查看loki服务健康状态', [aideConnection])
    ).toEqual(aideConnection)
  })
})
