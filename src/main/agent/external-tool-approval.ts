import type { CommandAuditResult, ToolCatalogEntry } from '../../shared/agent-types'
import { redactSensitiveData, redactSensitiveText } from '../../shared/secret-redaction'

export interface ExternalToolApprovalInput {
  toolName: string
  rawArguments: string
  catalog: ToolCatalogEntry
  userInput?: string
}

export interface ExternalToolApprovalDecision {
  approved: boolean
  note?: string
  rejectionReason?: string
}

export type ExternalToolApprover = (
  input: ExternalToolApprovalInput
) => Promise<ExternalToolApprovalDecision>

export function shouldRequireExternalToolApproval(
  catalog: ToolCatalogEntry | undefined
): catalog is ToolCatalogEntry {
  if (!catalog?.requiresApproval) return false
  return catalog.source === 'openapi' || catalog.source === 'mcp'
}

export function buildExternalToolApprovalCommand(input: ExternalToolApprovalInput): string {
  const argsPreview = formatToolArgumentsPreview(input.rawArguments)
  const source = (input.catalog.source ?? 'openapi').toUpperCase()
  return [
    `${source} ${input.catalog.method.toUpperCase()} ${input.catalog.path}`,
    `Tool: ${input.toolName}`,
    argsPreview ? `Arguments:\n${argsPreview}` : 'Arguments: (none)'
  ].join('\n')
}

export function buildExternalToolAudit(input: ExternalToolApprovalInput): CommandAuditResult {
  const sourceLabel = input.catalog.source === 'mcp' ? 'MCP' : 'OpenAPI'
  const risk = input.catalog.risk ?? 'high'

  return {
    summary: `${sourceLabel} tool "${input.toolName}" can change external or remote state and requires approval.`,
    operationReason: input.userInput?.trim()
      ? `The agent proposed this ${sourceLabel} call while working on: ${input.userInput.trim()}`
      : `The agent proposed this ${sourceLabel} call as the next step.`,
    risk,
    requiresApproval: true,
    riskPoints: [
      `${sourceLabel} tools can call systems outside the local terminal.`,
      input.catalog.stateChanging
        ? 'Catalog metadata marks this operation as state-changing.'
        : 'External tool behavior should be reviewed before execution.',
      `Target: ${input.catalog.method.toUpperCase()} ${input.catalog.path}`
    ].slice(0, 3),
    impactAnalysis: input.catalog.stateChanging
      ? `Approving may mutate remote data, trigger side effects, or invoke server-defined MCP behavior for ${input.catalog.path}.`
      : `Approving will invoke an external ${sourceLabel} tool. Review arguments carefully before continuing.`,
    recommendation:
      'Approve only if the arguments and destination match the current task. Reject if the request is unexpected or too broad.'
  }
}

function formatToolArgumentsPreview(rawArguments: string): string {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown
    if (parsed && typeof parsed === 'object') {
      const text = JSON.stringify(redactSensitiveData(parsed), null, 2)
      return text.length > 1200 ? `${text.slice(0, 1200)}\n...` : text
    }
  } catch {
    // fall through
  }

  const text = redactSensitiveText(rawArguments.trim())
  if (!text) return ''
  return text.length > 1200 ? `${text.slice(0, 1200)}\n...` : text
}
