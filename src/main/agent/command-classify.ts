import {
  HIGH,
  READONLY,
  extractRiskVerb,
  hasHighWriteVerb,
  isStaticallyReadonly
} from '../../shared/command-guard'
import type { CommandAuditSource } from '../../shared/agent-types'
import { CommandAuditor, CommandAuditTimeoutError } from './command-auditor'
import { matchCommandWhitelist } from './command-whitelist'
import type { AgentConfig, CommandAuditResult } from './types'

export interface ClassifyCommandResult {
  level: 'low' | 'high'
  source: CommandAuditSource
  elapsedMs: number
  audit: CommandAuditResult
  whitelistRule?: string
}

/**
 * Funnel order: HIGH → whitelist → READONLY → subagent.
 * Destructive HIGH always wins over a broad whitelist pattern.
 * Subagent "high" is clamped to low when static READONLY matches.
 */
export async function classifyCommand(
  cmd: string,
  ctx: {
    config: AgentConfig
    userInput: string
    terminalContext?: string
    locale?: string
  }
): Promise<ClassifyCommandResult> {
  const startedAt = Date.now()

  if (HIGH.test(cmd)) {
    const elapsedMs = Date.now() - startedAt
    const audit = buildRuleAudit('high', 'rule', elapsedMs, ctx.locale, undefined, cmd)
    return { level: 'high', source: 'rule', elapsedMs, audit }
  }

  const whitelistRule = matchCommandWhitelist(cmd, ctx.config.commandWhitelist ?? [])
  if (whitelistRule) {
    const elapsedMs = Date.now() - startedAt
    const audit = buildRuleAudit('low', 'whitelist', elapsedMs, ctx.locale, whitelistRule)
    return { level: 'low', source: 'whitelist', elapsedMs, audit, whitelistRule }
  }

  if (READONLY.test(cmd)) {
    const elapsedMs = Date.now() - startedAt
    const audit = buildRuleAudit('low', 'rule', elapsedMs, ctx.locale)
    return { level: 'low', source: 'rule', elapsedMs, audit }
  }

  const auditor = new CommandAuditor(ctx.config)
  try {
    const audit = await auditor.audit({
      command: cmd,
      userInput: ctx.userInput,
      terminalContext: ctx.terminalContext ?? '',
      locale: ctx.locale
    })
    const elapsedMs = Date.now() - startedAt
    // Clamp mistaken high ratings when the command is statically read-only.
    const level: 'low' | 'high' = audit.risk === 'low' || isStaticallyReadonly(cmd) ? 'low' : 'high'
    const human =
      level === 'high'
        ? buildHighRiskHumanSummary(cmd, ctx.locale)
        : isStaticallyReadonly(cmd)
          ? buildReadOnlyHumanSummary(cmd, ctx.locale)
          : audit.summary
    return {
      level,
      source: 'subagent',
      elapsedMs,
      audit: {
        ...audit,
        summary: human,
        operationReason: human,
        risk: level,
        requiresApproval: level === 'high',
        riskPoints: level === 'high' ? [] : audit.riskPoints,
        impactAnalysis: level === 'high' ? '' : audit.impactAnalysis,
        recommendation: level === 'high' ? '' : audit.recommendation,
        source: 'subagent',
        elapsedMs
      }
    }
  } catch (error) {
    const elapsedMs = Date.now() - startedAt
    if (error instanceof CommandAuditTimeoutError) {
      const level: 'low' | 'high' =
        hasHighWriteVerb(cmd) && !isStaticallyReadonly(cmd) ? 'high' : 'low'
      const audit = buildTimeoutFallbackAudit(level, elapsedMs, ctx.locale, cmd)
      return { level, source: 'timeout-fallback', elapsedMs, audit }
    }
    throw error
  }
}

function buildHighRiskHumanSummary(cmd: string, locale: string | undefined): string {
  const zh = resolveZh(locale)
  const verb = extractRiskVerb(cmd)
  return zh
    ? `⚠️ 该命令会执行远程操作（${verb}），需你确认后执行。`
    : `⚠️ This command performs a remote action (${verb}). Confirm to proceed.`
}

function buildReadOnlyHumanSummary(cmd: string, locale: string | undefined): string {
  const zh = resolveZh(locale)
  const verb = extractRiskVerb(cmd)
  return zh ? `该命令为只读查询（${verb}）。` : `This command is a read-only query (${verb}).`
}

function buildRuleAudit(
  level: 'low' | 'high',
  source: 'whitelist' | 'rule',
  elapsedMs: number,
  locale: string | undefined,
  whitelistRule?: string,
  command?: string
): CommandAuditResult {
  const zh = resolveZh(locale)
  const summary =
    source === 'whitelist'
      ? zh
        ? `命中白名单：${whitelistRule}`
        : `Matched whitelist: ${whitelistRule}`
      : level === 'low'
        ? zh
          ? '静态规则判定为只读'
          : 'Static rule: read-only'
        : buildHighRiskHumanSummary(command ?? '', locale)

  return {
    summary,
    operationReason: summary,
    risk: level,
    requiresApproval: level === 'high',
    riskPoints: [],
    impactAnalysis: '',
    recommendation: '',
    source,
    elapsedMs
  }
}

function buildTimeoutFallbackAudit(
  level: 'low' | 'high',
  elapsedMs: number,
  locale: string | undefined,
  cmd?: string
): CommandAuditResult {
  const zh = resolveZh(locale)
  const summary =
    level === 'high'
      ? buildHighRiskHumanSummary(cmd ?? '', locale)
      : zh
        ? '审核超时，按只读回退自动通过'
        : 'Audit timed out; auto-approved as read-only fallback'
  return {
    summary,
    operationReason: summary,
    risk: level,
    requiresApproval: level === 'high',
    riskPoints: [],
    impactAnalysis: '',
    recommendation: '',
    source: 'timeout-fallback',
    elapsedMs
  }
}

function resolveZh(locale: string | undefined): boolean {
  return Boolean(locale?.toLowerCase().startsWith('zh'))
}
