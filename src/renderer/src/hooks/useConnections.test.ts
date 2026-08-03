import { describe, expect, it } from 'vitest'

import {
  connectionToForm,
  createEmptyConnectionForm,
  normalizeConnectionInputForSave
} from './useConnections'
import type { ConnectionConfig } from '../../../shared/agent-types'

describe('connection form helpers', () => {
  it('creates an empty editable form', () => {
    expect(createEmptyConnectionForm()).toEqual({
      name: '',
      host: '',
      user: '',
      password: '',
      passwordEnvVar: '',
      port: 22,
      identityFile: '',
      sshOptions: [],
      description: '',
      actions: []
    })
  })

  it('maps a connection into form fields', () => {
    const connection: ConnectionConfig = {
      id: 'c1',
      source: 'custom',
      name: 'prod',
      host: 'example.com',
      user: 'root',
      port: 2222,
      sshOptions: ['-o StrictHostKeyChecking=no'],
      actions: ['password']
    }

    expect(connectionToForm(connection)).toMatchObject({
      id: 'c1',
      name: 'prod',
      host: 'example.com',
      user: 'root',
      port: 2222
    })
  })

  it('normalizes save input and rejects incomplete forms', () => {
    expect(normalizeConnectionInputForSave(createEmptyConnectionForm(), '', '')).toBeNull()

    const normalized = normalizeConnectionInputForSave(
      {
        ...createEmptyConnectionForm(),
        name: '  box  ',
        host: ' 10.0.0.1 ',
        user: '  alice ',
        port: 22
      },
      'password\nwhoami',
      '-o IdentitiesOnly=yes'
    )

    expect(normalized).toEqual({
      id: undefined,
      name: 'box',
      host: '10.0.0.1',
      user: 'alice',
      password: undefined,
      passwordEnvVar: undefined,
      port: 22,
      identityFile: undefined,
      sshOptions: ['-o IdentitiesOnly=yes'],
      description: undefined,
      actions: ['password', 'whoami']
    })
  })
})
