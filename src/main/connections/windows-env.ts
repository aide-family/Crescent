import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const USER_ENV_KEY = 'HKCU\\Environment'
const MACHINE_ENV_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'

export function parseRegQueryValue(stdout: string, name: string): string | undefined {
  if (!stdout || !name) return undefined

  const typePattern =
    /^(\S+)\s+(?:REG_SZ|REG_EXPAND_SZ|REG_MULTI_SZ|REG_DWORD|REG_QWORD|REG_BINARY|REG_NONE)\s+(.*)$/i

  for (const rawLine of String(stdout).split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = line.match(typePattern)
    if (match && match[1].toLowerCase() === name.toLowerCase()) {
      return match[2]
    }
  }

  return undefined
}

export function expandWindowsEnvRefs(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/%([^%]+)%/g, (_match, key: string) => {
    const resolved = env[key] ?? env[key.toUpperCase()] ?? env[key.toLowerCase()]
    return resolved ?? `%${key}%`
  })
}

export async function readWindowsRegistryEnvValue(
  name: string,
  options?: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    execFile?: typeof execFileAsync
  }
): Promise<string | undefined> {
  const platform = options?.platform ?? process.platform
  if (platform !== 'win32' || !isSafeEnvName(name)) return undefined

  const run = options?.execFile ?? execFileAsync
  const env = options?.env ?? process.env

  for (const key of [USER_ENV_KEY, MACHINE_ENV_KEY]) {
    try {
      const { stdout } = await run('reg', ['query', key, '/v', name], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 1024 * 64
      })
      const raw = parseRegQueryValue(String(stdout ?? ''), name)
      if (!raw) continue
      const expanded = expandWindowsEnvRefs(raw, env).trim()
      if (expanded) return expanded
    } catch {
      // Missing value or reg failure — try the next hive.
    }
  }

  return undefined
}

function isSafeEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}
