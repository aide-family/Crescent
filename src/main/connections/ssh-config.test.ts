import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import { loadSshConfigConnections } from './ssh-config'

describe('loadSshConfigConnections', () => {
  it('loads concrete Host entries from ssh config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crescent-ssh-'))
    const configPath = join(dir, 'config')
    writeFileSync(
      configPath,
      [
        'Host prod prod-alias',
        '  HostName 10.0.0.8',
        '  User root',
        '  Port 2222',
        '  IdentityFile ~/.ssh/prod.pem',
        '',
        'Host *',
        '  User fallback'
      ].join('\n'),
      'utf8'
    )

    const connections = loadSshConfigConnections(configPath)

    expect(connections).toHaveLength(2)
    expect(connections[0]).toMatchObject({
      source: 'ssh-config',
      host: '10.0.0.8',
      user: 'root',
      port: 2222,
      identityFile: '~/.ssh/prod.pem'
    })
    expect(connections.map((connection) => connection.name)).toEqual(['prod', 'prod-alias'])
  })
})
