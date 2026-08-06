export function matchCommandWhitelist(command: string, rules: string[]): string | undefined {
  const normalizedCommand = normalizeCommand(command)
  if (!normalizedCommand) return undefined

  for (const rule of rules) {
    const normalizedRule = rule.trim()
    if (!normalizedRule || normalizedRule.startsWith('#')) continue

    if (matchesRegexRule(normalizedCommand, normalizedRule)) return normalizedRule
    if (matchesPrefixRule(normalizedCommand, normalizedRule)) return normalizedRule
    if (normalizedCommand === normalizeCommand(normalizedRule)) return normalizedRule
  }

  return undefined
}

function matchesPrefixRule(command: string, rule: string): boolean {
  if (!rule.endsWith('*')) return false

  const prefix = normalizeCommand(rule.slice(0, -1))
  return Boolean(prefix && command.startsWith(prefix))
}

function matchesRegexRule(command: string, rule: string): boolean {
  if (!rule.startsWith('/')) return false

  const lastSlash = rule.lastIndexOf('/')
  if (lastSlash <= 0) return false

  try {
    const pattern = rule.slice(1, lastSlash)
    const flags = rule.slice(lastSlash + 1)
    return new RegExp(pattern, flags).test(command)
  } catch {
    return false
  }
}

function normalizeCommand(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
