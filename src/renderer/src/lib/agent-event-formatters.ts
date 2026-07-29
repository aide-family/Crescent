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
  const lines = [`${t.commandReview.command}:`, event.command]

  if (event.phase === 'started') {
    lines.push('', t.terminal.commandRunning)
    return lines.join('\n')
  }

  const result = event.result
  lines.push('', `${t.terminal.commandStatus}: ${result?.ok ? t.input.done : t.input.error}`)
  if (typeof result?.exitCode === 'number') {
    lines.push(`${t.terminal.commandExitCode}: ${result.exitCode}`)
  }
  if (typeof event.elapsedMs === 'number') {
    lines.push(`${t.input.elapsed}: ${formatDuration(event.elapsedMs)}`)
  }
  if (result?.cwd) lines.push(`${t.app.workingDirectory}: ${result.cwd}`)
  if (result?.mode) lines.push(`${t.terminal.terminalMode}: ${result.mode}`)
  if (result?.subterminalName) lines.push(`${t.terminal.subterminal}: ${result.subterminalName}`)
  if (result?.timedOut) lines.push(t.terminal.commandTimedOut)
  if (result?.terminalExited) lines.push(t.terminal.terminalDisconnected)
  if (result?.error) lines.push('', `${t.input.error}:`, result.error)

  const output = truncateCommandOutput(result?.output ?? '')
  if (output) {
    lines.push('', `${t.terminal.commandOutput}:`, output)
  }

  return lines.join('\n')
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
      if (event.message.startsWith('Command approved by user.')) return t.commandReview.approved
      if (event.message.startsWith('Command rejected by user.')) return t.commandReview.rejected
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
  if (message === 'Command review subprocess is analyzing risk.') return t.commandReview.analyzing
  if (message.startsWith('Command matched whitelist:')) return t.commandReview.whitelisted
  if (message.startsWith('Command approved by user.')) {
    const note = message.match(/User approval note:\s*([\s\S]+)$/)?.[1]?.trim()
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`

  return `${(ms / 1000).toFixed(1)}s`
}
