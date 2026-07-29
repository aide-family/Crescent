import type { Dictionary } from '@renderer/i18n'
import type { ConnectionConfig } from '../../../shared/agent-types'

export function mergeConnectionInput(
  saved: ConnectionConfig | undefined,
  fallback: ConnectionConfig
): ConnectionConfig {
  return {
    ...fallback,
    ...saved,
    password: saved?.password ?? fallback.password,
    passwordEnvVar: saved?.passwordEnvVar ?? fallback.passwordEnvVar,
    resolvedPassword: saved?.resolvedPassword ?? fallback.resolvedPassword,
    sshOptions: saved?.sshOptions?.length ? saved.sshOptions : fallback.sshOptions,
    actions: saved?.actions?.length ? saved.actions : fallback.actions
  }
}

export function parseSshOptions(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/\s*\\$/, '')
        .trim()
    )
    .filter(Boolean)
}

export function parseLoginActions(value: string): string[] {
  return value.split(/\r?\n/).filter((line) => line.trim())
}

export function buildConnectionCommands(connection: ConnectionConfig): string[] {
  if (!connection.host) return []

  return [buildSshCommand(connection), ...buildConnectionLoginActions(connection)]
}

export function buildConnectionLoginActions(connection: ConnectionConfig): string[] {
  const password = connection.password || connection.resolvedPassword
  const passwordActions = password ? [password] : []
  return [...passwordActions, ...(connection.actions ?? [])]
}

export function isPasswordEnvVarMissing(connection: ConnectionConfig): boolean {
  return Boolean(connection.passwordEnvVar && !connection.password && !connection.resolvedPassword)
}

export function formatConnectionActionLog(
  command: string,
  actionIndex: number,
  t: Dictionary
): string {
  return `${t.terminal.connectionAction} ${actionIndex}\n${maskPotentialSecret(command)}`
}

export function maskPotentialSecret(value: string): string {
  if (value.length <= 2) return '<hidden>'
  if (/^\S+$/.test(value) && !looksLikeCommand(value)) return '<hidden>'

  return value
}

export function looksLikeCommand(value: string): boolean {
  return /^(ssh|sudo|su|cd|ls|pwd|kubectl|docker|systemctl|journalctl|cat|tail|grep|vim|vi|export)\b/.test(
    value.trim()
  )
}

export function createCustomConnectionId(): string {
  return `custom-${crypto.randomUUID()}`
}

export function buildSshCommand(connection: ConnectionConfig): string {
  if (connection.source === 'local') return ''
  if (connection.source === 'ssh-config') return `ssh ${shellQuote(connection.name)}`

  return [
    'ssh',
    connection.port ? `-p ${connection.port}` : '',
    connection.identityFile ? `-i ${shellQuote(connection.identityFile)}` : '',
    ...(connection.sshOptions ?? []),
    connection.user ? `-l ${shellQuote(connection.user)}` : '',
    shellQuote(connection.host)
  ]
    .filter(Boolean)
    .join(' ')
}

export function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}
