import type { Dictionary } from '@renderer/i18n'
import type {
  AgentEvent,
  CommandApprovalRequest,
  CommandRiskLevel
} from '../../../shared/agent-types'

export function riskLabel(risk: CommandRiskLevel, t: Dictionary): string {
  switch (risk) {
    case 'low':
      return t.commandReview.lowRisk
    case 'medium':
      return t.commandReview.mediumRisk
    case 'high':
      return t.commandReview.highRisk
  }
}

export function formatCommandAuditDetail(
  command: string,
  audit: CommandApprovalRequest['audit'],
  t: Dictionary
): string {
  return [
    `${t.commandReview.command}:`,
    command,
    '',
    `${t.commandReview.auditSummary}:`,
    audit.summary,
    '',
    `${t.commandReview.operationReason}:`,
    audit.operationReason,
    '',
    `${t.commandReview.riskLevel}: ${riskLabel(audit.risk, t)}`,
    '',
    `${t.commandReview.riskPoints}:`,
    ...audit.riskPoints.map((point) => `- ${point}`),
    '',
    `${t.commandReview.impactAnalysis}:`,
    audit.impactAnalysis,
    '',
    `${t.commandReview.recommendation}:`,
    audit.recommendation
  ].join('\n')
}

export function formatCommandAuditActionDetail(
  command: string,
  audit: CommandApprovalRequest['audit'],
  t: Dictionary
): string {
  if (audit.risk === 'low' && !audit.requiresApproval) {
    return [
      `${t.commandReview.command}:`,
      command,
      '',
      `${t.commandReview.auditSummary}:`,
      audit.summary,
      '',
      `${t.commandReview.operationReason}:`,
      audit.operationReason
    ].join('\n')
  }

  return formatCommandAuditDetail(command, audit, t)
}

export function formatLoadedSkillsActionDetail(
  skills: Extract<AgentEvent, { type: 'skills' }>['skills'],
  t: Dictionary
): string {
  return skills
    .flatMap((skill, index) => [
      `${index + 1}. ${skill.name}`,
      `${t.input.skillMatchReason}: ${
        skill.reason === 'referenced' ? t.input.skillReasonReferenced : t.input.skillReasonMatched
      }`,
      `${t.input.slashSkillPathLabel}: ${skill.path}`,
      skill.description ? `${t.input.slashSkillDescriptionLabel}: ${skill.description}` : ''
    ])
    .filter(Boolean)
    .join('\n')
}

export function formatCommandExecutionActionTitle(
  event: Extract<AgentEvent, { type: 'command' }>,
  t: Dictionary
): string {
  if (event.phase === 'started') return t.terminal.commandRunning

  return event.result?.ok ? t.terminal.commandExecuted : t.terminal.commandFailed
}

export function formatCommandExecutionActionDetail(
  event: Extract<AgentEvent, { type: 'command' }>,
  t: Dictionary
): string {
  // Timeline / chat observation: command output only (no exit code / elapsed / pty meta).
  return formatCommandObservation(event, t)
}

/** User-facing observation for a terminal command: stdout/stderr only. */
export function formatCommandObservation(
  event: Extract<AgentEvent, { type: 'command' }>,
  t: Dictionary
): string {
  if (event.phase === 'started') {
    return ''
  }

  const result = event.result
  const sanitized = sanitizeCommandObservation(result?.output ?? '', result?.error ?? '')
  const lines: string[] = []

  if (result?.timedOut) lines.push(t.terminal.commandTimedOut)
  if (result?.terminalExited) lines.push(t.terminal.terminalDisconnected)
  if (sanitized.error) lines.push(sanitized.error)
  if (sanitized.output) lines.push(truncateCommandOutput(sanitized.output))

  if (lines.length > 0) return lines.join('\n\n')
  if (result && !result.ok) return t.input.error
  return ''
}

const LOGQL_PARSE_ERROR = /parse error at line .* unexpected IDENTIFIER/i

/**
 * When stdout is valid success JSON (e.g. Loki API), drop LogQL-style parse
 * errors that were incorrectly appended via stderr / pipeline noise.
 */
export function sanitizeCommandObservation(
  output: string,
  error: string
): { output: string; error: string } {
  const trimmedOutput = output.trim()
  let keepError = error.trim()

  if (isSuccessfulApiJson(trimmedOutput)) {
    keepError = keepError
      .split(/\r?\n/)
      .filter((line) => !LOGQL_PARSE_ERROR.test(line))
      .join('\n')
      .trim()
    return { output: trimmedOutput, error: keepError }
  }

  // Also strip parse-error lines glued onto the output blob itself.
  if (trimmedOutput && LOGQL_PARSE_ERROR.test(trimmedOutput)) {
    const withoutParse = trimmedOutput
      .split(/\r?\n/)
      .filter((line) => !LOGQL_PARSE_ERROR.test(line))
      .join('\n')
      .trim()
    if (isSuccessfulApiJson(withoutParse)) {
      return { output: withoutParse, error: keepError }
    }
  }

  return { output: truncateCommandOutput(output), error: keepError }
}

function isSuccessfulApiJson(value: string): boolean {
  if (!value.startsWith('{') && !value.startsWith('[')) return false
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const status = (parsed as { status?: unknown }).status
      if (status === 'success') return true
    }
    // Any other well-formed JSON still counts as successful structured stdout.
    return true
  } catch {
    return false
  }
}

export function formatAgentEventActionTitle(
  event: Exclude<AgentEvent, { type: 'token' | 'done' | 'skills' }>,
  t: Dictionary
): string {
  switch (event.type) {
    case 'status':
      if (/^Loaded \d+ MCP tools:/.test(event.message)) {
        return event.message.split('\n')[0]?.replace(/:$/, '.') ?? event.message
      }
      if (event.message.startsWith('Command approved by user.')) {
        return localizeAgentEventMessage(event.message, t)
      }
      if (event.message.startsWith('Command rejected by user.')) {
        return localizeAgentEventMessage(event.message, t)
      }
      return localizeAgentEventMessage(event.message, t)
    case 'thought':
      return localizeAgentEventMessage(event.message, t)
    case 'error':
      return `${t.input.error}: ${localizeAgentEventMessage(event.message, t)}`
    default:
      return t.input.genericAction
  }
}

export function isNoisyMcpCatalogMessage(message: string): boolean {
  return /^Loaded \d+ MCP tools?\b/i.test(message.trim())
}

/** Audit / whitelist / auto-approve chatter that should not appear in the chat timeline. */
export function isNoiseAuditStatusMessage(message: string, t: Dictionary): boolean {
  const trimmed = message.trim()
  if (!trimmed) return false

  if (isNoisyMcpCatalogMessage(trimmed)) return true

  const localized = localizeAgentEventMessage(trimmed, t).trim()
  const noiseExact = new Set([
    t.commandReview.readOnlyAllowed,
    t.commandReview.whitelisted,
    t.commandReview.autoApproved,
    'Command audit classified this as read-only inspection.'
  ])
  if (noiseExact.has(trimmed) || noiseExact.has(localized)) return true

  if (trimmed.startsWith('Command matched whitelist:')) return true
  if (trimmed.startsWith('Submitting command for review:')) return true
  if (/^Submitting command in temporary sub-terminal "/.test(trimmed)) return true

  // Keep "analyzing / classifying" visible so the operator can see audit in progress.
  // Hidden after command-review arrives (see useAgentRuns / isNoiseStatusStep).
  if (isClassifyingStatusMessage(trimmed, t) || isClassifyingStatusMessage(localized, t)) {
    return false
  }

  const reviewTitle = t.commandReview.title
  if (trimmed === reviewTitle || trimmed.startsWith(`${reviewTitle}:`)) return true
  if (localized === reviewTitle || localized.startsWith(`${reviewTitle}:`)) return true

  // Risk-only titles like "命令审核：低风险" / "Command review: Low risk"
  const riskLabels = [t.commandReview.lowRisk, t.commandReview.mediumRisk, t.commandReview.highRisk]
  for (const label of riskLabels) {
    if (trimmed === `${reviewTitle}: ${label}` || localized === `${reviewTitle}: ${label}`) {
      return true
    }
  }

  return false
}

/** Pending "command review in progress" status lines. */
export function isClassifyingStatusMessage(message: string, t: Dictionary): boolean {
  const trimmed = message.trim()
  return (
    trimmed === 'Command review subprocess is analyzing risk.' ||
    trimmed === 'Command review is classifying risk.' ||
    trimmed === t.commandReview.analyzing
  )
}

export function localizeAgentEventMessage(message: string, t: Dictionary): string {
  if (message === 'Dispatching tool call.') return t.input.toolDispatching
  if (message.startsWith('Submitting command for review:')) {
    return `${t.commandReview.submitted}:\n${message.slice('Submitting command for review:'.length).trim()}`
  }
  const subterminalCommand = message.match(
    /^Submitting command in temporary sub-terminal "([^"]+)":\s*([\s\S]+)$/
  )
  if (subterminalCommand) {
    return `${t.commandReview.submitted} (${subterminalCommand[1]}):\n${subterminalCommand[2].trim()}`
  }
  if (message === 'Command audit classified this as read-only inspection.') {
    return t.commandReview.readOnlyAllowed
  }
  if (
    message === 'Command review subprocess is analyzing risk.' ||
    message === 'Command review is classifying risk.'
  ) {
    return t.commandReview.analyzing
  }
  if (message.startsWith('Command matched whitelist:')) return t.commandReview.whitelisted
  if (message.startsWith('Command approved by user.')) {
    const note =
      message.match(/User approval note:\s*([\s\S]+)$/)?.[1]?.trim() ||
      message.match(/User note:\s*([\s\S]+)$/)?.[1]?.trim()
    return note
      ? `${t.commandReview.approved}\n${t.commandReview.decisionNote}: ${note}`
      : t.commandReview.approved
  }
  if (message.startsWith('Command rejected by user.')) {
    const reason = message.match(/User rejection reason:\s*([\s\S]+)$/)?.[1]?.trim()
    return reason
      ? `${t.commandReview.rejected}\n${t.commandReview.rejectionReason}: ${reason}`
      : t.commandReview.rejected
  }
  if (message === 'Command approved by user.') return t.commandReview.approved
  if (message === 'Command rejected by user.') return t.commandReview.rejected
  if (message === 'Running in chat-only terminal assistant mode.') return t.input.currentTerminal
  if (message === 'Done.') return t.input.done
  if (message === 'Agent run canceled.') return t.input.agentCanceled
  if (message === 'Planning before execution...') return t.input.createdPlan
  if (message === 'Understanding the user request and current terminal context.') {
    return t.input.understandingRequest
  }
  if (message === 'Understanding the user request and available non-terminal context.') {
    return t.input.understandingRequest
  }
  if (message === 'Breaking the request into verifiable steps before execution.') {
    return t.input.breakingDownTask
  }
  if (isNoisyMcpCatalogMessage(message)) return message
  if (/^Selected \d+ active tools:/.test(message)) return t.input.toolsConfigured
  if (/^Executing plan with ReAct step /.test(message)) return t.input.executingPlanStep
  if (/^Assessing the request and choosing one concrete next action/.test(message)) {
    return t.input.reasoningNextStep
  }
  if (/^Reasoning and acting step /.test(message)) return t.input.reasoningNextStep
  if (message === 'Analyzing tool results and preparing the next action...') {
    return t.input.analyzingNextAction
  }
  if (
    message ===
    'Reviewing the latest observation and deciding whether to continue, verify, or summarize.'
  ) {
    return t.input.reviewingObservation
  }
  const preparingTool = message.match(/^Preparing to run tool ([\w.-]+) for the current step\.$/)
  if (preparingTool) return `${t.input.preparingToolAction}: ${preparingTool[1]}`
  if (message === 'Analyzing tool results and preparing the final answer...') {
    return t.input.synthesizingResult
  }

  return message
}

function truncateCommandOutput(output: string): string {
  const normalized = output.trim()
  if (!normalized) return ''

  const maxLength = 4000
  return normalized.length > maxLength ? `${normalized.slice(-maxLength)}\n...` : normalized
}
