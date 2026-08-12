/** How many trailing lines to scan for shell prompt hosts. */
import { isPasswordPromptLine } from './terminal-password-prompt'

const PROMPT_HOST_SCAN_LINES = 40

/**
 * Extract hostnames from recent shell prompt lines.
 * Supports: user@host:, [user@host …]#, [K8S-ADMIN] user@host:, root@host#
 */
export function extractRecentPromptHosts(
  output: string,
  maxLines = PROMPT_HOST_SCAN_LINES
): string[] {
  if (!output.trim()) return []
  const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
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
 * - a local-style prompt (`➜ ~`, bare `$`/`%`, `~ $`) -> 'local'
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
  const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
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
  if (/^➜\s+\S+\s*$/.test(line)) return true
  if (/^❯\s+\S+\s*$/.test(line)) return true
  if (/^[%$]\s*$/.test(line)) return true
  if (/^~\s+[%$]\s*$/.test(line)) return true
  return false
}

function looksLikePromptLine(line: string): boolean {
  return (
    /[@].*[:#$]/.test(line) || /\[[\w.-]+@[\w.-]+/.test(line) || /[\w.-]+@[\w.-]+\s*[#$]/.test(line)
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
  const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const recent = lines.slice(-Math.max(1, PROMPT_HOST_SCAN_LINES))

  for (const line of recent) {
    const trimmed = stripAnsi(line).trim()
    if (!trimmed) continue
    // oh-my-zsh / powerlevel10k arrows, bare `$`/`%` and `~ $` style prompts.
    // Same whole-line rule as findNewestPromptSignal: a line like
    // `➜  ~ ssh …` is a command echo, not the local prompt itself.
    if (/^➜\s+\S+\s*$/.test(trimmed)) return true
    if (/^❯\s+\S+\s*$/.test(trimmed)) return true
    if (/^[%$]\s*$/.test(trimmed)) return true
    if (/^~\s+[%$]\s*$/.test(trimmed)) return true
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
    /[@].*[:#$]/.test(line) || /\[[\w.-]+@[\w.-]+/.test(line) || /[\w.-]+@[\w.-]+\s*[#$]/.test(line)
  if (!looksLikePrompt) return []

  const hosts: string[] = []
  for (const match of line.matchAll(/(?:^|[[\s])([\w.-]+)@([\w.-]+)/g)) {
    if (match[2]) hosts.push(match[2])
  }
  return hosts
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '')
}
