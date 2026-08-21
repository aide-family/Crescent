import type { Dictionary } from '@renderer/i18n'
import { agentStyleHint, agentStyleTitle } from '@renderer/lib/agent-style-ui'
import { formatConnectionTarget } from '@renderer/lib/connections'
import type { AgentToolReference } from '@renderer/lib/terminal-tabs'
import { AGENT_STYLES } from '../../../shared/agent-style'
import type {
  AgentPathReference,
  AgentSkillOption,
  AgentStyle,
  AgentWikiReference,
  ConnectionConfig,
  WikiDocumentSummary
} from '../../../shared/agent-types'

export interface SlashCommandOption {
  id: string
  title: string
  description: string
  value: string
  keywords: string[]
  skill?: AgentSkillOption
  connection?: ConnectionConfig
  agentStyle?: AgentStyle
  pathReferenceKind?: AgentPathReference['kind']
  toolRef?: AgentToolReference
  wikiRef?: AgentWikiReference
  wikiDocument?: WikiDocumentSummary
  templateInput?: string
  extensionCommand?: { name: string }
}

/** Trailing `/token` at start of input or after whitespace (last line). */
const TRAILING_SLASH_COMMAND = /(?:^|\s)\/([^\s]*)\s*$/

export function getSlashCommandQuery(value: string, cursor = value.length): string | undefined {
  const clamped = Math.max(0, Math.min(cursor, value.length))
  const before = value.slice(0, clamped)
  const lastLine = before.includes('\n') ? (before.split('\n').pop() ?? '') : before
  const match = TRAILING_SLASH_COMMAND.exec(lastLine)
  if (!match) return undefined
  return match[1].toLowerCase()
}

export function matchesSlashCommand(
  command: SlashCommandOption,
  query: string | undefined
): boolean {
  if (query === undefined) return false
  if (!query) return true

  const searchable = [command.id, command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(query)
}

export function matchesSkillSlashCommand(command: SlashCommandOption, query: string): boolean {
  const skillQuery = query.slice('skill:'.length).trim()
  if (!skillQuery) return true

  const searchable = [command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(skillQuery)
}

export function isToolSlashQuery(query: string | undefined): boolean {
  if (query === undefined) return false
  return query.startsWith('tool:')
}

export function matchesToolSlashCommand(command: SlashCommandOption, query: string): boolean {
  const toolQuery = query
    .replace(/^tool:?/, '')
    .trim()
    .toLowerCase()
  if (!toolQuery) return true

  const searchable = [command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(toolQuery)
}

export function isMcpSlashQuery(query: string | undefined): boolean {
  if (query === undefined) return false
  return query.startsWith('mcp:')
}

export function matchesMcpSlashCommand(command: SlashCommandOption, query: string): boolean {
  const mcpQuery = query
    .replace(/^mcp:?/, '')
    .trim()
    .toLowerCase()
  if (!mcpQuery) return true

  const searchable = [command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(mcpQuery)
}

export function isWikiSlashQuery(query: string | undefined): boolean {
  if (query === undefined) return false
  return query.startsWith('wiki:')
}

export function matchesWikiSlashCommand(command: SlashCommandOption, query: string): boolean {
  const wikiQuery = query
    .replace(/^wiki:?/, '')
    .trim()
    .toLowerCase()
  if (!wikiQuery) return true

  const searchable = [command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(wikiQuery)
}

export function isStyleSlashQuery(query: string | undefined): boolean {
  if (query === undefined) return false
  return query.startsWith('style:')
}

export function matchesStyleSlashCommand(command: SlashCommandOption, query: string): boolean {
  const styleQuery = query
    .replace(/^style:?/, '')
    .trim()
    .toLowerCase()
  if (!styleQuery) return true

  const searchable = [command.id, command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(styleQuery)
}

export function isConnectionSlashQuery(query: string | undefined): boolean {
  if (query === undefined) return false
  return query.startsWith('connection:')
}

export function matchesConnectionSlashCommand(command: SlashCommandOption, query: string): boolean {
  const connectionQuery = query
    .replace(/^connection:?/, '')
    .trim()
    .toLowerCase()
  if (!connectionQuery) return true

  const searchable = [command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(connectionQuery)
}

export function replaceSlashCommandInput(
  value: string,
  replacement: string,
  cursor = value.length
): string {
  const clamped = Math.max(0, Math.min(cursor, value.length))
  const before = value.slice(0, clamped)
  const after = value.slice(clamped)
  const lastLineStart = before.lastIndexOf('\n') + 1
  const lastLine = before.slice(lastLineStart)
  const match = TRAILING_SLASH_COMMAND.exec(lastLine)
  const linePrefix = match ? lastLine.slice(0, match.index) : lastLine
  const prefix = `${before.slice(0, lastLineStart)}${linePrefix}`.replace(/[ \t]+$/, '')
  const next = replacement.trim()
  if (!next) return `${prefix}${after}`
  if (!prefix) {
    const body = next.startsWith('{{@') ? `${next} ` : next
    return `${body}${after}`
  }
  const joined = /\s$/.test(prefix) ? `${prefix}${next}` : `${prefix} ${next}`
  if (next.startsWith('/')) return `${joined}${after}`
  if (next.startsWith('{{@')) {
    const rest = after.replace(/^[ \t]+/, '')
    return `${joined}${rest ? (/^\s/.test(rest) ? rest : ` ${rest}`) : ' '}`
  }
  return `${prefix}\n${next}${after}`
}

export function buildSlashCommandOptions(t: Dictionary): SlashCommandOption[] {
  return [
    {
      id: 'new',
      title: t.input.slashNew,
      description: t.input.slashNewDescription,
      value: '/new',
      keywords: ['new', 'session', 'chat', 'conversation', '新建', '会话', '新会话']
    },
    {
      id: 'reload',
      title: t.input.slashReload,
      description: t.input.slashReloadDescription,
      value: '/reload',
      keywords: ['reload', 'refresh', 'config', '重载', '刷新', '配置']
    },
    {
      id: 'style',
      title: t.input.slashStyle,
      description: t.input.slashStyleDescription,
      value: '/style:',
      keywords: ['style', 'agent', 'swift', 'concise', 'guided', 'teach', 'brief', 'verbose']
    },
    {
      id: 'connection',
      title: t.input.slashConnection,
      description: t.input.slashConnectionDescription,
      value: '/connection:',
      keywords: ['connection', 'ssh', 'host']
    },
    {
      id: 'file',
      title: t.input.referenceFile,
      description: t.input.slashFileDescription,
      value: '',
      keywords: ['file', 'reference', 'context'],
      pathReferenceKind: 'file'
    },
    {
      id: 'folder',
      title: t.input.referenceDirectory,
      description: t.input.slashFolderDescription,
      value: '',
      keywords: ['folder', 'directory', 'reference', 'context'],
      pathReferenceKind: 'directory'
    },
    {
      id: 'tool',
      title: t.input.slashTool,
      description: t.input.slashToolDescription,
      value: '/tool:',
      keywords: ['tool', 'tools']
    },
    {
      id: 'mcp',
      title: t.input.slashMcp,
      description: t.input.slashMcpDescription,
      value: '/mcp:',
      keywords: ['mcp', 'tools', 'server']
    },
    {
      id: 'wiki',
      title: t.input.slashWiki,
      description: t.input.slashWikiDescription,
      value: '/wiki:',
      keywords: ['wiki', 'knowledge', 'sop', 'best practice']
    },
    {
      id: 'skill',
      title: t.input.slashSkill,
      description: t.input.slashSkillDescription,
      value: '/skill:',
      keywords: ['skill', 'skills']
    },
    {
      id: 'ext',
      title: t.input.slashExt,
      description: t.input.slashExtDescription,
      value: '/ext:',
      keywords: ['ext', 'extension', 'extensions', 'command', '扩展']
    },
    {
      id: 'create-skill',
      title: t.input.slashCreateSkill,
      description: t.input.slashCreateSkillDescription,
      value: '/create-skill',
      keywords: ['create-skill', 'skill', 'skills', 'custom', '转成skill']
    },
    {
      id: 'create-extension',
      title: t.input.slashCreateExtension,
      description: t.input.slashCreateExtensionDescription,
      value: '/create-extension',
      keywords: [
        'create-extension',
        'create-plugin',
        'extension',
        'extensions',
        'plugin',
        '自定义扩展',
        '创建插件'
      ]
    },
    {
      id: 'create-sop',
      title: t.input.slashSop,
      description: t.input.slashSopDescription,
      value: '/create-sop',
      keywords: ['create-sop', 'sop', 'wiki', 'knowledge', '知识库']
    }
  ]
}

export function isExtSlashQuery(query: string | undefined): boolean {
  if (query === undefined) return false
  return query.startsWith('ext:')
}

export function matchesExtSlashCommand(command: SlashCommandOption, query: string): boolean {
  const extQuery = query
    .replace(/^ext:?/, '')
    .trim()
    .toLowerCase()
  if (!extQuery) return true

  const searchable = [command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(extQuery)
}

export function buildExtSlashCommand(
  command: { name: string; description: string },
  t: Dictionary
): SlashCommandOption {
  return {
    id: `ext:${command.name}`,
    title: command.name,
    description: command.description || t.input.slashExtDescription,
    value: '',
    keywords: ['ext', 'extension', 'command', command.name, command.description],
    extensionCommand: { name: command.name }
  }
}

export function buildSkillSlashCommand(skill: AgentSkillOption, t: Dictionary): SlashCommandOption {
  return {
    id: `skill:${skill.name}`,
    title: skill.name,
    description: skill.description || t.input.slashSkillDescription,
    value: '',
    keywords: ['skill', 'skills', skill.name, skill.description, skill.source],
    skill
  }
}

export function buildToolSlashCommand(tool: AgentToolReference): SlashCommandOption {
  return {
    id: `tool:${tool.name}`,
    title: tool.name,
    description: tool.description,
    value: '',
    keywords: ['tool', 'tools', tool.name, tool.description, tool.source],
    toolRef: tool
  }
}

export function buildMcpSlashCommand(tool: AgentToolReference, t: Dictionary): SlashCommandOption {
  return {
    id: `mcp:${tool.name}`,
    title: tool.name,
    description: tool.description || t.input.slashMcpDescription,
    value: '',
    keywords: ['mcp', 'tool', 'tools', tool.name, tool.description, tool.source],
    toolRef: tool
  }
}

export function buildWikiSlashCommand(
  document: WikiDocumentSummary,
  t: Dictionary
): SlashCommandOption {
  return {
    id: `wiki:${document.id}`,
    title: document.title,
    description: document.excerpt || t.input.slashWikiDescription,
    value: '',
    keywords: ['wiki', 'knowledge', 'sop', document.title, document.excerpt, document.path],
    wikiDocument: document
  }
}

export function buildStyleSlashCommands(t: Dictionary): SlashCommandOption[] {
  return AGENT_STYLES.map((style) => ({
    id: `style:${style}`,
    title: agentStyleTitle(style, t),
    description: agentStyleHint(style, t),
    value: '',
    keywords: ['style', 'agent', style, agentStyleTitle(style, t), agentStyleHint(style, t)],
    agentStyle: style
  }))
}

export function buildConnectionSlashCommand(
  connection: ConnectionConfig,
  t: Dictionary
): SlashCommandOption {
  return {
    id: `connection:${connection.id}`,
    title: connection.name,
    description: formatConnectionTarget(connection),
    value: '',
    keywords: [
      'connection',
      'ssh',
      connection.name,
      connection.host,
      connection.user,
      connection.description,
      connection.source === 'local'
        ? t.connections.localTerminal
        : connection.source === 'ssh-config'
          ? '~/.ssh/config'
          : t.connections.customConnectionName
    ].filter((value): value is string => Boolean(value)),
    connection
  }
}
