import { collectSimpleCommands, type SimpleCommand } from '../shell-command'
import { SimpleCommandRisk } from './types'

export const DURATION = /^(?:\d+(?:\.\d+)?)[smhd]?$/

export const SHELL_NAMES = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])

export function stripWrappers(argv: string[]): string[] {
  let current = [...argv]
  for (let guard = 0; guard < 8 && current.length > 0; guard++) {
    const cmd = commandBasename(current[0] ?? '')
    if (cmd === 'timeout') {
      current = skipTimeout(current)
      continue
    }
    if (cmd === 'command') {
      current = current.slice(1)
      while (current[0]?.startsWith('-')) current = current.slice(1)
      continue
    }
    if (cmd === 'nice' || cmd === 'stdbuf' || cmd === 'nohup' || cmd === 'time') {
      current = current.slice(1)
      while (current[0]?.startsWith('-')) {
        const flag = current[0]
        if (
          (flag === '-n' || flag === '-e' || flag === '-o' || flag === '-i') &&
          !flag.includes('=')
        ) {
          current = current.slice(2)
          continue
        }
        current = current.slice(1)
      }
      continue
    }
    if (cmd === 'env') {
      let i = 1
      while (i < current.length && current[i]?.startsWith('-') && !ASSIGN.test(current[i] ?? '')) {
        if (current[i] === '-u' || current[i] === '--unset') i += 2
        else i += 1
      }
      while (i < current.length && ASSIGN.test(current[i] ?? '')) i += 1
      if (i >= current.length) return current
      current = current.slice(i)
      continue
    }
    break
  }
  return current
}

export const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

export function skipTimeout(argv: string[]): string[] {
  let i = 1
  while (i < argv.length && argv[i]?.startsWith('-')) {
    const flag = argv[i] ?? ''
    if (
      (flag === '-k' || flag === '--kill-after' || flag === '-s' || flag === '--signal') &&
      !flag.includes('=')
    ) {
      i += 2
      continue
    }
    i += 1
  }
  if (i < argv.length && DURATION.test(argv[i] ?? '')) i += 1
  return argv.slice(i)
}

export function commandBasename(token: string): string {
  const parts = token.replace(/\\/g, '/').split('/')
  return (parts[parts.length - 1] ?? token).toLowerCase()
}

export function classifyPeeledInner(
  innerArgv: string[],
  classify: (command: SimpleCommand) => SimpleCommandRisk
): SimpleCommandRisk {
  const unwrapped = unwrapShellScript(innerArgv)
  const innerStr = unwrapped ?? innerArgv.join(' ')
  if (!innerStr.trim()) return { level: 'gray', verb: 'change' }

  const commands = collectSimpleCommands(innerStr)
  if (!commands || commands.length === 0) return { level: 'gray', verb: 'change' }

  let sawGray = false
  let firstVerb: string | undefined
  for (const cmd of commands) {
    const risk = classify(cmd)
    if (risk.level === 'high') return risk
    if (risk.level === 'gray') sawGray = true
    firstVerb ??= risk.verb
  }
  if (sawGray) return { level: 'gray', verb: firstVerb ?? 'change' }
  return { level: 'low', verb: firstVerb ?? 'change' }
}

export function unwrapShellScript(argv: string[]): string | null {
  if (argv.length < 2) return null
  const shell = commandBasename(argv[0] ?? '')
  if (!SHELL_NAMES.has(shell)) return null

  for (let i = 1; i < argv.length; i++) {
    const token = argv[i] ?? ''
    if (token === '-c' || token === '--command') {
      return argv[i + 1] ?? null
    }
    if (token.startsWith('-c') && token.length > 2) {
      return token.slice(2)
    }
  }
  return null
}
