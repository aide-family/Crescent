import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { homedir, userInfo } from 'os'
import { join } from 'path'

import { writeSystemLog } from '../logging'
import { readWindowsRegistryEnvValue } from './windows-env'

const ENV_CACHE = new Map<string, { value: string | undefined; expiresAt: number }>()
const ENV_INFLIGHT = new Map<string, Promise<string | undefined>>()
const ENV_HIT_TTL_MS = 5 * 60_000
const ENV_MISS_TTL_MS = 5_000
const ENV_READ_TIMEOUT_MS = 12_000
const ENV_VALUE_START = '__CRESCENT_ENV_VALUE_START__'
const ENV_VALUE_END = '__CRESCENT_ENV_VALUE_END__'
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

let cacheGeneration = 0

export type RuntimeEnvReaders = {
  readLiteral?: (name: string) => string | undefined
  readShell?: (name: string) => Promise<string | undefined>
}

export async function resolveRuntimeEnvValue(
  name: string,
  options?: { forceRefresh?: boolean; readers?: RuntimeEnvReaders }
): Promise<string | undefined> {
  const envName = name.trim()
  if (!isSafeEnvName(envName)) return undefined

  if (!options?.forceRefresh) {
    const cached = ENV_CACHE.get(envName)
    if (cached && cached.expiresAt > Date.now()) return cached.value
  }

  const existing = ENV_INFLIGHT.get(envName)
  if (existing) return existing

  const generation = cacheGeneration
  const pending = loadRuntimeEnvValue(envName, options?.readers)
    .then((value) => {
      if (generation === cacheGeneration) cacheEnvValue(envName, value)
      noteInheritedMismatch(envName, value)
      return value
    })
    .finally(() => {
      if (ENV_INFLIGHT.get(envName) === pending) ENV_INFLIGHT.delete(envName)
    })
  ENV_INFLIGHT.set(envName, pending)
  return pending
}

export function clearRuntimeEnvCache(): void {
  cacheGeneration += 1
  ENV_CACHE.clear()
  ENV_INFLIGHT.clear()
}

/**
 * Last literal assignment wins. A later `$` or command-substitution assignment
 * drops any earlier literal so the caller can fall through to the shell.
 */
export function readLiteralEnvFromProfileText(
  name: string,
  contents: readonly string[]
): string | undefined {
  if (!isSafeEnvName(name)) return undefined

  let literal: string | undefined
  for (const content of contents) {
    for (const line of content.split(/\r?\n/)) {
      const parsed = classifyProfileAssignment(line, name)
      if (parsed.kind === 'none') continue
      literal = parsed.kind === 'literal' ? parsed.value : undefined
    }
  }
  return literal
}

function noteInheritedMismatch(name: string, durable: string | undefined): void {
  const inherited = process.env[name]
  if (!inherited || inherited === durable) return
  writeSystemLog(
    'warn',
    `runtime env ${name} is set on the parent process but not used; dev and packaged builds both read the shell profile or user environment`
  )
}

function cacheEnvValue(name: string, value: string | undefined): void {
  ENV_CACHE.set(name, {
    value,
    expiresAt: Date.now() + (value ? ENV_HIT_TTL_MS : ENV_MISS_TTL_MS)
  })
}

function loadRuntimeEnvValue(
  name: string,
  readers?: RuntimeEnvReaders
): Promise<string | undefined> {
  if (readers?.readLiteral || readers?.readShell) {
    const literal = readers.readLiteral?.(name)
    if (literal) return Promise.resolve(literal)
    return readers.readShell ? readers.readShell(name) : Promise.resolve(undefined)
  }

  if (process.platform === 'win32') return readWindowsRegistryEnvValue(name)

  const literal = readLiteralEnvFromUserProfiles(name)
  if (literal) return Promise.resolve(literal)
  return readEnvValueFromUserShell(name)
}

function readLiteralEnvFromUserProfiles(name: string): string | undefined {
  const shell = resolveUnixShell(process.env.SHELL)
  const shellName = shell.split('/').pop() ?? ''
  const contents: string[] = []
  for (const file of profileFilesForShell(shellName)) {
    if (!existsSync(file)) continue
    try {
      contents.push(readFileSync(file, 'utf8'))
    } catch {
      // An unreadable profile falls through to the remaining files, then the shell.
    }
  }
  return readLiteralEnvFromProfileText(name, contents)
}

type ProfileAssignment = { kind: 'none' } | { kind: 'literal'; value: string } | { kind: 'dynamic' }

function classifyProfileAssignment(line: string, name: string): ProfileAssignment {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return { kind: 'none' }

  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
  if (!match || match[1] !== name) return { kind: 'none' }

  const parsed = parseAssignmentValue(match[2])
  if (!parsed || parsed.kind === 'dynamic' || !parsed.value) return { kind: 'dynamic' }
  return parsed
}

function parseAssignmentValue(
  raw: string
): { kind: 'literal'; value: string } | { kind: 'dynamic' } {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: 'literal', value: '' }

  if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
    const quote = trimmed[0]
    const end = trimmed.indexOf(quote, 1)
    if (end < 0) return { kind: 'dynamic' }
    if (!isOnlyCommentAfter(trimmed.slice(end + 1))) return { kind: 'dynamic' }
    const inner = trimmed.slice(1, end)
    if (inner.includes('$') || inner.includes('`') || inner.includes('\\')) {
      return { kind: 'dynamic' }
    }
    return { kind: 'literal', value: inner }
  }

  const token = trimmed.split(/\s+/, 1)[0] ?? ''
  if (!isOnlyCommentAfter(trimmed.slice(token.length))) return { kind: 'dynamic' }
  if (token.includes('$') || token.includes('`') || token.includes('\\')) {
    return { kind: 'dynamic' }
  }
  return { kind: 'literal', value: token }
}

function isOnlyCommentAfter(rest: string): boolean {
  const trimmed = rest.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

function readEnvValueFromUserShell(name: string): Promise<string | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined)

  const shell = resolveUnixShell(process.env.SHELL)
  const script = buildEnvReadScript(shell, name)

  return new Promise((resolve) => {
    // Use non-interactive `-c` only (no `-i` / `-l`). GUI/packaged Electron apps have no TTY;
    // interactive login shells often hang on oh-my-zsh and miss the timeout.
    execFile(
      shell,
      ['-c', script],
      {
        timeout: ENV_READ_TIMEOUT_MS,
        maxBuffer: 1024 * 256,
        env: buildCleanShellEnv(shell)
      },
      (error, stdout) => {
        const value = extractMarkedValue(String(stdout ?? ''))
        if (error) logShellReadFailure(name, error)
        resolve(value || undefined)
      }
    )
  })
}

function buildCleanShellEnv(shell: string): NodeJS.ProcessEnv {
  const home = process.env.HOME || homedir()
  const user = process.env.USER || process.env.LOGNAME || safeUserName()
  return {
    HOME: home,
    USER: user,
    LOGNAME: process.env.LOGNAME || user,
    SHELL: shell,
    TMPDIR: process.env.TMPDIR || '/tmp',
    LANG: process.env.LANG || 'C.UTF-8',
    PATH: SYSTEM_PATH,
    TERM: 'dumb',
    CI: '1'
  }
}

function logShellReadFailure(name: string, error: Error): void {
  const err = error as NodeJS.ErrnoException & { signal?: NodeJS.Signals; killed?: boolean }
  writeSystemLog(
    'warn',
    `runtime env shell read failed name=${name} code=${err.code ?? 'unknown'} signal=${err.signal ?? 'none'} timedOut=${err.killed ? '1' : '0'}`
  )
}

function safeUserName(): string {
  try {
    return userInfo().username
  } catch {
    return ''
  }
}

export function buildEnvReadScript(shellPath: string, name: string): string {
  const shellName = shellPath.split('/').pop() ?? ''
  const files = profileFilesForShell(shellName)
    .map((file) => shellQuote(file))
    .join(' ')

  return [
    `for __crescent_profile in ${files}; do`,
    '  [ -f "$__crescent_profile" ] || continue',
    '  . "$__crescent_profile" >/dev/null 2>&1 || true',
    'done',
    `printf '${ENV_VALUE_START}%s${ENV_VALUE_END}' "\${${name}-}"`
  ].join('\n')
}

export function extractMarkedValue(output: string): string {
  const start = output.indexOf(ENV_VALUE_START)
  const end = output.indexOf(ENV_VALUE_END, start + ENV_VALUE_START.length)
  if (start < 0 || end < 0) return ''

  return output.slice(start + ENV_VALUE_START.length, end)
}

function profileFilesForShell(shellName: string): string[] {
  const home = process.env.HOME || homedir()
  if (shellName.includes('zsh')) {
    return [
      join(home, '.zshenv'),
      join(home, '.zprofile'),
      join(home, '.zshrc'),
      join(home, '.zlogin'),
      join(home, '.profile')
    ]
  }

  if (shellName.includes('bash')) {
    return [
      join(home, '.bash_profile'),
      join(home, '.bash_login'),
      join(home, '.bashrc'),
      join(home, '.profile')
    ]
  }

  return [join(home, '.profile'), join(home, '.bashrc'), join(home, '.zshrc')]
}

function resolveUnixShell(preferredShell: string | undefined): string {
  const candidates = [preferredShell, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(
    (candidate): candidate is string => Boolean(candidate)
  )

  return candidates.find((candidate) => existsSync(candidate)) ?? '/bin/sh'
}

function isSafeEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
