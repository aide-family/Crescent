import { homedir, hostname, userInfo } from 'os'
import { hasUnterminatedSecretPrompt } from '../../shared/terminal-password-prompt'
import type { TerminalAutomationFilterState, TerminalCommandExecutionResult } from './ipc'

export function sanitizeCommand(value: unknown): string {
  if (typeof value !== 'string') return ''

  return value.replace(/[\r\n]+/g, ' && ').trim()
}

export function createCommandWrapper(
  command: string,
  startMarker: string,
  endMarker: string
): string {
  return [
    `printf '\\n${startMarker}\\n'`,
    command,
    '__crescent_status=$?',
    `printf '\\n${endMarker}:%s\\n' "$__crescent_status"`,
    'unset __crescent_status'
  ].join('\n')
}

export function parseCommandBuffer(
  buffer: string,
  startMarker: string,
  endMarker: string
): { done: boolean; exitCode?: number; output: string } {
  const normalized = stripAnsi(buffer).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const startIndex = normalized.indexOf(startMarker)
  const endIndex = normalized.indexOf(endMarker)

  if (startIndex === -1 || endIndex === -1) return { done: false, output: '' }

  const statusMatch = normalized
    .slice(endIndex)
    .match(new RegExp(`${escapeRegExp(endMarker)}:(\\d+)`))
  if (!statusMatch) return { done: false, output: '' }

  return {
    done: true,
    exitCode: Number(statusMatch[1]),
    output: removeAutomationNoise(
      normalized.slice(startIndex + startMarker.length, endIndex)
    ).trim()
  }
}

export function extractPartialCommandOutput(buffer: string, startMarker: string): string {
  const normalized = stripAnsi(buffer).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const startIndex = normalized.indexOf(startMarker)

  if (startIndex === -1) return removeAutomationNoise(normalized).trim()
  return removeAutomationNoise(normalized.slice(startIndex + startMarker.length)).trim()
}

export function stripAnsi(value: string): string {
  let output = ''

  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 27) {
      output += value[index]
      continue
    }

    index += 1
    if (value[index] !== '[') {
      index -= 1
      continue
    }

    while (index + 1 < value.length) {
      index += 1
      const code = value.charCodeAt(index)
      if (code >= 64 && code <= 126) break
    }
  }

  return output
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isAutomationEchoLine(line: string, command: string): boolean {
  const compactEcho = compactForEcho(command)
  if (!compactEcho) return false

  const stripped = stripPromptPrefix(line.trim())
  return (
    Boolean(stripped && compactForEcho(stripped) === compactEcho) ||
    compactForEcho(line).endsWith(compactEcho)
  )
}

export function compactForEcho(value: string): string {
  return stripAnsi(value).replace(/\s+/g, '')
}

export function filterAutomationControlLines(data: string): string {
  const parts = removeAutomationNoise(data).split(/(\r?\n)/)
  let output = ''
  let skippedControlLine = false

  for (const part of parts) {
    if (/^\r?\n$/.test(part)) {
      if (skippedControlLine) {
        skippedControlLine = false
        continue
      }
      output += part
      continue
    }

    if (isAutomationControlOutput(part)) {
      skippedControlLine = true
      continue
    }

    skippedControlLine = false
    output += part
  }

  return output
}

export function filterAutomationControlOutputWithState(
  data: string,
  state: TerminalAutomationFilterState
): string {
  state.pending += removeAutomationNoise(data)

  if (state.phase === 'before-start') {
    const startIndex = state.pending.indexOf(state.startMarker)
    if (startIndex === -1) {
      state.pending = keepMarkerTail(state.pending, state.startMarker)
      return ''
    }

    state.pending = state.pending.slice(startIndex + state.startMarker.length)
    state.pending = state.pending.replace(/^(\r\n|\n|\r)/, '')
    state.phase = 'body'
  }

  const endIndex = state.pending.indexOf(state.endMarker)
  if (endIndex !== -1) {
    const beforeEndMarker = state.pending.slice(0, endIndex)
    const afterEndMarker = state.pending.slice(endIndex)
    const afterEndLine = afterEndMarker.replace(
      new RegExp(`${escapeRegExp(state.endMarker)}:?\\d*\\r?\\n?`),
      ''
    )
    state.pending = ''
    return stripAutomationDisplayNoise(beforeEndMarker) + filterAutomationControlLines(afterEndLine)
  }

  const holdLength = Math.max(state.endMarker.length - 1, 0)
  if (hasUnterminatedSecretPrompt(state.pending)) {
    const output = state.pending
    state.pending = ''
    return stripAutomationDisplayNoise(output)
  }

  if (state.pending.length <= holdLength) return ''

  const safeLength = state.pending.length - holdLength
  const candidate = state.pending.slice(0, safeLength)
  const lastNewlineIndex = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf('\r'))
  if (lastNewlineIndex === -1) return ''

  const emitLength = lastNewlineIndex + 1
  const output = state.pending.slice(0, emitLength)
  state.pending = state.pending.slice(emitLength)

  return stripAutomationDisplayNoise(output)
}

export function keepMarkerTail(value: string, marker: string): string {
  const maxLength = Math.max(marker.length - 1, 0)
  if (value.length <= maxLength) return value

  return value.slice(-maxLength)
}

export function stripAutomationDisplayNoise(value: string): string {
  return value
    .split(/(\r?\n|\r)/)
    .filter((part) => !isAutomationControlOutput(part))
    .map((part) => (/^\r?\n$|^\r$/.test(part) ? part : stripPromptPrefix(part)))
    .join('')
}

export function formatReadableCommandInput(command: string): string {
  return `${command.replace(/\r?\n/g, '\r\n')}\r\n`
}

export function stripPromptPrefix(value: string): string {
  return value
    .replace(/^\s*(?:[\w.-]+@[\w.-]+(?:\[[^\]]+\])?:[^\r\n#$>]*[#$]|[$#]|➜\s+\S+)\s+/, '')
    .replace(/^\s*(?:>\s*)+/, '')
}

export function formatReadableCommandResult(result: TerminalCommandExecutionResult): string {
  if (result.ok && !result.timedOut && !result.interrupted && !result.terminalExited) return ''

  const status = result.interrupted
    ? 'interrupted (Ctrl+C)'
    : result.timedOut
      ? 'timeout'
      : result.terminalExited
        ? `terminal exited: ${result.exitCode ?? 'unknown'}`
        : `command failed: exit code ${result.exitCode ?? 'unknown'}`

  return `\r\n\x1b[33m[Crescent] ${status}\x1b[0m\r\n`
}

export function formatPipePrompt(cwd: string): string {
  const username = userInfo().username || 'user'
  const host = hostname() || 'localhost'
  const home = homedir()
  const displayCwd =
    cwd === home ? '~' : cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd

  return `\x1b[38;5;45m${username}@${host}\x1b[0m:\x1b[38;5;111m${displayCwd}\x1b[0m $ `
}

export function isAutomationControlOutput(value: string): boolean {
  const normalized = stripAnsi(value)

  return (
    normalized.includes('__CRESCENT_CMD_START_') ||
    normalized.includes('__CRESCENT_CMD_END_') ||
    normalized.includes('__crescent_script=$(mktemp') ||
    normalized.includes('__crescent_encoded=') ||
    normalized.includes('__crescent_status=') ||
    normalized.includes('unset __crescent_status') ||
    /printf\s+['"]?\\n__CRESCENT_CMD_(START|END)_/.test(normalized) ||
    /printf\s+%s\s+'[A-Za-z0-9+/=]{80,}'/.test(normalized) ||
    /base64\s+-[dD]\s+>/.test(normalized) ||
    /^[A-Za-z0-9+/=]{100,}$/.test(normalized.trim())
  )
}

export function removeAutomationNoise(value: string): string {
  const parts = value.split(/(\r\n|\n|\r)/)
  let output = ''
  let skippedLine = false

  for (const part of parts) {
    if (/^(\r\n|\n|\r)$/.test(part)) {
      if (!skippedLine) output += part
      skippedLine = false
      continue
    }

    if (
      /_zsh_autosuggest_highlight_apply:\d+: POSTDISPLAY: parameter not set/.test(stripAnsi(part))
    ) {
      skippedLine = true
      continue
    }

    output += part
  }

  return output
}

export function hasShellContinuationPrompt(value: string): boolean {
  const normalized = stripAnsi(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const tail = normalized.slice(-800)
  const lines = tail.split('\n')
  const lastLine = lines[lines.length - 1] ?? ''
  const promptPattern =
    /^\s*(>|quote>|dquote>|bquote>|cmdand\s+cursh\s+cmdor\s+quote>|heredoc>)\s*$/

  if (promptPattern.test(lastLine)) return true

  const previousLine = lines[lines.length - 2] ?? ''
  return promptPattern.test(previousLine) && lastLine.trim() === ''
}
