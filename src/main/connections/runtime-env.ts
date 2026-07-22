import { execFile } from 'child_process'
import { existsSync } from 'fs'

const ENV_CACHE = new Map<string, string | undefined>()
const ENV_READ_TIMEOUT_MS = 3000
const ENV_VALUE_START = '__CRESCENT_ENV_VALUE_START__'
const ENV_VALUE_END = '__CRESCENT_ENV_VALUE_END__'

export async function resolveRuntimeEnvValue(name: string): Promise<string | undefined> {
  const envName = name.trim()
  if (!isSafeEnvName(envName)) return undefined

  const directValue = process.env[envName]
  if (directValue) {
    ENV_CACHE.set(envName, directValue)
    return directValue
  }

  if (ENV_CACHE.has(envName)) return ENV_CACHE.get(envName)

  const shellValue = await readEnvValueFromUserShell(envName)
  ENV_CACHE.set(envName, shellValue)
  return shellValue
}

function readEnvValueFromUserShell(name: string): Promise<string | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined)

  const shell = resolveUnixShell(process.env.SHELL)
  const script = `printf '${ENV_VALUE_START}%s${ENV_VALUE_END}' "\${${name}-}"`

  return new Promise((resolve) => {
    execFile(
      shell,
      ['-l', '-i', '-c', script],
      {
        timeout: ENV_READ_TIMEOUT_MS,
        maxBuffer: 1024 * 64,
        env: process.env
      },
      (_error, stdout) => {
        const value = extractMarkedValue(stdout)
        resolve(value || undefined)
      }
    )
  })
}

function extractMarkedValue(output: string): string {
  const start = output.indexOf(ENV_VALUE_START)
  const end = output.indexOf(ENV_VALUE_END, start + ENV_VALUE_START.length)
  if (start < 0 || end < 0) return ''

  return output.slice(start + ENV_VALUE_START.length, end)
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
