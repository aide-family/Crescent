import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

import { readWindowsRegistryEnvValue } from './windows-env'

const ENV_CACHE = new Map<string, { value: string | undefined; expiresAt: number }>()
const ENV_HIT_TTL_MS = 5 * 60_000
const ENV_MISS_TTL_MS = 5_000
const ENV_READ_TIMEOUT_MS = 12_000
const ENV_VALUE_START = '__CRESCENT_ENV_VALUE_START__'
const ENV_VALUE_END = '__CRESCENT_ENV_VALUE_END__'

export async function resolveRuntimeEnvValue(
  name: string,
  options?: { forceRefresh?: boolean }
): Promise<string | undefined> {
  const envName = name.trim()
  if (!isSafeEnvName(envName)) return undefined

  const directValue = process.env[envName]
  if (directValue) {
    cacheEnvValue(envName, directValue)
    return directValue
  }

  if (!options?.forceRefresh) {
    const cached = ENV_CACHE.get(envName)
    if (cached && cached.expiresAt > Date.now()) return cached.value
  }

  const resolved =
    process.platform === 'win32'
      ? await readWindowsRegistryEnvValue(envName)
      : await readEnvValueFromUserShell(envName)
  cacheEnvValue(envName, resolved)
  return resolved
}

export function clearRuntimeEnvCache(): void {
  ENV_CACHE.clear()
}

function cacheEnvValue(name: string, value: string | undefined): void {
  ENV_CACHE.set(name, {
    value,
    expiresAt: Date.now() + (value ? ENV_HIT_TTL_MS : ENV_MISS_TTL_MS)
  })
}

function readEnvValueFromUserShell(name: string): Promise<string | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined)

  const shell = resolveUnixShell(process.env.SHELL)
  const script = buildEnvReadScript(shell, name)

  return new Promise((resolve) => {
    // Use non-interactive `-c` only (no `-i`). GUI/packaged Electron apps have no TTY;
    // interactive login shells often hang on oh-my-zsh and miss the 3–12s timeout.
    execFile(
      shell,
      ['-c', script],
      {
        timeout: ENV_READ_TIMEOUT_MS,
        maxBuffer: 1024 * 256,
        env: {
          ...process.env,
          HOME: process.env.HOME || homedir(),
          TERM: 'dumb',
          CI: '1'
        }
      },
      (_error, stdout) => {
        const value = extractMarkedValue(String(stdout ?? ''))
        resolve(value || undefined)
      }
    )
  })
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
