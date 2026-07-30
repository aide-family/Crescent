const REDACTED = '[REDACTED]'

const SENSITIVE_KEY_PATTERN =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|passwd|token|bearer)$/i

const SENSITIVE_HEADER_PATTERN =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-access-token)$/i

export function redactSensitiveValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key.trim()) || SENSITIVE_HEADER_PATTERN.test(key.trim())) {
    return REDACTED
  }

  return redactSensitiveData(value)
}

export function redactSensitiveData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item)) as T
  }

  if (!isRecord(value)) return value

  const redacted: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = redactSensitiveValue(key, nested)
  }

  return redacted as T
}

export function redactSensitiveText(text: string): string {
  if (!text) return text

  return text
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9]{8,}\b/g, REDACTED)
    .replace(
      /("?(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?token|client[_-]?secret|password|token)"?\s*:\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,\s}\]]+)/gi,
      `$1"${REDACTED}"`
    )
    .replace(
      /(authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*[^\s,;]+/gi,
      `$1: ${REDACTED}`
    )
}

export function redactSensitiveHeaders(
  headers: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!headers) return headers

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_HEADER_PATTERN.test(key) ? REDACTED : value
    ])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
