import { describe, expect, it } from 'vitest'

import {
  buildConnectionCommands,
  buildConnectionLoginActions,
  isPasswordEnvVarMissing,
  mergeConnectionInput
} from './connection-commands'
import type { ConnectionConfig } from '../../../shared/agent-types'

const baseConnection: ConnectionConfig = {
  id: 'custom-1',
  name: 'prod',
  source: 'custom',
  host: '10.0.0.1',
  user: 'root'
}

describe('connection-commands password env', () => {
  it('detects missing password env when only the variable name is configured', () => {
    expect(
      isPasswordEnvVarMissing({
        ...baseConnection,
        passwordEnvVar: 'BLJ_PASSWORD'
      })
    ).toBe(true)
  })

  it('does not treat resolved or stored passwords as missing', () => {
    expect(
      isPasswordEnvVarMissing({
        ...baseConnection,
        passwordEnvVar: 'BLJ_PASSWORD',
        resolvedPassword: 'secret'
      })
    ).toBe(false)
    expect(
      isPasswordEnvVarMissing({
        ...baseConnection,
        passwordEnvVar: 'BLJ_PASSWORD',
        password: 'secret'
      })
    ).toBe(false)
  })

  it('includes resolved password as the first login action', () => {
    expect(
      buildConnectionLoginActions({
        ...baseConnection,
        resolvedPassword: 'secret',
        actions: ['sudo -i']
      })
    ).toEqual(['secret', 'sudo -i'])
  })

  it('builds ssh + login actions only when secrets are available', () => {
    const missing = buildConnectionCommands({
      ...baseConnection,
      passwordEnvVar: 'BLJ_PASSWORD'
    })
    expect(missing[0]).toContain('ssh')
    expect(missing).toHaveLength(1)

    const ready = buildConnectionCommands({
      ...baseConnection,
      passwordEnvVar: 'BLJ_PASSWORD',
      resolvedPassword: 'secret',
      actions: ['enable']
    })
    expect(ready).toEqual([expect.stringContaining('ssh'), 'secret', 'enable'])
  })

  it('prefers refreshed resolvedPassword when merging connection input', () => {
    const merged = mergeConnectionInput(
      {
        ...baseConnection,
        passwordEnvVar: 'BLJ_PASSWORD',
        resolvedPassword: 'from-shell'
      },
      {
        ...baseConnection,
        passwordEnvVar: 'BLJ_PASSWORD'
      }
    )
    expect(merged.resolvedPassword).toBe('from-shell')
    expect(isPasswordEnvVarMissing(merged)).toBe(false)
  })
})
