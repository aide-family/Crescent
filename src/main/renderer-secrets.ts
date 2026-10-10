import { randomUUID } from 'node:crypto'
import type { AgentConfig, ConnectionConfig, ConnectionInput } from '../shared/agent-types'
import { looksLikeLoginCommand } from '../shared/login-actions'

export const STORED_SECRET = '__CRESCENT_STORED_SECRET__'
const referenceByKey = new Map<string, string>()
const keyByReference = new Map<string, { connectionId: string; field: string }>()

function reference(connectionId: string, field: string, value?: string): string | undefined {
  if (!value) return undefined
  const key = JSON.stringify([connectionId, field])
  let token = referenceByKey.get(key)
  if (!token) {
    token = `__crescent_secret_${randomUUID()}__`
    referenceByKey.set(key, token)
    keyByReference.set(token, { connectionId, field })
  }
  return token
}

export function publicConnection(connection: ConnectionConfig): ConnectionConfig {
  return {
    ...connection,
    password: reference(connection.id, 'password', connection.password),
    resolvedPassword: reference(connection.id, 'resolvedPassword', connection.resolvedPassword),
    rootPassword: reference(connection.id, 'rootPassword', connection.rootPassword),
    actions: connection.actions?.map((action, index) =>
      looksLikeLoginCommand(action) ? action : reference(connection.id, `action:${index}`, action)!
    )
  }
}

export function mergeConnectionSecrets(
  input: ConnectionInput,
  current?: ConnectionConfig,
  sources: ConnectionConfig[] = []
): ConnectionInput {
  const restore = (value: string | undefined, field: string): string | undefined => {
    if (!value?.startsWith('__crescent_secret_')) return value
    const ref = keyByReference.get(value)
    const source =
      ref &&
      (current?.id === ref.connectionId
        ? current
        : sources.find((item) => item.id === ref.connectionId))
    const matchingField =
      ref &&
      (ref.field === field || (field.startsWith('action:') && ref.field.startsWith('action:')))
    if (!source || !ref || !matchingField) {
      throw new Error('Invalid stored credential reference')
    }
    if (ref.field.startsWith('action:')) return source.actions?.[Number(ref.field.slice(7))]
    return source[ref.field as 'password' | 'rootPassword']
  }
  return {
    ...input,
    password: restore(input.password, 'password'),
    rootPassword: restore(input.rootPassword, 'rootPassword'),
    actions: input.actions?.map((value, index) => restore(value, `action:${index}`) ?? '')
  }
}

/** Only the terminal owner may consume a reference, at a live secret prompt on its bound connection. */
export function resolveTerminalSecretReference(
  input: string,
  connection: ConnectionConfig | undefined,
  waitingForSecret: boolean,
  privilegePrompt = false
): string | undefined {
  if (!input.startsWith('__crescent_secret_')) return undefined
  const token = input.replace(/\r$/, '')
  const ref = keyByReference.get(token)
  if (
    !waitingForSecret ||
    !connection ||
    ref?.connectionId !== connection.id ||
    input !== `${token}\r`
  ) {
    throw new Error('Stored credential requires its bound terminal and a live password prompt')
  }
  if (ref.field === 'rootPassword' && !privilegePrompt)
    throw new Error('Root credential requires a privilege password prompt')
  const value = ref.field.startsWith('action:')
    ? connection.actions?.[Number(ref.field.slice(7))]
    : connection[ref.field as 'password' | 'resolvedPassword' | 'rootPassword']
  if (!value || /[\r\n\0]/.test(value))
    throw new Error('Stored credential is unavailable or invalid')
  return `${value}\r`
}

export function publicAgentConfig(config: AgentConfig): AgentConfig {
  return {
    ...config,
    openAiApiKey: undefined,
    providers: config.providers.map((provider) => ({
      ...provider,
      apiKey: provider.apiKey ? STORED_SECRET : ''
    })),
    mcpServers: config.mcpServers.map((server) => ({
      ...server,
      env: Object.fromEntries(
        Object.entries(server.env).map(([key, value]) => [key, value ? STORED_SECRET : ''])
      ),
      headers:
        server.headers &&
        Object.fromEntries(
          Object.entries(server.headers).map(([key, value]) => [key, value ? STORED_SECRET : ''])
        )
    }))
  }
}

export function mergeAgentSecrets(input: Partial<AgentConfig>, current: AgentConfig): AgentConfig {
  const restore = (value: string | undefined, saved?: string): string | undefined => {
    if (value !== STORED_SECRET) return value
    if (saved === undefined) throw new Error('Invalid stored secret placeholder')
    return saved
  }
  const restoreRecord = (
    record: Record<string, string>,
    saved?: Record<string, string>
  ): Record<string, string> =>
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key, restore(value, saved?.[key]) ?? ''])
    )
  return {
    ...current,
    ...input,
    providers: (input.providers ?? current.providers).map((provider) => ({
      ...provider,
      apiKey: restore(provider.apiKey, current.providers.find((p) => p.id === provider.id)?.apiKey)
    })),
    mcpServers: (input.mcpServers ?? current.mcpServers).map((server) => {
      const saved = current.mcpServers.find((s) => s.id === server.id)
      return {
        ...server,
        env: restoreRecord(server.env, saved?.env),
        headers: server.headers && restoreRecord(server.headers, saved?.headers)
      }
    })
  }
}
