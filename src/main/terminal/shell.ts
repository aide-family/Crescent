import { homedir } from 'os'
import { existsSync } from 'fs'

export interface ShellLaunchConfig {
  shell: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

export function getDefaultTerminalCwd(): string {
  return homedir()
}

export function resolveShellLaunchConfig(env: NodeJS.ProcessEnv = process.env): ShellLaunchConfig {
  const cwd = getDefaultTerminalCwd()

  if (process.platform === 'win32') {
    return {
      shell: env.ComSpec || 'powershell.exe',
      args: [],
      cwd,
      env: createTerminalEnv(env)
    }
  }

  return {
    shell: resolveUnixShell(env.SHELL),
    args: ['-l', '-i'],
    cwd,
    env: createTerminalEnv(env)
  }
}

function resolveUnixShell(preferredShell: string | undefined): string {
  const candidates = [preferredShell, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(
    (candidate): candidate is string => Boolean(candidate)
  )

  return candidates.find((candidate) => existsSync(candidate)) ?? '/bin/sh'
}

function createTerminalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleanEnv = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )

  return {
    ...cleanEnv,
    TERM: env.TERM || 'xterm-256color',
    COLORTERM: env.COLORTERM || 'truecolor'
  }
}
