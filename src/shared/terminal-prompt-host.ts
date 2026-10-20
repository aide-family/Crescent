/** How many trailing lines to scan for shell prompt hosts. */
import { isPasswordPromptLine } from './terminal-password-prompt'

const PROMPT_HOST_SCAN_LINES = 40

/**
 * Lines as the terminal shows them. `\r` returns the cursor to column 0 and
 * later text overwrites; erase-to-end (`CSI K`) drops the tail. Treating `\r`
 * as a newline would turn a prompt redraw into a fake local line (`~$`, `$`,
 * `➜  ~`) and look like the SSH session had already exited.
 */
export function visibleTerminalLines(output: string): string[] {
  return output
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => renderTerminalLine(line).trim())
}

function renderTerminalLine(line: string): string {
  const buffer: string[] = []
  let column = 0

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '\r') {
      column = 0
      continue
    }

    if (char === '\u001b') {
      const next = line[index + 1]
      if (next === '[') {
        let cursor = index + 2
        let params = ''
        while (cursor < line.length) {
          const code = line.charCodeAt(cursor)
          if (code >= 64 && code <= 126) break
          params += line[cursor]
          cursor += 1
        }
        const command = line[cursor]
        if (command === 'K') {
          const mode = Number(params || '0')
          if (mode === 2) {
            buffer.length = 0
            column = 0
          } else if (mode === 1) {
            for (let cell = 0; cell < column && cell < buffer.length; cell += 1) buffer[cell] = ' '
          } else {
            buffer.length = column
          }
        }
        index = command ? cursor : cursor - 1
        continue
      }
      if (next === ']') {
        let cursor = index + 2
        while (cursor < line.length) {
          if (line[cursor] === '\u0007') break
          if (line[cursor] === '\u001b' && line[cursor + 1] === '\\') {
            cursor += 1
            break
          }
          cursor += 1
        }
        index = cursor
        continue
      }
      // Two-byte sequences such as ESC = (application keypad) and ESC ( B.
      // Leaving the final byte in the line turns `➜  ~` into `➜  ~ =`.
      const nextCode = next ? next.charCodeAt(0) : 0
      if (nextCode >= 0x20 && nextCode <= 0x2f) {
        let cursor = index + 2
        while (cursor < line.length) {
          const code = line.charCodeAt(cursor)
          if (code >= 0x30 && code <= 0x7e) break
          cursor += 1
        }
        index = cursor < line.length ? cursor : cursor - 1
        continue
      }
      if (nextCode >= 0x30 && nextCode <= 0x7e) {
        index += 1
        continue
      }
      continue
    }

    buffer[column] = char
    column += 1
  }

  return buffer.join('')
}

/**
 * Extract hostnames from recent shell prompt lines.
 * Supports: user@host:, [user@host …]#, [K8S-ADMIN] user@host:, root@host#
 */
export function extractRecentPromptHosts(
  output: string,
  maxLines = PROMPT_HOST_SCAN_LINES
): string[] {
  if (!output.trim()) return []
  const lines = visibleTerminalLines(output)
  const recent = lines.slice(-Math.max(1, maxLines))
  const hosts: string[] = []
  const seen = new Set<string>()

  for (const line of recent) {
    const trimmed = stripAnsi(line).trim()
    if (!trimmed) continue
    for (const host of matchPromptHostsInLine(trimmed)) {
      const normalized = normalizeHostToken(host)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      hosts.push(normalized)
    }
  }

  return hosts
}

export type PromptSignal =
  | { kind: 'host'; host: string }
  | { kind: 'local' }
  /** Interactive secret / host-key prompt — terminal is waiting for input. */
  | { kind: 'waiting' }

/**
 * Newest prompt signal in a PTY buffer, scanning lines from bottom to top:
 * - a local-style prompt (`➜ ~`, bare `$`/`%`, `~ $`, lone `~`) -> 'local'
 * - a hostname prompt (`user@host:…`) -> { host }
 * - no prompt signal -> undefined
 *
 * This fixes exit-to-local detection: after the remote shell exits, the local
 * prompt is the newest line even when older remote `user@host` prompts remain
 * inside the scan window.
 */
export function findNewestPromptSignal(
  output: string,
  maxLines = PROMPT_HOST_SCAN_LINES
): PromptSignal | undefined {
  if (!output.trim()) return undefined
  const lines = visibleTerminalLines(output)
  const recent = lines.slice(-Math.max(1, maxLines))

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const trimmed = stripAnsi(recent[index]).trim()
    if (!trimmed) continue

    if (
      isPasswordPromptLine(trimmed) ||
      /(?:yes\/no|continue connecting)\s*[:?]?\s*$/i.test(trimmed)
    ) {
      return { kind: 'waiting' }
    }
    if (isLocalPromptLine(trimmed)) return { kind: 'local' }
    if (!looksLikePromptLine(trimmed)) continue

    const hosts = matchPromptHostsInLine(trimmed)
    const latest = hosts[hosts.length - 1]
    if (latest) return { kind: 'host', host: normalizeHostToken(latest) }
  }

  return undefined
}

function isLocalPromptLine(line: string): boolean {
  // oh-my-zsh / powerlevel10k arrows, bare `$`/`%` and `~ $` style prompts.
  // The arrow must be the WHOLE line: `➜  ~ ssh …` is a pasted command echo,
  // not a local prompt signal, and treating it as one would poison the
  // alignment/guard logic while the ssh login is still in progress.
  // A lone `#` is not local — remote root shells commonly use that PS1.
  // A CR overwrite can leave a host tail (`➜  ~` + `moon:~$`). That is not
  // the idle local prompt; `➜  ~` and `➜  ~/src` still are.
  if (/^➜\s+\S+\s*$/.test(line) && !/[@:]/.test(line)) return true
  if (/^❯\s+\S+\s*$/.test(line) && !/[@:]/.test(line)) return true
  if (/^[➜❯]\s*$/.test(line)) return true
  if (/^[%$]\s*$/.test(line)) return true
  // Home-dir-only PS1 after SSH drop (`~`, `~ %`, `~#`). A lone `#` is still remote root.
  if (/^~\s*[%$#]?\s*$/.test(line)) return true
  // Stock bash/zsh: `bash-5.2$`, `zsh%`, short path without user@host.
  // Do not treat a bare `#` as local — remote root shells use that PS1.
  if (/^(?:bash|zsh|sh)[-/\d.]*\s*[%$#]\s*$/i.test(line)) return true
  if (/^[^@\n]{1,40}\s[%$]\s*$/.test(line) && !/\bssh\b/i.test(line)) return true
  return false
}

function looksLikePromptLine(line: string): boolean {
  return (
    /[@].*[:#$%]/.test(line) ||
    /\[[\w.-]+@[\w.-]+/.test(line) ||
    /[\w.-]+@[\w.-]+\s*[#$%]/.test(line)
  )
}

/**
 * True when observed prompt host matches the expected connection host
 * (exact or mutual FQDN suffix). Empty expectedHost → always aligned (no gate).
 */
export function isPromptHostAligned(
  observedHost: string | undefined,
  expectedHost: string | undefined
): boolean {
  const expected = normalizeHostToken(expectedHost ?? '')
  if (!expected) return true
  const observed = normalizeHostToken(observedHost ?? '')
  if (!observed) return true
  if (observed === expected) return true
  // Mutual FQDN relation: short host vs longer DNS name (prefix or suffix form).
  return (
    observed.endsWith(`.${expected}`) ||
    expected.endsWith(`.${observed}`) ||
    observed.startsWith(`${expected}.`) ||
    expected.startsWith(`${observed}.`)
  )
}

/**
 * True when the observed prompt host is the Crescent client machine
 * (`os.hostname()`, including Bonjour `.local`). Empty localHost is not local.
 */
export function isLocalMachinePromptHost(
  observedHost: string | undefined,
  localHost: string | undefined
): boolean {
  const observed = normalizeHostToken(observedHost ?? '')
  const local = normalizeHostToken(localHost ?? '')
  if (!observed || !local) return false
  if (observed === 'local-shell') return true
  return isPromptHostAligned(observed, local)
}

/** Latest observed host from output that fails alignment, if any. */
export function findEnvironmentDriftHost(
  output: string,
  expectedHost: string | undefined
): string | undefined {
  const expected = normalizeHostToken(expectedHost ?? '')
  if (!expected) return undefined
  const hosts = extractRecentPromptHosts(output)
  if (hosts.length === 0) return undefined
  // Prefer the most recent prompt host (last in scan order).
  const latest = hosts[hosts.length - 1]
  if (isPromptHostAligned(latest, expected)) return undefined
  return latest
}

/**
 * True when the recent output shows a shell prompt that carries no hostname
 * (e.g. local zsh `➜ ~`, plain `$`/`%`). When a session expects a specific
 * remote host, seeing one of these means the remote shell is gone and the
 * outer/local shell is at the prompt again.
 */
export function isLocalShellPromptVisible(output: string): boolean {
  if (!output.trim()) return false
  const lines = visibleTerminalLines(output)
  const recent = lines.slice(-Math.max(1, PROMPT_HOST_SCAN_LINES))

  for (const line of recent) {
    const trimmed = stripAnsi(line).trim()
    if (!trimmed) continue
    if (isLocalPromptLine(trimmed)) return true
  }

  return false
}

/**
 * Authoritative session-alignment state for a PTY buffer:
 * - 'aligned': a recent prompt host matches the expected host.
 * - 'drifted': a recent prompt host is different, or the local shell prompt is
 *   visible while a remote host was expected (e.g. SSH closed by the remote side).
 * - 'unknown': no expected host, or no prompt signal in the recent output.
 */
export function resolvePromptEnvironmentState(
  output: string,
  expectedHost: string | undefined
): 'aligned' | 'drifted' | 'unknown' {
  const expected = normalizeHostToken(expectedHost ?? '')
  if (!expected) return 'unknown'

  const driftHost = findEnvironmentDriftHost(output, expected)
  if (driftHost) return 'drifted'
  if (isLocalShellPromptVisible(output)) return 'drifted'

  return extractRecentPromptHosts(output).length > 0 ? 'aligned' : 'unknown'
}

export function normalizeHostToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/^\[+|\]+$/g, '')
}

function matchPromptHostsInLine(line: string): string[] {
  // Prompt-like: [user@host …], user@host:…#, user@host#
  // Avoid matching email-like tokens mid-sentence without prompt markers when possible.
  const looksLikePrompt =
    /[@].*[:#$%]/.test(line) ||
    /\[[\w.-]+@[\w.-]+/.test(line) ||
    /[\w.-]+@[\w.-]+\s*[#$%]/.test(line)
  if (!looksLikePrompt) return []

  const hosts: string[] = []
  // Delimiter before user@host: start, [, whitespace, or ] (K8S-RONLY]root@host).
  // Kept narrow so `x:user@host` inside a command echo is not picked up.
  for (const match of line.matchAll(/(?:^|[[\s\]])([\w.-]+)@([\w.-]+)/g)) {
    if (match[2]) hosts.push(match[2])
  }
  return hosts
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '')
}
