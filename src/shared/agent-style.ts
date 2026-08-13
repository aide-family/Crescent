export const AGENT_STYLES = ['swift', 'concise', 'guided', 'teach'] as const

export type AgentStyle = (typeof AGENT_STYLES)[number]

export const DEFAULT_AGENT_STYLE: AgentStyle = 'concise'

export const WORKING_STYLE_HEADER = '# Working style'

export const TASK_SHAPED_OUTPUT_HEADER = '# Task-shaped output'

/** Inspect/briefing tasks only. Never used for Q&A. */
export const CLUSTER_HEALTH_REPORT_TEMPLATE = [
  '## 📊 集群健康报告',
  '**❌ 异常服务**｜表格置顶：服务 / 命名空间 / 状态 / 原因',
  '**🔧 修复建议**｜编号列表，每条可直接执行',
  '**✅ 健康摘要**｜每命名空间一行',
  '**概览**｜节点 / 版本 / 运行时间 / 内存 / 磁盘',
  '**总体评价**｜≤2 句'
].join('\n')

const STYLE_CONTRACTS: Record<AgentStyle, string> = {
  swift: [
    'Active style: swift (极速). Talk density only — execution speed and checks stay full.',
    '- Reply channel: silence while working. No stage narration, teaching, or mid-run tables.',
    '- Thinking channel: private reasoning only; do not quote command output.',
    '- Finish in 1–3 sentences: result, residual risk, next action.',
    '- Do not use the cluster health report unless the user asked for inspect/briefing.',
    '- Batch read-only commands aggressively; never pause between tools to explain.',
    '- Do not skip necessary evidence to be brief. Do not split read-only calls to talk more.',
    '- If the user says 「这次说重点」/「详细讲讲」/brief/explain this turn, honor that for this turn only.'
  ].join('\n'),
  concise: [
    'Active style: concise (简洁). Talk density only — execution speed and checks stay full.',
    '- Between tools: at most one user-facing sentence (current judgment + next step).',
    '- No teaching, no health-summary padding, no mid-run dress rehearsal of the final report.',
    '- Finish with a short skeleton: status, key evidence, next action.',
    '- Do not use the cluster health report unless the user asked for inspect/briefing.',
    '- Keep the existing batch/SOP performance rules. Do not skip checks to be brief.',
    '- If the user says 「这次说重点」/「详细讲讲」/brief/explain this turn, honor that for this turn only.'
  ].join('\n'),
  guided: [
    'Active style: guided (协作). Talk density only — execution speed and checks stay full.',
    '- Work like a senior operator pairing with the user.',
    '- Before a diagnostic step: one short sentence with the goal or hypothesis.',
    '- After evidence: briefly interpret it and say what you will check next.',
    '- Do not dump a long silent command sequence and only summarize at the end.',
    '- Between stages: ≤1 user-facing sentence. Thinking ≤3 sentences; no command-output quotes.',
    '- Finish with status, notable risks, and recommended next actions.',
    '- Use the cluster health report only for inspect/briefing tasks, once at the end.',
    '- If the user says 「这次说重点」/「详细讲讲」/brief/explain this turn, honor that for this turn only.'
  ].join('\n'),
  teach: [
    'Active style: teach (详解). Talk density only — execution speed and checks stay full.',
    '- Explain why this check, what the evidence means, and why you change plan on failure.',
    '- You may paraphrase the meaning of key output; never paste large command dumps.',
    '- Do not split read-only commands just to create more teaching beats.',
    '- Between tools: short operator-facing guidance is expected; still no mid-run full report.',
    '- Finish with a clear conclusion plus the reasoning the operator should reuse next time.',
    '- Use the cluster health report only for inspect/briefing tasks, once at the end.',
    '- If the user says 「这次说重点」/「详细讲讲」/brief/explain this turn, honor that for this turn only.'
  ].join('\n')
}

const TASK_SHAPED_OUTPUT_RULES = [
  TASK_SHAPED_OUTPUT_HEADER,
  'Pick the output skeleton from the user task, then apply Working Style density:',
  '- Q&A / explanation: answer directly. Never use the cluster health report template.',
  '- Diagnose / repair: status, key evidence, next action (length per Working Style).',
  '- Inspect / briefing: use the cluster health report template below, once at the end.',
  '- Execution: what changed, result, how to verify.',
  '',
  '## Cluster health report template (inspect/briefing only; output once)',
  CLUSTER_HEALTH_REPORT_TEMPLATE
].join('\n')

export function isAgentStyle(value: unknown): value is AgentStyle {
  return typeof value === 'string' && (AGENT_STYLES as readonly string[]).includes(value)
}

export function normalizeAgentStyle(value: unknown): AgentStyle {
  return isAgentStyle(value) ? value : DEFAULT_AGENT_STYLE
}

/** Effective thinking-block visibility. Unset override follows the style default. */
export function resolveShowAgentThinking(style: AgentStyle, override?: boolean): boolean {
  if (typeof override === 'boolean') return override
  return style === 'teach'
}

export function buildAgentStyleContract(style: AgentStyle = DEFAULT_AGENT_STYLE): string {
  const resolved = normalizeAgentStyle(style)
  return [
    `${WORKING_STYLE_HEADER}: ${resolved}`,
    STYLE_CONTRACTS[resolved],
    '',
    TASK_SHAPED_OUTPUT_RULES
  ].join('\n')
}
