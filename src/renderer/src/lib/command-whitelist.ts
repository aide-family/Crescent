import { normalizeCommand } from '../../../shared/command-guard'

/** Suggest a whitelist pattern for an audited command (renderer-safe). */
export function suggestWhitelistRule(command: string): string {
  return normalizeCommand(command)
}
