import type { TemporarySubterminal } from './terminal-tabs'

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
  const lines = stripTerminalControlSequences(output)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isPasswordPromptLine(lines[index])) return lines[index]
  }

  return null
}

export function isTerminalCurrentlyAtPasswordPrompt(output: string): boolean {
  const lines = stripTerminalControlSequences(output)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const lastLine = lines[lines.length - 1]
  return Boolean(lastLine && isPasswordPromptLine(lastLine))
}

export function isPasswordPromptLine(line: string): boolean {
  return /(?:password|passphrase|verification code|one-time password|otp)\b.*:\s*$/i.test(line)
}

export function hasOutputBeyondEcho(output: string, echo: string): boolean {
  const compactOutput = compactTerminalText(output)
  const compactEcho = compactTerminalText(echo)
  const echoIndex = compactOutput.indexOf(compactEcho)

  if (echoIndex === -1) return compactOutput.length > 0

  return compactOutput.slice(echoIndex + compactEcho.length).length > 0
}

export function hasInteractivePrompt(output: string): boolean {
  const normalizedOutput = stripTerminalControlSequences(output).replace(/\r/g, '\n')
  const lines = normalizedOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-6)

  return lines.some((line) => {
    if (/(yes\/no|continue connecting)/i.test(line)) return true

    return /(?:password|passphrase|verification code|one-time password|otp)\s*:\s*$/i.test(line)
  })
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

  return (
    trimmed === '%' ||
    /^➜\s+/.test(trimmed) ||
    /^stty\s+-?echo(?:\s+2>\/dev\/null)?$/.test(trimmed) ||
    trimmed.includes('__crescent_script=$(mktemp') ||
    trimmed.includes('$__crescent_script') ||
    trimmed.includes('__crescent_status=') ||
    trimmed.includes('__CRESCENT_CMD_START_') ||
    trimmed.includes('__CRESCENT_CMD_END_') ||
    /printf\s+%s\s+'[A-Za-z0-9+/=]{80,}'/.test(trimmed) ||
    /base64\s+-[dD]\s+>/.test(trimmed) ||
    /^[A-Za-z0-9+/=]{100,}$/.test(trimmed)
  )
}

function collapseBlankLines(lines: string[]): string[] {
  const result: string[] = []

  for (const line of lines) {
    if (!line.trim() && !result.at(-1)?.trim()) continue
    result.push(line)
  }

  return result
}
