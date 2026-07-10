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
    locale?: string
  }): Promise<CommandAuditResult> {
    const language = resolveAuditLanguage(input.locale, input.userInput)
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
              'If the user requested a specific report/file destination but the command writes somewhere else, include that as a risk point and recommend correcting the command before execution.',
              'Classify destructive file operations, privilege escalation, credential exposure, network changes, service restarts, data deletion, package installation, and remote execution as medium or high risk as appropriate.',
              `Write all human-readable JSON field values in ${language === 'zh-CN' ? 'Simplified Chinese' : 'English'}. Keep the JSON keys and risk enum values unchanged.`,
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

      return parseAuditResult(completion.choices[0]?.message.content ?? '', language)
    } catch (error) {
      return {
        summary:
          language === 'zh-CN'
            ? '命令审核模型在执行前失败。'
            : 'Command audit model failed before execution.',
        risk: 'high',
        requiresApproval: true,
        riskPoints: [error instanceof Error ? error.message : String(error)],
        impactAnalysis:
          language === 'zh-CN'
            ? '命令尚未执行。Crescent 无法确认该命令是否安全。'
            : 'The command was not executed. Crescent could not verify whether it is safe.',
        recommendation:
          language === 'zh-CN'
            ? '由于 Crescent 未能完成 AI 安全审核，请将该命令视为高风险处理。'
            : 'Treat this command as high risk because Crescent could not complete the AI safety review.'
      }
    }
  }
}

function parseAuditResult(content: string, language: 'zh-CN' | 'en'): CommandAuditResult {
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
      summary:
        typeof parsed.summary === 'string'
          ? parsed.summary
          : language === 'zh-CN'
            ? '命令已完成审核。'
            : 'Command reviewed.',
      risk,
      requiresApproval:
        risk !== 'low'
          ? true
          : typeof parsed.requiresApproval === 'boolean'
            ? parsed.requiresApproval
            : false,
      riskPoints: riskPoints.length
        ? riskPoints
        : [
            language === 'zh-CN'
              ? '审核结果未返回明确风险点。'
              : 'No specific risk point was returned.'
          ],
      impactAnalysis:
        typeof parsed.impactAnalysis === 'string'
          ? parsed.impactAnalysis
          : risk === 'low'
            ? language === 'zh-CN'
              ? '预计不会产生系统变更影响。'
              : 'No system-changing impact is expected.'
            : language === 'zh-CN'
              ? '该命令存在潜在影响，执行前需要用户审核。'
              : 'Potential impact requires user review before execution.',
      recommendation:
        typeof parsed.recommendation === 'string'
          ? parsed.recommendation
          : language === 'zh-CN'
            ? '请确认命令符合你的意图后再批准执行。'
            : 'Review the command and approve only if it matches your intent.'
    }
  } catch {
    return {
      summary:
        language === 'zh-CN'
          ? '命令审核响应不是有效 JSON。'
          : 'Command audit response was not valid JSON.',
      risk: 'high',
      requiresApproval: true,
      riskPoints: [
        content.trim() || (language === 'zh-CN' ? '审核响应为空。' : 'Empty audit response.')
      ],
      impactAnalysis:
        language === 'zh-CN'
          ? '命令尚未执行。Crescent 无法解析审核结果，因此影响未知。'
          : 'The command was not executed. Crescent could not parse the audit result, so the impact is unknown.',
      recommendation:
        language === 'zh-CN'
          ? '请人工审核后再决定是否批准执行。'
          : 'Review manually before approving execution.'
    }
  }
}

function normalizeRisk(value: unknown): CommandRiskLevel {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'high'
}

function resolveAuditLanguage(locale: string | undefined, userInput: string): 'zh-CN' | 'en' {
  if (locale?.toLowerCase().startsWith('zh')) return 'zh-CN'
  if (locale?.toLowerCase().startsWith('en')) return 'en'
  return /[\u3400-\u9fff]/.test(userInput) ? 'zh-CN' : 'en'
}
