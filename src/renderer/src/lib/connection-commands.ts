import type { Dictionary } from '@renderer/i18n'
import type { ConnectionConfig } from '../../../shared/agent-types'
import { extractSshDestinationHost, isSshCommandLine } from '../../../shared/ssh-destination'
import { findNewestPromptSignal, isPromptHostAligned } from '../../../shared/terminal-prompt-host'

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

export type ConnectionLoginEnvironment = {
  promptHost?: string
  alignment?: 'aligned' | 'drifted' | 'unknown'
  output?: string
  /**
   * Caller intends to paste the initial `ssh` (fresh local PTY). Live
   * environment always wins: a remote hop or password prompt never re-types
   * that first hop.
   */
  preferSshCommand?: boolean
}

export type RemainingConnectionCommands = {
  includeSshCommand: boolean
  commands: string[]
}

function isLocalLoginEnvironment(env: ConnectionLoginEnvironment): boolean {
  if (env.promptHost === 'local-shell') return true
  const signal = env.output ? findNewestPromptSignal(env.output) : undefined
  return signal?.kind === 'local'
}

function isWaitingForSecret(env: ConnectionLoginEnvironment): boolean {
  if (!env.output) return false
  return findNewestPromptSignal(env.output)?.kind === 'waiting'
}

function extractSshDestinationFromOutputLine(line: string): string | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  const direct = extractSshDestinationHost(trimmed)
  if (direct) return direct
  const embedded = trimmed.match(/\bssh(?:\s+.+)$/i)
  return embedded ? extractSshDestinationHost(embedded[0]) : undefined
}

function lastSshDestinationInOutput(output: string): string | undefined {
  const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const destination = extractSshDestinationFromOutputLine(lines[index] ?? '')
    if (destination) return destination
  }
  return undefined
}

/** Commands after the ssh hop matching `host`, skipping that hop's password. */
export function sliceCommandsAfterHop(commands: string[], host: string | undefined): string[] {
  if (!host || commands.length === 0) return commands
  let lastMatch = -1
  for (let index = 0; index < commands.length; index += 1) {
    const destination = extractSshDestinationHost(commands[index] ?? '')
    if (destination && isPromptHostAligned(destination, host)) lastMatch = index
  }
  if (lastMatch < 0) return commands
  let start = lastMatch + 1
  const next = commands[start]
  if (next && !looksLikeCommand(next)) start += 1
  return commands.slice(start)
}

/** Commands from the password of the ssh hop matching `host` (hop is still waiting). */
export function sliceCommandsFromHopSecret(commands: string[], host: string | undefined): string[] {
  if (!host || commands.length === 0) return commands
  let lastMatch = -1
  for (let index = 0; index < commands.length; index += 1) {
    const destination = extractSshDestinationHost(commands[index] ?? '')
    if (destination && isPromptHostAligned(destination, host)) lastMatch = index
  }
  if (lastMatch < 0) return commands
  return commands.slice(lastMatch + 1)
}

function skipInitialSshHop(commands: string[]): string[] {
  if (!commands[0] || !isSshCommandLine(commands[0])) return commands
  let start = 1
  if (commands[1] && !looksLikeCommand(commands[1])) start = 2
  return commands.slice(start)
}

function remainingWithoutLeadingSsh(commands: string[]): RemainingConnectionCommands {
  const leadingSsh = Boolean(commands[0] && isSshCommandLine(commands[0]))
  return {
    includeSshCommand: leadingSsh,
    commands
  }
}

/**
 * Pick the remaining SSH/login steps for the live terminal.
 *
 * - Local / empty PTY: full `ssh` + password + configured actions.
 * - Already on a remote hop (jump box after the target dropped): skip hops
 *   already landed, keep later `ssh` / password actions.
 * - Password/host-key prompt: never paste another `ssh`; type the secret for
 *   the hop that is waiting, then the rest.
 * - Aligned on the operation target: nothing to type.
 */
export function resolveRemainingConnectionCommands(
  connection: ConnectionConfig,
  env: ConnectionLoginEnvironment
): RemainingConnectionCommands {
  const sshCommand = buildSshCommand(connection)
  const loginActions = buildConnectionLoginActions(connection)
  const full = sshCommand ? [sshCommand, ...loginActions] : loginActions
  const waiting = isWaitingForSecret(env)

  if (env.alignment === 'aligned' && !waiting) {
    return { includeSshCommand: false, commands: [] }
  }

  if (waiting) {
    const typedDest = lastSshDestinationInOutput(env.output ?? '')
    const fromSecret = typedDest ? sliceCommandsFromHopSecret(full, typedDest) : undefined
    const remaining =
      fromSecret && fromSecret !== full
        ? fromSecret
        : sliceCommandsFromHopSecret(full, env.promptHost)
    const commands = remaining === full ? loginActions : remaining
    return { includeSshCommand: false, commands }
  }

  if (isLocalLoginEnvironment(env) || (!env.promptHost && env.preferSshCommand !== false)) {
    return remainingWithoutLeadingSsh(full)
  }

  if (env.promptHost && env.promptHost !== 'local-shell') {
    const afterHost = sliceCommandsAfterHop(full, env.promptHost)
    const commands = afterHost === full ? skipInitialSshHop(full) : afterHost
    return remainingWithoutLeadingSsh(commands)
  }

  if (env.preferSshCommand === false) {
    return remainingWithoutLeadingSsh(skipInitialSshHop(full))
  }

  return remainingWithoutLeadingSsh(full)
}

export function stripStoredPassword(connection: ConnectionConfig): ConnectionConfig {
  return {
    ...connection,
    password: undefined,
    resolvedPassword: undefined
  }
}

export function isPasswordEnvVarMissing(connection: ConnectionConfig): boolean {
  return Boolean(connection.passwordEnvVar && !connection.password && !connection.resolvedPassword)
}

export function formatConnectionActionLog(
  command: string,
  actionIndex: number,
  t: Dictionary,
  options?: { forceMask?: boolean }
): string {
  return `${t.terminal.connectionAction} ${actionIndex}\n${
    options?.forceMask ? '<hidden>' : maskPotentialSecret(command)
  }`
}

export function formatConnectionActionSkippedLog(actionIndex: number, t: Dictionary): string {
  return `${t.terminal.connectionActionSkipped} ${actionIndex}\n${t.terminal.connectionActionSkippedReason}`
}

export function maskPotentialSecret(value: string): string {
  if (value.length <= 2) return '<hidden>'
  if (/^\S+$/.test(value) && !looksLikeCommand(value)) return '<hidden>'

  return value
}

/**
 * Login-action lines that should be typed at a shell prompt.
 * Passwords are almost always a single token; any whitespace means a command.
 */
export function looksLikeCommand(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/\s/.test(trimmed)) return true
  return /^(ssh|sudo|su|cd|ls|pwd|kubectl|docker|systemctl|journalctl|cat|tail|grep|vim|vi|export|bash|zsh|sh|fish|enable|exit|tmux|screen|source|passwd|env|unset|alias|history|clear|whoami|id|hostname)\b/.test(
    trimmed
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
