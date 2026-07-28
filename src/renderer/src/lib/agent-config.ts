import type {
  AgentModelOption,
  AgentProviderConfig,
  AgentProviderModelConfig,
  AgentValidationResult
} from '../../../shared/agent-types'
import { BUILT_IN_TOOL_CATALOG } from '../../../shared/agent-tool-catalog'
import type { AgentToolReference } from './terminal-tabs'

export function parseProviderModels(value: string): AgentProviderModelConfig[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((id) => ({
      id,
      name: id,
      reasoning: isReasoningModelId(id)
    }))
}

export function formatProviderModels(models: AgentProviderModelConfig[]): string {
  return models.map((model) => model.id).join('\n')
}

export function parseMcpArgs(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function formatMcpArgs(args: string[]): string {
  return args.join('\n')
}

export function parseMcpEnv(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf('=')
        if (separatorIndex < 0) return [line, ''] as const

        return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1)] as const
      })
      .filter(([key]) => Boolean(key))
  )
}

export function formatMcpEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

export function parseCommandWhitelist(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function flattenProviderModels(providers: AgentProviderConfig[]): AgentModelOption[] {
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      providerId: provider.id,
      providerName: provider.name || provider.id,
      reasoning: Boolean(model.reasoning)
    }))
  )
}

export function buildAvailableToolRefs(
  validation: AgentValidationResult | undefined
): AgentToolReference[] {
  const builtInToolNames = new Set(BUILT_IN_TOOL_CATALOG.map((tool) => tool.name))
  const builtInTools: AgentToolReference[] = BUILT_IN_TOOL_CATALOG.map((tool) => ({
    id: `built-in:${tool.name}`,
    name: tool.name,
    description: `${tool.method.toUpperCase()} ${tool.path} - ${tool.description}`,
    source: 'built-in'
  }))

  const dynamicTools =
    validation?.tools
      ?.filter((tool) => !builtInToolNames.has(tool.name))
      .map((tool) => ({
        id: tool.path.startsWith('mcp://') ? `mcp:${tool.name}` : `openapi:${tool.name}`,
        name: tool.name,
        description: `${tool.method.toUpperCase()} ${tool.path} - ${tool.description}`,
        source: tool.path.startsWith('mcp://') ? ('mcp' as const) : ('openapi' as const)
      })) ?? []

  const tools = new Map<string, AgentToolReference>()
  for (const tool of [...builtInTools, ...dynamicTools]) {
    tools.set(tool.id, tool)
  }

  return [...tools.values()]
}

function isReasoningModelId(id: string): boolean {
  const normalized = id.toLowerCase()
  return (
    normalized.includes('gpt-5') || normalized.includes('reasoner') || normalized.endsWith('-pro')
  )
}
