import type { Dictionary } from '@renderer/i18n'
import { formatConnectionTarget } from '@renderer/lib/connections'
import type { AgentToolReference } from '@renderer/lib/terminal-tabs'
import type {
  AgentConfig,
  AgentPathReference,
  AgentSkillOption,
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
  agentMode?: AgentConfig['agentMode']
  pathReferenceKind?: AgentPathReference['kind']
  toolRef?: AgentToolReference
  wikiRef?: AgentWikiReference
  wikiDocument?: WikiDocumentSummary
  templateInput?: string
}

export function getSlashCommandQuery(value: string): string | undefined {
  if (!value.startsWith('/') || value.includes('\n')) return undefined

  return value.slice(1).trim().toLowerCase()
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

export function isModeSlashQuery(query: string | undefined): boolean {
  if (query === undefined) return false
  return query.startsWith('mode:')
}

export function matchesModeSlashCommand(command: SlashCommandOption, query: string): boolean {
  const modeQuery = query
    .replace(/^mode:?/, '')
    .trim()
    .toLowerCase()
  if (!modeQuery) return true

  const searchable = [command.title, command.description, ...command.keywords]
    .join(' ')
    .toLowerCase()

  return searchable.includes(modeQuery)
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

export function replaceSlashCommandInput(value: string, replacement: string): string {
  if (!value.startsWith('/')) return `${replacement}\n${value}`.trim()

  return `${replacement}\n${value.replace(/^\/[^\n]*/, '').replace(/^\n/, '')}`.trim()
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
      id: 'mode',
      title: t.input.slashMode,
      description: t.input.slashModeDescription,
      value: '/mode:',
      keywords: ['mode', 'agent', 'react', 'plan']
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
      id: 'create-skill',
      title: t.input.slashCreateSkill,
      description: t.input.slashCreateSkillDescription,
      value: '/create-skill',
      keywords: ['create-skill', 'skill', 'skills', 'custom'],
      templateInput: t.input.createSkillPrompt
    }
  ]
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

export function buildModeSlashCommands(t: Dictionary): SlashCommandOption[] {
  return [
    {
      id: 'mode:react',
      title: 'ReAct',
      description: t.settings.planExecuteHint,
      value: '',
      keywords: ['mode', 'agent', 'react'],
      agentMode: 'react'
    },
    {
      id: 'mode:plan-execute',
      title: 'Plan-and-Execute',
      description: t.settings.planExecuteHint,
      value: '',
      keywords: ['mode', 'agent', 'plan', 'execute', 'plan-execute'],
      agentMode: 'plan-execute'
    }
  ]
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
