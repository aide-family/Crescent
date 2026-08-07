import { parseJsonFromModelContent } from '../../shared/json-parse'
import { AgentBrain } from './brain'
import { getAgentProviders } from './model-provider-config'
import type { AgentConfig, CommandAuditResult } from './types'

/** Hard cap for AI command audit — prevents tool spinner hang when the model stalls. */
export const COMMAND_AUDIT_TIMEOUT_MS = 10_000

const AUDIT_SYSTEM_PROMPT = [
  '你是命令安全审核器，只判断不执行。严格输出一行 JSON，无解释：',
  '{"level":"low|high","reason":"≤15字"}',
  'low：纯只读查询/读日志/网络 GET，及其 && 与 | 组合。',
  'high：含任何写、删、改状态、改权限、输出重定向；读写混合；不确定。'
].join('\n')

export class CommandAuditTimeoutError extends Error {
  constructor() {
    super('Command audit timed out')
    this.name = 'CommandAuditTimeoutError'
  }
}

export class CommandAuditor {
  private readonly brain: AgentBrain
  private readonly config: AgentConfig

  constructor(config: AgentConfig) {
    this.config = config
    this.brain = new AgentBrain(config)
  }

  async audit(input: {
    command: string
    userInput: string
    terminalContext: string
    locale?: string
  }): Promise<CommandAuditResult> {
    const language = resolveAuditLanguage(input.locale)
    const resolved = resolveAuditModel(this.config)
    console.info(`[command-audit] model=${resolved.modelId} source=${resolved.source}`)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), COMMAND_AUDIT_TIMEOUT_MS)

    try {
      let modelId = resolved.modelId
      let modelSource = resolved.source
      let content = ''

      try {
        content = await this.requestAudit(input.command, modelId, controller.signal)
      } catch (error) {
        if (isAbortError(error, controller.signal)) throw new CommandAuditTimeoutError()
        if (modelSource === 'heuristic' && modelId !== this.config.model.trim()) {
          modelId = this.config.model.trim() || this.brain.defaultModel
          modelSource = 'fallback'
          console.info(`[command-audit] model=${modelId} source=${modelSource} (retry after error)`)
          content = await this.requestAudit(input.command, modelId, controller.signal)
        } else {
          throw error
        }
      }

      let parsed = tryParseAuditLevel(content)
      if (!parsed && modelSource === 'heuristic' && modelId !== this.config.model.trim()) {
        modelId = this.config.model.trim() || this.brain.defaultModel
        modelSource = 'fallback'
        console.info(`[command-audit] model=${modelId} source=${modelSource} (retry after non-JSON)`)
        content = await this.requestAudit(input.command, modelId, controller.signal)
        parsed = tryParseAuditLevel(content)
      }

      const audit = parsed
        ? buildAuditFromLevel(parsed.level, parsed.reason, language)
        : buildHighAudit(
            language === 'zh-CN' ? '命令审核响应不是有效 JSON。' : 'Command audit response was not valid JSON.',
            content.trim() || (language === 'zh-CN' ? '审核响应为空。' : 'Empty audit response.'),
            language
          )

      return applyLocalCommandPolicy(input.command, input.userInput, audit, language)
    } catch (error) {
      if (error instanceof CommandAuditTimeoutError || isAbortError(error, controller.signal)) {
        throw new CommandAuditTimeoutError()
      }
      return buildHighAudit(
        language === 'zh-CN' ? '命令审核模型在执行前失败。' : 'Command audit model failed before execution.',
        error instanceof Error ? error.message : String(error),
        language
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  private async requestAudit(
    command: string,
    modelId: string,
    signal: AbortSignal
  ): Promise<string> {
    const completion = await this.brain.chat(
      {
        temperature: 0,
        max_tokens: 60,
        messages: [
          { role: 'system', content: AUDIT_SYSTEM_PROMPT },
          { role: 'user', content: command }
        ]
      },
      { signal, model: modelId }
    )
    return completion.choices[0]?.message.content ?? ''
  }
}

export function resolveAuditModel(config: AgentConfig): {
  modelId: string
  source: 'heuristic' | 'fallback'
} {
  const fallback = config.model.trim()
  const providers = getAgentProviders(config)
  const provider =
    providers.find((candidate) => candidate.id === config.providerId?.trim()) ?? providers[0]
  const modelIds = provider?.models.map((model) => model.id) ?? []

  const tier1 = modelIds.find((id) => /mini|flash|lite|small|haiku|nano/i.test(id))
  if (tier1) return { modelId: tier1, source: 'heuristic' }

  const tier2 = modelIds.find(
    (id) => /chat|instruct/i.test(id) && !/reason|think|pro|max|ultra/i.test(id)
  )
  if (tier2) return { modelId: tier2, source: 'heuristic' }

  return { modelId: fallback || modelIds[0] || 'unknown', source: 'fallback' }
}

/** @deprecated Prefer tryParseAuditLevel; kept for older call sites/tests. */
export function parseAuditResult(
  content: string,
  language: 'zh-CN' | 'en' = 'en'
): CommandAuditResult {
  const parsed = tryParseAuditLevel(content)
  if (!parsed) {
    return buildHighAudit(
      language === 'zh-CN' ? '命令审核响应不是有效 JSON。' : 'Command audit response was not valid JSON.',
      content.trim() || (language === 'zh-CN' ? '审核响应为空。' : 'Empty audit response.'),
      language
    )
  }
  return buildAuditFromLevel(parsed.level, parsed.reason, language)
}

export function tryParseAuditLevel(content: string): { level: 'low' | 'high'; reason: string } | null {
  try {
    const parsed = parseJsonFromModelContent<{ level?: unknown; reason?: unknown; risk?: unknown }>(
      content
    )
    const raw = parsed.level ?? parsed.risk
    const level = normalizeAuditLevel(raw)
    if (!level) return null
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 15) : ''
    return { level, reason }
  } catch {
    return null
  }
}

function normalizeAuditLevel(value: unknown): 'low' | 'high' | null {
  if (value === 'low') return 'low'
  if (value === 'high' || value === 'medium') return 'high'
  return null
}

function buildAuditFromLevel(
  level: 'low' | 'high',
  reason: string,
  language: 'zh-CN' | 'en'
): CommandAuditResult {
  const summary =
    reason ||
    (level === 'low'
      ? language === 'zh-CN'
        ? '低风险只读命令'
        : 'Low-risk read-only command'
      : language === 'zh-CN'
        ? '高风险需确认'
        : 'High risk; confirmation required')

  return {
    summary,
    operationReason: summary,
    risk: level,
    requiresApproval: level === 'high',
    riskPoints: level === 'high' ? [summary] : [],
    impactAnalysis:
      level === 'low'
        ? language === 'zh-CN'
          ? '预计不会产生系统变更影响。'
          : 'No system-changing impact is expected.'
        : language === 'zh-CN'
          ? '该命令存在潜在影响，执行前需要用户审核。'
          : 'Potential impact requires user review before execution.',
    recommendation:
      level === 'low'
        ? language === 'zh-CN'
          ? '可自动执行。'
          : 'Safe to auto-execute.'
        : language === 'zh-CN'
          ? '请确认命令符合你的意图后再批准执行。'
          : 'Review the command and approve only if it matches your intent.',
    source: 'subagent'
  }
}

function buildHighAudit(
  summary: string,
  detail: string,
  language: 'zh-CN' | 'en'
): CommandAuditResult {
  return {
    summary,
    operationReason:
      language === 'zh-CN'
        ? '由于审核未能完成可靠分类，按高风险处理。'
        : 'Treating as high risk because classification was unreliable.',
    risk: 'high',
    requiresApproval: true,
    riskPoints: [detail],
    impactAnalysis:
      language === 'zh-CN'
        ? '命令尚未执行。影响未知。'
        : 'The command was not executed. Impact is unknown.',
    recommendation:
      language === 'zh-CN'
        ? '请人工审核后再决定是否批准执行。'
        : 'Review manually before approving execution.',
    source: 'subagent'
  }
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof Error &&
      (error.name === 'AbortError' || /aborted|timeout/i.test(error.message)))
  )
}

function resolveAuditLanguage(locale: string | undefined): 'zh-CN' | 'en' {
  return locale?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function applyLocalCommandPolicy(
  command: string,
  userInput: string,
  audit: CommandAuditResult,
  language: 'zh-CN' | 'en'
): CommandAuditResult {
  let result = audit

  if (violatesNoReconnectConstraint(command, userInput)) {
    const riskPoint =
      language === 'zh-CN'
        ? '用户要求不要重新 SSH、不要重新登录或只使用当前终端，但该命令会新建 SSH 连接。'
        : 'The user asked not to reconnect, not to SSH again, or to use only the current terminal, but this command opens a new SSH connection.'
    const recommendation =
      language === 'zh-CN'
        ? '不要直接执行新的 ssh。先使用当前会话中的目标主机上下文，或向用户确认是否允许重新连接到该主机。'
        : 'Do not run a new ssh command directly. Use the current session target context, or ask the user to confirm that reconnecting to the host is allowed.'

    result = {
      ...result,
      risk: 'high',
      requiresApproval: true,
      riskPoints: appendUnique(result.riskPoints, riskPoint),
      recommendation: appendSentence(result.recommendation, recommendation)
    }
  }

  if (!looksLikeGeneratedReportWrite(command, userInput)) return result

  const riskPoint =
    language === 'zh-CN'
      ? '命令正在通过当前终端写入巡检报告或本地产物，但用户没有明确要求写入该终端路径。'
      : 'The command writes an inspection report or local artifact through the current terminal without an explicit request for that terminal destination.'
  const recommendation =
    language === 'zh-CN'
      ? '先完成巡检并汇总结论，然后让用户确认客户端机器上的目标目录；确认后使用 write_local_file 写入该目录。不要默认写到 /、/root、/tmp 或当前终端目录。'
      : 'Finish the inspection and summarize findings, then ask the user to confirm a target directory on the Crescent client machine; after confirmation, use write_local_file for that directory. Do not default to /, /root, /tmp, or the current terminal directory.'

  return {
    ...result,
    risk: 'high',
    requiresApproval: true,
    riskPoints: appendUnique(result.riskPoints, riskPoint),
    recommendation: appendSentence(result.recommendation, recommendation)
  }
}

function violatesNoReconnectConstraint(command: string, userInput: string): boolean {
  if (!/(^|[\s;&|({])ssh(?:\s|$)/i.test(command)) return false

  const constraintSource = extractOriginalUserTask(userInput) || userInput
  const explicitNoReconnect =
    /(?:不要|不能|无需|不需要|别|禁止|避免).{0,12}(?:重新)?\s*(?:ssh|登录|登陆|连接|切换|匹配连接)/i.test(
      constraintSource
    ) ||
    /(?:不要|不能|无需|不需要|别|禁止|避免).{0,12}(?:新建|再次|重新).{0,8}(?:会话|连接|ssh|登录|登陆)/i.test(
      constraintSource
    ) ||
    /(?:只|仅).{0,8}(?:当前|现有|已有).{0,8}(?:终端|会话|连接)/i.test(constraintSource) ||
    /(?:do not|don't|dont|avoid|no)\s+(?:reconnect|ssh|login|switch connections?)/i.test(
      constraintSource
    ) ||
    /(?:use|stay in)\s+(?:the\s+)?(?:current|existing)\s+(?:terminal|session|connection)\s+only/i.test(
      constraintSource
    )

  return explicitNoReconnect
}

function extractOriginalUserTask(input: string): string {
  const lines = input.split(/\r?\n/)
  const markerIndex = lines.findIndex((line) =>
    /^(用户原始任务|Original user task)\s*:?\s*$/i.test(line.trim())
  )
  if (markerIndex < 0) return ''

  return lines
    .slice(markerIndex + 1)
    .join('\n')
    .trim()
}

function looksLikeGeneratedReportWrite(command: string, userInput: string): boolean {
  const normalizedCommand = command.toLowerCase()
  const normalizedInput = userInput.toLowerCase()
  const writesFile =
    /(^|[\s;&|])(?:tee|cat)\s+[^|;&]*(?:\/|~|\$home)[^\s|;&]*/i.test(command) ||
    /(^|[^<>])>>?\s*(?:\/|~|\$HOME)[^\s|;&]*/.test(command) ||
    /\b(?:touch|cp|mv)\s+[^|;&]*(?:\/|~|\$HOME)[^\s|;&]*/i.test(command)
  if (!writesFile) return false

  const reportLike = /\b(report|inspection|summary|audit|check|health)\b|巡检|报告|总结/i.test(
    `${normalizedInput} ${normalizedCommand}`
  )
  const riskyDefaultDestination =
    /(?:^|[\s>"'])\/(?:root|tmp)?(?:\/|[\s"']|$)/.test(command) ||
    />>?\s*(?:report|inspection|summary|audit|check|health)[\w.-]*\.(?:md|txt|json|csv)\b/i.test(
      command
    )

  return reportLike && riskyDefaultDestination && !hasExplicitDestinationPath(userInput)
}

function hasExplicitDestinationPath(value: string): boolean {
  return /(?:~|\/|\$HOME)[^\s,;]*/.test(value)
}

function appendUnique(items: string[], item: string): string[] {
  return items.some((current) => current === item) ? items : [...items, item]
}

function appendSentence(value: string, sentence: string): string {
  return value.includes(sentence) ? value : [value, sentence].filter(Boolean).join(' ')
}
