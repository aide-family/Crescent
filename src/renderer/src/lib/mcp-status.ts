import type { Dictionary } from '@renderer/i18n'
import type { AgentMcpServerConfig, AgentValidationResult } from '../../../shared/agent-types'

export function getMcpServerStatus(
  server: AgentMcpServerConfig,
  validation: AgentValidationResult | undefined,
  validating: boolean,
  toolCount: number,
  t: Dictionary
): { state: 'ready' | 'pending' | 'not-ready'; label: string } {
  if (!server.enabled) return { state: 'not-ready', label: t.settings.mcpStatusDisabled }
  if (!server.command.trim()) return { state: 'not-ready', label: t.settings.mcpStatusIncomplete }
  if (validating) return { state: 'pending', label: t.settings.mcpStatusChecking }
  if (toolCount > 0) return { state: 'ready', label: t.settings.mcpStatusConnected }

  const validationError = extractMcpServerValidationError(server, validation)
  if (validationError) {
    return {
      state: 'not-ready',
      label: `${t.settings.mcpStatusError}: ${validationError}`
    }
  }

  return { state: 'pending', label: t.settings.mcpStatusNotChecked }
}

export function extractMcpServerValidationError(
  server: AgentMcpServerConfig,
  validation: AgentValidationResult | undefined
): string {
  const validationError = validation?.ok === false ? (validation.error ?? '') : ''
  if (!validationError) return ''

  const prefix = 'MCP server load failed:'
  const mcpError = validationError.includes(prefix)
    ? validationError.slice(validationError.indexOf(prefix) + prefix.length).trim()
    : validationError
  const parts = mcpError
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  const serverNames = [server.name, server.id].filter(Boolean)
  const matched = parts.find((part) => serverNames.some((name) => part.includes(name)))

  return matched ?? (validationError.includes(prefix) ? mcpError : '')
}
