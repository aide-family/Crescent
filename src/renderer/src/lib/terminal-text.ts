import type { TemporarySubterminal } from './terminal-tabs'
import {
  extractPasswordPromptLine as extractSharedPasswordPromptLine,
  isPasswordPromptLine as isSharedPasswordPromptLine,
  isTerminalCurrentlyAtPasswordPrompt as isSharedTerminalCurrentlyAtPasswordPrompt
} from '../../../shared/terminal-password-prompt'

export function parseSubterminalTabId(
  tabId: string
): { parentTabId: string; name: string } | undefined {
  const marker = '::subterminal::'
  const markerIndex = tabId.indexOf(marker)

  if (markerIndex === -1) return undefined

  const parentTabId = tabId.slice(0, markerIndex)
  const encodedName = tabId.slice(markerIndex + marker.length)

  try {
    return {
      parentTabId,
      name: decodeURIComponent(encodedName)
    }
  } catch {
    return {
      parentTabId,
      name: encodedName
    }
  }
}

export function getSubterminalWidths(subterminals: TemporarySubterminal[]): number[] {
  if (subterminals.length === 0) return []
  if (subterminals.length === 1) return [100]

  const defaultWidth = 100 / subterminals.length
  const widths = subterminals.map((subterminal) => subterminal.widthPercent ?? defaultWidth)
  const total = widths.reduce((sum, width) => sum + width, 0)

  if (total <= 0) return subterminals.map(() => defaultWidth)

  return widths.map((width) => (width / total) * 100)
}

export function formatReadableSubterminalOutput(raw: string): string {
  const plain = normalizeTerminalControlText(raw)
  const commandOutput = extractLatestCrescentCommandOutput(plain)
  const source = commandOutput ?? plain
  const lines = source
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !isSubterminalDisplayNoise(line))

  return collapseBlankLines(lines).join('\n').trim()
}

export function normalizeTerminalControlText(value: string): string {
  const withoutControls = applyBackspaces(stripTerminalControlSequences(value))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

  return removeControlCharacters(withoutControls)
}

export function stripTerminalControlSequences(value: string): string {
  let output = ''

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code !== 27) {
      output += value[index]
      continue
    }

    const next = value[index + 1]
    if (next === ']') {
      index += 2
      while (index < value.length) {
        if (value.charCodeAt(index) === 7) break
        if (value.charCodeAt(index) === 27 && value[index + 1] === '\\') {
          index += 1
          break
        }
        index += 1
      }
      continue
    }

    if (next === '[') {
      index += 1
      while (index + 1 < value.length) {
        index += 1
        const finalCode = value.charCodeAt(index)
        if (finalCode >= 64 && finalCode <= 126) break
      }
      continue
    }

    if (next === '(' || next === ')') {
      index += 2
      continue
    }

    if (next === '=' || next === '>') {
      index += 1
      continue
    }

    index += 1
  }

  return output
}

export function extractPasswordPromptLine(output: string): string | null {
  return extractSharedPasswordPromptLine(stripTerminalControlSequences(output))
}

export function isTerminalCurrentlyAtPasswordPrompt(output: string): boolean {
  return isSharedTerminalCurrentlyAtPasswordPrompt(stripTerminalControlSequences(output))
}

export function isPasswordPromptLine(line: string): boolean {
  return isSharedPasswordPromptLine(line)
}

export function hasInteractivePrompt(output: string): boolean {
  const normalizedOutput = stripTerminalControlSequences(output).replace(/\r/g, '\n')
  const lines = normalizedOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  // Only the NEWEST non-empty line decides: a password/yes-no prompt that was
  // answered still stays in older lines, so scanning the whole tail would keep
  // a logged-in terminal looking interactive forever.
  const lastLine = lines[lines.length - 1] ?? ''
  if (!lastLine) return false
  if (/(yes\/no|continue connecting)/i.test(lastLine)) return true
  return isSharedPasswordPromptLine(lastLine)
}

export function hasOutputBeyondEcho(output: string, echo: string): boolean {
  const compactOutput = compactTerminalText(output)
  const compactEcho = compactTerminalText(echo)
  const echoIndex = compactOutput.indexOf(compactEcho)

  if (echoIndex === -1) return compactOutput.length > 0

  return compactOutput.slice(echoIndex + compactEcho.length).length > 0
}

export function compactTerminalText(value: string): string {
  return stripTerminalControlSequences(value).replace(/\s+/g, '')
}

function applyBackspaces(value: string): string {
  let output = ''

  for (const char of value) {
    if (char === '\b') {
      output = output.slice(0, -1)
      continue
    }
    output += char
  }

  return output
}

function removeControlCharacters(value: string): string {
  let output = ''

  for (const char of value) {
    const code = char.charCodeAt(0)
    if (char === '\n' || char === '\t' || code >= 32) output += char
  }

  return output
}

function extractLatestCrescentCommandOutput(value: string): string | undefined {
  const startMatches = [...value.matchAll(/__CRESCENT_CMD_START_[A-Za-z0-9_]+__/g)]
  const latestStart = startMatches.at(-1)
  if (latestStart?.index === undefined) return undefined

  const startIndex = latestStart.index + latestStart[0].length
  const rest = value.slice(startIndex)
  const endMatch = rest.match(/__CRESCENT_CMD_END_[A-Za-z0-9_]+__:\d+/)
  if (endMatch?.index === undefined) return rest

  return rest.slice(0, endMatch.index)
}

function isSubterminalDisplayNoise(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false

  if (isCrescentScriptBootstrapLine(trimmed)) return true

  return (
    trimmed === '%' ||
    /^➜\s+/.test(trimmed) ||
    /^stty\s+-?echo(?:\s+2>\/dev\/null)?$/.test(trimmed) ||
    trimmed.includes('$__crescent_script') ||
    trimmed.includes('__crescent_status=') ||
    trimmed.includes('__CRESCENT_CMD_START_') ||
    trimmed.includes('__CRESCENT_CMD_END_') ||
    /printf\s+%s\s+'[A-Za-z0-9+/=]{80,}'/.test(trimmed) ||
    /base64\s+-[dD]\s+>/.test(trimmed)
  )
}

/**
 * Detect Crescent PTY bootstrap lines that start with `__crescent_script=`
 * (optionally after a shell prompt) and long base64 continuation lines.
 */
export function isCrescentScriptBootstrapLine(line: string): boolean {
  // ANSI CSI sequences intentionally matched; control char is required.
  // eslint-disable-next-line no-control-regex -- strip terminal ANSI escapes
  const stripped = line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '')
  const trimmed = stripped.trim()
  if (!trimmed) return false

  if (trimmed.startsWith('__crescent_script=')) return true

  // Prompt-prefixed echo, e.g. `user@host:~# __crescent_script=...`
  const afterPrompt = trimmed.replace(/^.*?[%$#>]\s+/, '')
  if (afterPrompt.startsWith('__crescent_script=')) return true

  // One-liner may appear mid-stream / mid-prompt: `__crescent_script=$(mktemp)...printf...base64`
  if (trimmed.includes('__crescent_script=$(mktemp')) return true
  if (
    trimmed.includes('__crescent_script=') &&
    (/\$\(mktemp\b/.test(trimmed) || /printf\s+%s/.test(trimmed) || /base64\s+-[dD]/.test(trimmed))
  ) {
    return true
  }

  // Long printf %s 'base64...' fragment (display noise even without the mktemp prefix)
  if (/printf\s+%s\s+'[A-Za-z0-9+/=]{80,}'/.test(trimmed)) return true

  // Pure base64 continuation of the encoded script payload
  if (/^[A-Za-z0-9+/=]{80,}$/.test(trimmed)) return true

  return false
}

/** Filter bootstrap / base64 lines from a complete terminal buffer (display only). */
export function filterCrescentBootstrapOutput(value: string): string {
  const parts = value.split(/(\r\n|\n|\r)/)
  let output = ''
  let skipNewline = false

  for (const part of parts) {
    if (/^(\r\n|\n|\r)$/.test(part)) {
      if (!skipNewline) output += part
      skipNewline = false
      continue
    }
    if (isCrescentScriptBootstrapLine(part)) {
      skipNewline = true
      continue
    }
    output += part
  }

  return output
}

/** Incremental filter for streaming PTY chunks written to xterm. */
export function createCrescentBootstrapFilter(): {
  push: (chunk: string) => string
  flush: () => string
} {
  let carry = ''
  return {
    push(chunk: string): string {
      const combined = carry + chunk
      const parts = combined.split(/(\r\n|\n|\r)/)
      const last = parts[parts.length - 1] ?? ''
      const hasIncomplete = parts.length > 0 && !/^(\r\n|\n|\r)$/.test(last)
      if (hasIncomplete) {
        parts.pop()
        carry = last
      } else {
        carry = ''
      }

      let output = ''
      let skipNewline = false
      for (const part of parts) {
        if (/^(\r\n|\n|\r)$/.test(part)) {
          if (!skipNewline) output += part
          skipNewline = false
          continue
        }
        if (isCrescentScriptBootstrapLine(part)) {
          skipNewline = true
          continue
        }
        output += part
      }

      if (!carry) return output

      // Hold only when the incomplete line already looks like bootstrap / base64.
      if (shouldHoldIncompleteBootstrapLine(carry)) {
        return output
      }

      // Normal interactive typing: emit immediately.
      output += carry
      carry = ''
      return output
    },
    flush(): string {
      const rest = carry
      carry = ''
      if (!rest || isCrescentScriptBootstrapLine(rest) || shouldHoldIncompleteBootstrapLine(rest)) {
        return ''
      }
      return rest
    }
  }
}

function shouldHoldIncompleteBootstrapLine(line: string): boolean {
  // eslint-disable-next-line no-control-regex -- strip terminal ANSI escapes
  const stripped = line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '')
  const trimmed = stripped.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('__crescent_script=')) return true
  const afterPrompt = trimmed.replace(/^.*?[%$#>]\s+/, '')
  if (afterPrompt.startsWith('__crescent_script=')) return true
  if (trimmed.includes('__crescent_script=$(mktemp')) return true
  if (trimmed.includes('__crescent_script=')) return true
  if (/printf\s+%s\s+'[A-Za-z0-9+/=]{40,}/.test(trimmed)) return true
  // Growing base64 blob mid-line
  if (/^[A-Za-z0-9+/=]{40,}$/.test(trimmed)) return true
  return false
}

function collapseBlankLines(lines: string[]): string[] {
  const result: string[] = []

  for (const line of lines) {
    if (!line.trim() && !result.at(-1)?.trim()) continue
    result.push(line)
  }

  return result
}
