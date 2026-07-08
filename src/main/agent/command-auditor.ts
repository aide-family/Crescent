import { AgentBrain } from './brain'
import type { AgentConfig, CommandAuditResult, CommandRiskLevel } from './types'

export class CommandAuditor {
  private readonly brain: AgentBrain

  constructor(config: AgentConfig) {
    this.brain = new AgentBrain(config)
  }

  async audit(input: {
    command: string
    userInput: string
    terminalContext: string
  }): Promise<CommandAuditResult> {
    try {
      const completion = await this.brain.chat({
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: [
              'You are an independent command safety reviewer for Crescent.',
              'Review the proposed terminal command before it is executed.',
              'Return strict JSON only: {"summary":"...","risk":"low|medium|high","requiresApproval":true|false,"riskPoints":["..."],"impactAnalysis":"...","recommendation":"..."}.',
              'Set requiresApproval=false only for clearly read-only inspection commands that do not change files, services, network, credentials, users, permissions, packages, cluster state, or remote systems.',
              'Set requiresApproval=true for medium and high risk commands, any ambiguous command, any command with shell redirection that writes files, destructive flags, privilege escalation, service control, package installation, network mutation, remote execution, credential handling, or data deletion.',
              'Classify destructive file operations, privilege escalation, credential exposure, network changes, service restarts, data deletion, package installation, and remote execution as medium or high risk as appropriate.',
              'Do not approve or reject. Only analyze risk and whether user approval is required.'
            ].join('\n')
          },
          {
            role: 'user',
            content: JSON.stringify(
              {
                userRequest: input.userInput,
                command: input.command,
                recentTerminalContext: input.terminalContext.slice(-6000)
              },
              null,
              2
            )
          }
        ]
      })

      return parseAuditResult(completion.choices[0]?.message.content ?? '')
    } catch (error) {
      return {
        summary: 'Command audit model failed before execution.',
        risk: 'high',
        requiresApproval: true,
        riskPoints: [error instanceof Error ? error.message : String(error)],
        impactAnalysis:
          'The command was not executed. Crescent could not verify whether it is safe.',
        recommendation:
          'Treat this command as high risk because Crescent could not complete the AI safety review.'
      }
    }
  }
}

function parseAuditResult(content: string): CommandAuditResult {
  try {
    const parsed = JSON.parse(content) as {
      summary?: unknown
      risk?: unknown
      requiresApproval?: unknown
      riskPoints?: unknown
      impactAnalysis?: unknown
      recommendation?: unknown
    }
    const risk = normalizeRisk(parsed.risk)
    const riskPoints = Array.isArray(parsed.riskPoints)
      ? parsed.riskPoints.filter((point): point is string => typeof point === 'string')
      : []

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'Command reviewed.',
      risk,
      requiresApproval:
        risk !== 'low'
          ? true
          : typeof parsed.requiresApproval === 'boolean'
            ? parsed.requiresApproval
            : false,
      riskPoints: riskPoints.length ? riskPoints : ['No specific risk point was returned.'],
      impactAnalysis:
        typeof parsed.impactAnalysis === 'string'
          ? parsed.impactAnalysis
          : risk === 'low'
            ? 'No system-changing impact is expected.'
            : 'Potential impact requires user review before execution.',
      recommendation:
        typeof parsed.recommendation === 'string'
          ? parsed.recommendation
          : 'Review the command and approve only if it matches your intent.'
    }
  } catch {
    return {
      summary: 'Command audit response was not valid JSON.',
      risk: 'high',
      requiresApproval: true,
      riskPoints: [content.trim() || 'Empty audit response.'],
      impactAnalysis:
        'The command was not executed. Crescent could not parse the audit result, so the impact is unknown.',
      recommendation: 'Review manually before approving execution.'
    }
  }
}

function normalizeRisk(value: unknown): CommandRiskLevel {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'high'
}
