import type {
  AgentPathReference,
  AgentSkillOption,
  AgentWikiReference
} from '../../../shared/agent-types'
import type { AgentToolReference } from './terminal-tabs'

export interface AgentMessageReferences {
  skills: Array<{ id: string; name: string }>
  wiki: Array<{ id: string; title: string }>
  tools: Array<{ id: string; name: string; source: 'mcp' | 'built-in' | 'openapi' }>
  paths: Array<{ id: string; name: string; kind: 'file' | 'directory' }>
}

const SENTINEL_PREFIX = '<!--crescent-refs:'
const SENTINEL_PATTERN = /^<!--crescent-refs:(.+?)-->\n?/

export function hasMessageReferences(
  refs: AgentMessageReferences | undefined
): refs is AgentMessageReferences {
  if (!refs) return false
  return (
    refs.skills.length > 0 || refs.wiki.length > 0 || refs.tools.length > 0 || refs.paths.length > 0
  )
}

export function snapshotMessageReferences(input: {
  skillRefs?: AgentSkillOption[]
  wikiRefs?: AgentWikiReference[]
  toolRefs?: AgentToolReference[]
  pathRefs?: AgentPathReference[]
}): AgentMessageReferences | undefined {
  const refs: AgentMessageReferences = {
    skills: (input.skillRefs ?? []).map((skill) => ({ id: skill.id, name: skill.name })),
    wiki: (input.wikiRefs ?? []).map((wiki) => ({ id: wiki.id, title: wiki.title })),
    tools: (input.toolRefs ?? []).map((tool) => ({
      id: tool.id,
      name: tool.name,
      source: tool.source
    })),
    paths: (input.pathRefs ?? []).map((path) => ({
      id: path.id,
      name: path.name,
      kind: path.kind
    }))
  }
  return hasMessageReferences(refs) ? refs : undefined
}

export function encodeUserMessageText(
  text: string,
  references?: AgentMessageReferences
): string {
  if (!hasMessageReferences(references)) return text
  return `${SENTINEL_PREFIX}${JSON.stringify(references)}-->\n${text}`
}

export function decodeUserMessageText(text: string): {
  text: string
  references?: AgentMessageReferences
} {
  const match = SENTINEL_PATTERN.exec(text)
  if (!match?.[1]) return { text }
  try {
    const parsed = JSON.parse(match[1]) as AgentMessageReferences
    const references = normalizeDecodedReferences(parsed)
    return {
      text: text.slice(match[0].length),
      references: hasMessageReferences(references) ? references : undefined
    }
  } catch {
    return { text }
  }
}

function normalizeDecodedReferences(value: AgentMessageReferences): AgentMessageReferences {
  return {
    skills: Array.isArray(value.skills)
      ? value.skills.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
      : [],
    wiki: Array.isArray(value.wiki)
      ? value.wiki.filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string')
      : [],
    tools: Array.isArray(value.tools)
      ? value.tools.filter(
          (item) =>
            item &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            (item.source === 'mcp' || item.source === 'built-in' || item.source === 'openapi')
        )
      : [],
    paths: Array.isArray(value.paths)
      ? value.paths.filter(
          (item) =>
            item &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            (item.kind === 'file' || item.kind === 'directory')
        )
      : []
  }
}
