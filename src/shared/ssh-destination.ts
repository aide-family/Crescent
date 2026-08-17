/**
 * Parse the destination host from an ssh argv line.
 *
 * `ssh -p 22 -l aide 192.0.2.10` must yield `192.0.2.10`, not `22`.
 * A naive "first token after flags" regex treats the port as the host and
 * poisons EnvGuard (`expected 22, observed node-1`).
 */

/** OpenSSH options that consume the next argv token (or an attached value). */
const SSH_OPTIONS_WITH_VALUE = new Set([
  'B',
  'b',
  'c',
  'D',
  'E',
  'e',
  'F',
  'I',
  'i',
  'J',
  'L',
  'l',
  'm',
  'O',
  'o',
  'p',
  'Q',
  'R',
  'S',
  'W',
  'w'
])

/** Strip `user@` from an ssh destination (`aide@192.0.2.10` → `192.0.2.10`). */
export function stripSshUser(value: string): string {
  const trimmed = value.trim()
  const at = trimmed.lastIndexOf('@')
  if (at > 0 && at < trimmed.length - 1) return trimmed.slice(at + 1)
  return trimmed
}

export function isIpv4Literal(value: string): boolean {
  const host = stripSshUser(value)
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)
}

/**
 * True when a token can be a connection host. Rejects empty values, ssh flags,
 * and bare TCP ports (`22` from `-p 22`).
 */
export function isPlausibleSshHost(value: string | undefined): boolean {
  const host = stripSshUser(value ?? '').replace(/^\[+|\]+$/g, '')
  if (!host) return false
  if (host.startsWith('-')) return false
  if (/^\d+$/.test(host)) {
    const port = Number(host)
    return Number.isInteger(port) && port > 65535
  }
  return true
}

function unquoteSshToken(token: string): string {
  if (
    (token.startsWith("'") && token.endsWith("'") && token.length >= 2) ||
    (token.startsWith('"') && token.endsWith('"') && token.length >= 2)
  ) {
    return token.slice(1, -1)
  }
  return token
}

/**
 * Destination host of an `ssh ...` command, with `user@` stripped.
 * Returns undefined when the line is not ssh or has no destination.
 */
export function extractSshDestinationHost(command: string): string | undefined {
  const trimmed = command.trim()
  if (!/^ssh\b/i.test(trimmed)) return undefined

  const body = trimmed.replace(/^ssh\s+/i, '')
  const tokens = body.split(/\s+/).filter(Boolean)

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--') {
      const destination = tokens[index + 1]
      return destination ? sanitizeExtractedHost(destination) : undefined
    }
    if (!token.startsWith('-') || token === '-') {
      return sanitizeExtractedHost(token)
    }

    // Clustered short flags (`-tt`, `-vv`) or a flag with an attached value (`-p22`).
    const flagBody = token.replace(/^-+/, '')
    if (!flagBody) continue

    const flag = flagBody[0]
    if (!SSH_OPTIONS_WITH_VALUE.has(flag)) continue

    const attached = flagBody.slice(1)
    if (attached) continue
    if (tokens[index + 1] && !tokens[index + 1].startsWith('-')) index += 1
  }

  return undefined
}

function sanitizeExtractedHost(token: string): string | undefined {
  const host = stripSshUser(unquoteSshToken(token))
  return isPlausibleSshHost(host) ? host : undefined
}

/**
 * Last ssh destination in a login command sequence (multi-hop: final `ssh host`
 * wins). Falls back to the configured connection host.
 */
export function resolveFinalSshTarget(
  commands: readonly string[],
  fallbackHost?: string
): string | undefined {
  let target: string | undefined
  for (const command of commands) {
    const destination = extractSshDestinationHost(command)
    if (destination) target = destination
  }
  if (target) return target
  const fallback = stripSshUser(fallbackHost ?? '')
  return isPlausibleSshHost(fallback) ? fallback : undefined
}

/** Drop port-like / flag-like values before writing them into EnvGuard state. */
export function sanitizeExpectedTargetHost(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const host = stripSshUser(trimmed)
  return isPlausibleSshHost(host) ? host : undefined
}
