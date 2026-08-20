import type { Dictionary } from '../i18n'
import { logRoleLabel } from './agent-log'
import { sanitizeAgentLogTextForContext } from './agent-run-document'
import { formatConnectionTarget } from './connections'
import { normalizeTerminalControlText } from './terminal-text'
import type { AgentLogEntry, AgentTerminalTab, AgentToolReference } from './terminal-tabs'
import type {
  AgentPathReference,
  AgentSkillOption,
  AgentWikiReference,
  ConnectionConfig
} from '../../../shared/agent-types'
import { hasExplicitLocalWorkIntent } from '../../../shared/agent-local-intent'

export function isContinueIntent(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[.!?\s]+$/g, '')
    .replace(/\s+/g, ' ')

  return /^(continue|resume|keep going|go on|continue working|continue the task)$/.test(normalized)
}

export function isExplicitReconnectRequest(value: string): boolean {
  return (
    // 重连 / 重新连接 / 再连一次 / 重试连接 / 重试当前连接 / 重试 ssh 登录
    /重连|重新连接|再连(?:一次|一下)?|重试\s*(?:ssh\s*)?(?:登录|连接)|重试当前\s*连接/.test(
      value
    ) ||
    /reconnect|re-?connect|retry\s+(?:the\s+|current\s+)?(?:ssh\s+)?(?:login|connection)/i.test(
      value
    )
  )
}

export function isPasswordChangedReconnectRequest(value: string): boolean {
  if (!isExplicitReconnectRequest(value)) return false
  return (
    // 密码已修改 / 密码改了 / 密码变了 / 密码换了吗
    /密码(?:已(?:经)?)?(?:修改|更改|更新|变更|改|换|变|重置)(?:了|过)?/.test(value) ||
    // 已修改密码 / 刚换了密码
    /(?:已|刚|刚刚)(?:经)?(?:修改|更改|更新|变更|改|换|变|重置)(?:了|过)?密码/.test(value) ||
    // 改了密码 / 换了新密码
    /(?:修改|更改|更新|变更|改|换|变|重置)(?:了|过)(?:新|个)?密码/.test(value) ||
    // password changed / password has been reset / changed my password
    /password\s+(?:has\s+been\s+)?(?:changed|updated|reset|modified|rotated|renewed)/i.test(
      value
    ) ||
    /(?:changed|updated|reset|modified|rotated|renewed)\s+(?:my|the)\s+password/i.test(value)
  )
}

export function isExplicitConnectionRequest(value: string): boolean {
  return (
    isExplicitReconnectRequest(value) ||
    /^\/connection(?::|\s|$)|(^|\s)(ssh|login|connect)\b/i.test(value) ||
    /(?:^|\s)(?:连接|登录|登陆|登入|进入|切换)(?:\s|到|至|$|[A-Za-z0-9\u4e00-\u9fff])/u.test(value)
  )
}

export function isExplicitNonTerminalAgentRequest(
  value: string,
  toolRefs: AgentToolReference[] = []
): boolean {
  if (
    toolRefs.some((tool) => tool.name.startsWith('mcp_') || tool.description.includes('mcp://'))
  ) {
    return true
  }

  return /\bMCP\b|filesystem\s+MCP|MCP\s+filesystem|使用\s*Filesystem/i.test(value)
}

export function hasUsableCurrentTerminal(
  tab: AgentTerminalTab | undefined,
  output: string,
  terminalMode?: string
): boolean {
  if (terminalMode === 'none') return false
  if (tab && tab.terminalReady === false) return false

  if (tab?.isSsh || tab?.connectionId) {
    return tab.terminalReady !== false && terminalMode !== 'none'
  }

  const normalized = normalizeTerminalControlText(output).trim()
  if (!normalized) return false

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20)
  if (lines.length === 0) return false

  return lines.some(
    (line) =>
      !/^\[Crescent\]/.test(line) && !/^(__CRESCENT_CMD_START_|__CRESCENT_CMD_END_)/.test(line)
  )
}

export function findDirectlyMentionedConnection(
  input: string,
  connections: ConnectionConfig[]
): ConnectionConfig | undefined {
  if (hasExplicitLocalWorkIntent(input)) return undefined

  const searchable = connectionMentionSearchText(input)
  const allowHostOrUserMatch = isExplicitConnectionRequest(input)
  const matches = connections.filter((connection) => {
    const nameTokens = getConnectionNameMentionTokens(connection)
    if (nameTokens.some((token) => connectionNameTokenAppearsInSearchText(searchable, token))) {
      return true
    }
    if (!allowHostOrUserMatch) return false

    return getConnectionHostUserMentionTokens(connection).some((token) =>
      connectionNameTokenAppearsInSearchText(searchable, token)
    )
  })
  return matches.length === 1 ? matches[0] : undefined
}

const FILESYSTEM_PATH_SPAN_RE =
  /(?:~|\$HOME|\/Users\/|\/home\/|\/opt\/|\/var\/|\/tmp\/|\/etc\/|[A-Za-z]:\\)[^\s`"'<>，。]+/gi

export function stripFilesystemPathSpans(input: string): string {
  return input.replace(FILESYSTEM_PATH_SPAN_RE, ' ')
}

/**
 * Drop pasted PTY prompts (`root@web-nginx1`) and scp/rsync hop destinations
 * (`nginx2:/path`) so they are not treated as named Crescent connections.
 */
export function stripPastedPromptAndRemoteCopySpans(input: string): string {
  return input.replace(/\b[\w.-]+@[\w.-]+\b/g, ' ').replace(/\b[\w.-]+:\/[^\s]*/g, ' ')
}

/** Text used to match configured connection names. */
export function connectionMentionSearchText(input: string): string {
  const withoutPaths = stripFilesystemPathSpans(input)
  if (isExplicitConnectionRequest(input)) return withoutPaths
  return stripFilesystemPathSpans(stripPastedPromptAndRemoteCopySpans(input))
}

function connectionNameTokenAppearsInSearchText(searchable: string, token: string): boolean {
  if (!token) return false
  if (/^\p{Script=Han}+$/u.test(token)) {
    return normalizeConnectionMentionText(searchable).includes(
      normalizeConnectionMentionText(token)
    )
  }
  if (/^[a-z0-9]+$/i.test(token)) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}([^A-Za-z0-9_-]|$)`, 'i').test(searchable)
  }
  return normalizeConnectionMentionText(searchable).includes(normalizeConnectionMentionText(token))
}

/** True when a connection name token is a real mention, not a path fragment like aide-family. */
export function connectionNameTokenAppearsInInput(input: string, token: string): boolean {
  return connectionNameTokenAppearsInSearchText(connectionMentionSearchText(input), token)
}

export function isSameConnectionTab(
  tab: AgentTerminalTab | undefined,
  connection: ConnectionConfig | undefined
): boolean {
  if (!tab || !connection) return false
  if (tab.connectionId && tab.connectionId === connection.id) return true

  return Boolean(tab.connectionName && tab.connectionName === connection.name)
}

export function getConnectionMentionTokens(connection: ConnectionConfig): string[] {
  return [
    ...getConnectionNameMentionTokens(connection),
    ...getConnectionHostUserMentionTokens(connection)
  ]
}

export function getConnectionNameMentionTokens(connection: ConnectionConfig): string[] {
  return buildConnectionMentionTokens([connection.name])
}

export function getConnectionHostUserMentionTokens(connection: ConnectionConfig): string[] {
  return buildConnectionMentionTokens([connection.host, connection.user])
}

function buildConnectionMentionTokens(values: Array<string | undefined>): string[] {
  const concreteValues = values.filter((value): value is string => Boolean(value))
  const tokens = new Set<string>()

  for (const value of concreteValues) {
    const normalizedValue = normalizeConnectionMentionText(value)
    if (normalizedValue.length >= 3) tokens.add(normalizedValue)

    for (const token of splitMixedScriptSegments(value)) {
      const normalizedToken = normalizeConnectionMentionText(token)
      if (normalizedToken.length >= 3) tokens.add(normalizedToken)
    }
  }

  return [...tokens]
}

/**
 * Split a value into CJK / non-CJK runs so mixed-script names like
 * "demo测试集群" also yield shorthand tokens ("demo", "测试集群").
 * This lets requests such as "登录demo集群" match the configured name.
 */
function splitMixedScriptSegments(value: string): string[] {
  const segments: string[] = []
  let buffer = ''
  let bufferIsCjk: boolean | undefined

  const flush = (): void => {
    if (!buffer) return
    for (const token of buffer.split(/[^\p{L}\p{N}]+/u)) {
      if (token) segments.push(token)
    }
    buffer = ''
  }

  for (const char of value) {
    const isCjk = /\p{Script=Han}/u.test(char)
    if (bufferIsCjk !== undefined && isCjk !== bufferIsCjk) flush()
    buffer += char
    bufferIsCjk = isCjk
  }
  flush()

  return segments
}

export function normalizeConnectionMentionText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export function isConnectionOnlyRequest(input: string, connection: ConnectionConfig): boolean {
  let normalized = normalizeConnectionMentionText(input)
  const removableTokens = [
    ...getConnectionMentionTokens(connection),
    'connection',
    'connect',
    'login',
    'ssh',
    'open',
    'reconnect',
    'retry',
    '连接',
    '登录',
    '登入',
    '打开',
    '进入',
    '切换',
    '集群',
    '环境',
    '到',
    '至',
    '重新连接',
    '重连',
    '重试当前连接',
    '重试连接',
    '重试',
    '再连'
  ].sort((left, right) => right.length - left.length)

  for (const token of removableTokens) {
    normalized = normalized.replaceAll(token, '')
  }

  return normalized.length === 0
}

export function buildResumeAgentInput(
  tab: AgentTerminalTab,
  latestInput: string,
  t: Dictionary
): string {
  const previousUserEntry = [...tab.agentLog].reverse().find((entry) => entry.kind === 'user')
  const recentContext = tab.agentLog
    .slice(-10)
    .map((entry) => formatResumeContextEntry(entry, t))
    .filter(Boolean)
    .join('\n\n')

  return [
    t.input.resumeInstruction,
    previousUserEntry ? `${t.input.resumePreviousGoal}\n${previousUserEntry.text}` : '',
    `${t.input.resumeLatestInput}\n${latestInput}`,
    recentContext ? `${t.input.resumeRecentContext}\n${recentContext}` : t.input.resumeNoContext
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildRecentConversationContext(
  tab: AgentTerminalTab | undefined,
  currentInput: string,
  t: Dictionary
): string {
  if (!tab) return ''

  const normalizedCurrentInput = currentInput.trim()
  const entries = tab.agentLog
    .filter((entry) => {
      if (entry.kind === 'status') return false
      if (entry.kind !== 'user') return true

      return entry.text.trim() !== normalizedCurrentInput
    })
    .slice(-8)

  const latestAssistant = [...entries].reverse().find((entry) => entry.kind === 'assistant')
  const compactEntries = entries
    .filter((entry) => entry.id !== latestAssistant?.id)
    .slice(-4)
    .map((entry) => formatRecentConversationEntry(entry, t, 2200))
    .filter(Boolean)

  const latestAssistantContext = latestAssistant
    ? [
        `${t.input.resumeRecentContext} - latest assistant result`,
        formatRecentConversationEntry(latestAssistant, t, 40_000)
      ].join('\n')
    : ''

  return [...compactEntries, latestAssistantContext].filter(Boolean).join('\n\n')
}

export function formatRecentConversationEntry(
  entry: AgentLogEntry,
  t: Dictionary,
  maxChars: number
): string {
  const role = logRoleLabel(entry.kind, t)
  const sanitized = sanitizeAgentLogTextForContext(entry.text, t)
  if (sanitized == null) return ''
  const text = sanitized.trim()
  if (!text) return ''

  return `[${role}] ${text.length > maxChars ? text.slice(-maxChars) : text}`
}

export function formatResumeContextEntry(entry: AgentLogEntry, t: Dictionary): string {
  const role = logRoleLabel(entry.kind, t)
  const sanitized = sanitizeAgentLogTextForContext(entry.text, t)
  if (sanitized == null) return ''
  const text = sanitized.trim()
  if (!text) return ''

  return `[${role}] ${text.slice(-1800)}`
}

export function addUniqueSkillRef(
  skillRefs: AgentSkillOption[],
  skill: AgentSkillOption
): AgentSkillOption[] {
  if (skillRefs.some((current) => current.id === skill.id)) return skillRefs

  return [...skillRefs, skill]
}

export function addUniqueToolRef(
  toolRefs: AgentToolReference[],
  tool: AgentToolReference
): AgentToolReference[] {
  if (toolRefs.some((current) => current.id === tool.id)) return toolRefs

  return [...toolRefs, tool]
}

export function addUniqueWikiRef(
  wikiRefs: AgentWikiReference[],
  wiki: AgentWikiReference
): AgentWikiReference[] {
  if (wikiRefs.some((current) => current.id === wiki.id)) return wikiRefs

  return [...wikiRefs, wiki]
}

export function addUniquePathRef(
  pathRefs: AgentPathReference[],
  reference: AgentPathReference
): AgentPathReference[] {
  if (pathRefs.some((current) => current.id === reference.id)) return pathRefs

  return [...pathRefs, reference]
}

export function buildAgentInputWithReferences(
  input: string,
  skillRefs: AgentSkillOption[],
  pathRefs: AgentPathReference[],
  toolRefs: AgentToolReference[],
  wikiRefs: AgentWikiReference[],
  t: Dictionary
): string {
  const toolLines = toolRefs.flatMap((tool) => [
    `- ${t.input.slashToolUseLabel}: ${tool.name}`,
    tool.description ? `  ${t.input.slashToolDescriptionLabel}: ${tool.description}` : '',
    `  ${t.input.slashToolRequirement}`
  ])

  const skillLines = skillRefs.flatMap((skill) => [
    `- ${t.input.slashSkillUseLabel}: ${skill.name}`,
    `  ${t.input.slashSkillPathLabel}: ${skill.path}`,
    skill.description ? `  ${t.input.slashSkillDescriptionLabel}: ${skill.description}` : '',
    `  ${t.input.slashSkillRequirement}`
  ])

  const pathLines = pathRefs.map((reference) => {
    const label =
      reference.kind === 'directory' ? t.input.referencedDirectory : t.input.referencedFile
    return `- ${label}: ${reference.path}`
  })
  // Wiki full text is injected via activeWikiIds → buildActiveSopGuidance; keep metadata only.
  const wikiLines = wikiRefs.flatMap((wiki) => [
    `- ${t.input.slashWikiUseLabel}: ${wiki.title}`,
    `  ${t.input.slashSkillPathLabel}: ${wiki.path}`
  ])

  const referenceSections = [
    ...(toolRefs.length > 0 ? [`${t.input.referencedTools}:`, ...toolLines.filter(Boolean)] : []),
    ...(skillRefs.length > 0
      ? [
          ...(toolRefs.length > 0 ? [''] : []),
          `${t.input.referencedSkills}:`,
          ...skillLines.filter(Boolean)
        ]
      : []),
    ...(pathRefs.length > 0
      ? [
          ...(toolRefs.length > 0 || skillRefs.length > 0 ? [''] : []),
          `${t.input.referencedPaths}:`,
          ...pathLines,
          t.input.pathReferenceRequirement
        ]
      : []),
    ...(wikiRefs.length > 0
      ? [
          ...(toolRefs.length > 0 || skillRefs.length > 0 || pathRefs.length > 0 ? [''] : []),
          `${t.input.referencedWikiDocuments}:`,
          ...wikiLines,
          t.input.slashWikiRequirement
        ]
      : [])
  ]

  if (referenceSections.length === 0) return input

  return [...referenceSections, '', `${t.input.slashSkillTaskLabel}:`, input].join('\n')
}

export function formatVisibleInputWithReferences(
  input: string,
  skillRefs: AgentSkillOption[],
  pathRefs: AgentPathReference[],
  toolRefs: AgentToolReference[],
  wikiRefs: AgentWikiReference[],
  t: Dictionary
): string {
  const visibleReferences = [
    toolRefs.length > 0
      ? `${t.input.referencedTools}: ${toolRefs.map((tool) => `\`${tool.name}\``).join(', ')}`
      : '',
    skillRefs.length > 0
      ? `${t.input.referencedSkills}: ${skillRefs.map((skill) => `\`${skill.name}\``).join(', ')}`
      : '',
    pathRefs.length > 0
      ? `${t.input.referencedPaths}: ${pathRefs
          .map((reference) => `\`${reference.name}\``)
          .join(', ')}`
      : '',
    wikiRefs.length > 0
      ? `${t.input.referencedWikiDocuments}: ${wikiRefs
          .map((wiki) => `\`${wiki.title}\``)
          .join(', ')}`
      : ''
  ].filter(Boolean)

  if (visibleReferences.length === 0) return input

  return `${visibleReferences.join('\n')}\n\n${input}`
}

export function buildPostLoginAgentInput(
  input: string,
  connection: ConnectionConfig,
  t: Dictionary
): string {
  return [
    t.terminal.postLoginAgentInstruction,
    `${t.terminal.connectionTarget}: ${connection.name} (${formatConnectionTarget(connection)})`,
    '',
    buildUserRequirementBreakdown(input, connection, t),
    '',
    t.terminal.postLoginOriginalTask,
    input
  ].join('\n')
}

export function buildCurrentTerminalAgentInput(
  input: string,
  terminalContext: { cwd: string; mode: string; output: string; shell: string },
  t: Dictionary
): string {
  return [
    t.terminal.currentTerminalInstruction,
    `${t.terminal.terminalMode}: ${terminalContext.mode}`,
    `${t.app.workingDirectory}: ${terminalContext.cwd || '-'}`,
    '',
    t.terminal.postLoginOriginalTask,
    input
  ].join('\n')
}

export function buildUserRequirementBreakdown(
  input: string,
  connection: ConnectionConfig,
  t: Dictionary
): string {
  const artifactDestination = extractArtifactDestination(input)
  const targetSystem = extractTargetSystem(input)
  const requestedActions = extractRequestedActions(input)
  const lines = [
    t.terminal.requirementBreakdown,
    `1. ${t.terminal.breakdownTargetConnection}: ${connection.name} (${formatConnectionTarget(connection)})`,
    `2. ${t.terminal.breakdownTargetSystem}: ${targetSystem || t.terminal.breakdownInferFromTask}`,
    `3. ${t.terminal.breakdownActions}: ${requestedActions.join(' -> ')}`,
    `4. ${t.terminal.breakdownArtifact}: ${
      artifactDestination
        ? `${t.terminal.breakdownArtifactDestination}: ${artifactDestination}`
        : t.terminal.breakdownNoExplicitArtifact
    }`,
    '',
    t.terminal.breakdownExecutionRules,
    `- ${t.terminal.breakdownRuleUseCurrentTerminal}`,
    `- ${t.terminal.breakdownRuleUseSubterminal}`,
    `- ${t.terminal.breakdownRulePreserveDestination}`,
    `- ${t.terminal.breakdownRuleNoFabrication}`
  ]

  return lines.join('\n')
}

export function extractTargetSystem(input: string): string {
  return input.match(/\b(?:for|on|in|against)\s+([A-Za-z0-9_.-]{2,})\b/i)?.[1] ?? ''
}

export function extractArtifactDestination(input: string): string {
  const pathMatch = input.match(
    /\b(?:save|write|output|export|store)\s+(?:to|into|at)\s+([~./$A-Za-z0-9_-][^\s,;]*)/i
  )
  if (pathMatch?.[1]) return normalizeArtifactDestination(pathMatch[1])

  const loosePathMatch = input.match(/((?:~|\/|\$HOME)[^\s,;]*)/)
  return loosePathMatch?.[1] ? normalizeArtifactDestination(loosePathMatch[1]) : ''
}

export function normalizeArtifactDestination(value: string): string {
  return value.replace(/\/+$/, '')
}

export function extractRequestedActions(input: string): string[] {
  const actions: string[] = []
  if (/\b(ssh|login|connect)\b/i.test(input) || /(?:登录|登陆|登入|连接)/.test(input)) {
    actions.push('login')
  }
  if (
    /\b(check|inspect|diagnose|troubleshoot|verify|list|get|status|health)\b/i.test(input) ||
    /(?:巡检|排查|检查|诊断|核实|健康检查)/.test(input)
  ) {
    actions.push('inspect')
  }
  if (
    /\b(create|add|configure|modify|update|fix|repair|deploy|install|run|execute)\b/i.test(input) ||
    /(?:创建|添加|配置|修改|修复|部署|安装|执行)/.test(input)
  ) {
    actions.push('operate')
  }
  if (
    /\b(summarize|report|document|record)\b/i.test(input) ||
    /(?:总结|汇总|报告|记录)/.test(input)
  ) {
    actions.push('summarize')
  }
  if (
    /\b(save|write|output|export|store)\b/i.test(input) ||
    /(?:保存|写入|导出|输出到)/.test(input)
  ) {
    actions.push('write-artifact')
  }

  return actions.length ? actions : ['complete-request']
}
