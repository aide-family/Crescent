import { matchGlobCommand, normalizeCommand } from '../../shared/command-guard'

export function matchCommandWhitelist(command: string, rules: string[]): string | undefined {
  const normalizedCommand = normalizeCommand(command)
  if (!normalizedCommand) return undefined

  for (const rule of rules) {
    const normalizedRule = rule.trim()
    if (!normalizedRule || normalizedRule.startsWith('#')) continue

    if (matchesRegexRule(normalizedCommand, normalizedRule)) return normalizedRule
    if (matchGlobCommand(command, normalizedRule)) return normalizedRule
    if (normalizedCommand === normalizeCommand(normalizedRule)) return normalizedRule
  }

  return undefined
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
