import type { AgentConfig, AgentOpenApiProfile, AgentPinnedWorkflow } from './agent-types'
import { normalizeToolNameList } from './tool-policy'

export const DEFAULT_OPENAPI_TIMEOUT_MS = 30_000
export const DEFAULT_OPENAPI_MAX_RETRIES = 2
export const DEFAULT_OPENAPI_RETRY_BACKOFF_MS = 300
const MAX_PROMPT_TEMPLATE_CHARS = 8_000
const MAX_PINNED_WORKFLOWS = 20
const MAX_WORKFLOW_PROMPT_CHARS = 4_000

export function createEmptyOpenApiProfile(id = `openapi-${Date.now()}`): AgentOpenApiProfile {
  return {
    id,
    name: 'OpenAPI',
    baseUrl: '',
    document: '',
    timeoutMs: DEFAULT_OPENAPI_TIMEOUT_MS,
    maxRetries: DEFAULT_OPENAPI_MAX_RETRIES,
    retryBackoffMs: DEFAULT_OPENAPI_RETRY_BACKOFF_MS
  }
}

export function normalizeOpenApiProfiles(config: Partial<AgentConfig>): {
  openApiProfiles: AgentOpenApiProfile[]
  openApiProfileId?: string
} {
  const profiles = Array.isArray(config.openApiProfiles)
    ? config.openApiProfiles.map(normalizeOpenApiProfile).filter((profile) => Boolean(profile.id))
    : []

  const deduped: AgentOpenApiProfile[] = []
  const seen = new Set<string>()
  for (const profile of profiles) {
    if (seen.has(profile.id)) continue
    seen.add(profile.id)
    deduped.push(profile)
  }

  const legacyProfile = buildLegacyOpenApiProfile(config)
  if (deduped.length === 0 && legacyProfile) {
    deduped.push(legacyProfile)
  }

  const requestedId = String(config.openApiProfileId ?? '').trim()
  const active = deduped.find((profile) => profile.id === requestedId) ?? deduped[0] ?? undefined

  return {
    openApiProfiles: deduped,
    openApiProfileId: active?.id
  }
}

export function resolveActiveOpenApiProfile(
  config: Pick<
    AgentConfig,
    | 'openApiProfiles'
    | 'openApiProfileId'
    | 'openApiBaseUrl'
    | 'openApiDocument'
    | 'openApiTimeoutMs'
    | 'openApiMaxRetries'
    | 'openApiRetryBackoffMs'
  >
): AgentOpenApiProfile | undefined {
  const { openApiProfiles, openApiProfileId } = normalizeOpenApiProfiles(config)
  const active = openApiProfiles.find((profile) => profile.id === openApiProfileId)
  if (active) return active

  if (
    config.openApiBaseUrl.trim() ||
    config.openApiDocument.trim() ||
    config.openApiTimeoutMs ||
    config.openApiMaxRetries ||
    config.openApiRetryBackoffMs
  ) {
    return {
      id: 'legacy-openapi',
      name: 'OpenAPI',
      baseUrl: config.openApiBaseUrl,
      document: config.openApiDocument,
      timeoutMs: config.openApiTimeoutMs,
      maxRetries: config.openApiMaxRetries,
      retryBackoffMs: config.openApiRetryBackoffMs
    }
  }

  return undefined
}

export function projectOpenApiProfileFields(
  profile: AgentOpenApiProfile | undefined
): Pick<
  AgentConfig,
  | 'openApiBaseUrl'
  | 'openApiDocument'
  | 'openApiTimeoutMs'
  | 'openApiMaxRetries'
  | 'openApiRetryBackoffMs'
> {
  return {
    openApiBaseUrl: profile?.baseUrl ?? '',
    openApiDocument: profile?.document ?? '',
    openApiTimeoutMs: profile?.timeoutMs ?? DEFAULT_OPENAPI_TIMEOUT_MS,
    openApiMaxRetries: profile?.maxRetries ?? DEFAULT_OPENAPI_MAX_RETRIES,
    openApiRetryBackoffMs: profile?.retryBackoffMs ?? DEFAULT_OPENAPI_RETRY_BACKOFF_MS
  }
}

export function withActiveOpenApiProfile(config: AgentConfig, profileId: string): AgentConfig {
  const profile = config.openApiProfiles.find((candidate) => candidate.id === profileId)
  if (!profile) return config

  return {
    ...config,
    openApiProfileId: profile.id,
    ...projectOpenApiProfileFields(profile)
  }
}

export function updateOpenApiProfileInConfig(
  config: AgentConfig,
  profileId: string,
  patch: Partial<AgentOpenApiProfile>
): AgentConfig {
  const profiles = config.openApiProfiles.map((profile) =>
    profile.id === profileId
      ? normalizeOpenApiProfile({ ...profile, ...patch, id: profileId })
      : profile
  )
  const next: AgentConfig = {
    ...config,
    openApiProfiles: profiles,
    openApiProfileId: config.openApiProfileId || profileId
  }

  if (next.openApiProfileId === profileId) {
    const active = profiles.find((profile) => profile.id === profileId)
    return {
      ...next,
      ...projectOpenApiProfileFields(active)
    }
  }

  return next
}

function normalizeOpenApiProfile(value: Partial<AgentOpenApiProfile>): AgentOpenApiProfile {
  const id = String(value.id ?? '').trim()
  const promptTemplate = String(value.promptTemplate ?? '')
    .trim()
    .slice(0, MAX_PROMPT_TEMPLATE_CHARS)
  const pinnedWorkflows = normalizePinnedWorkflows(value.pinnedWorkflows)
  const toolAllowList = normalizeToolNameList(value.toolAllowList)
  const toolDenyList = normalizeToolNameList(value.toolDenyList)

  return {
    id,
    name: String(value.name ?? '').trim() || id || 'OpenAPI',
    baseUrl: String(value.baseUrl ?? ''),
    document: String(value.document ?? ''),
    timeoutMs: clampNumber(value.timeoutMs, 1_000, 600_000, DEFAULT_OPENAPI_TIMEOUT_MS),
    maxRetries: clampNumber(value.maxRetries, 0, 5, DEFAULT_OPENAPI_MAX_RETRIES),
    retryBackoffMs: clampNumber(value.retryBackoffMs, 0, 10_000, DEFAULT_OPENAPI_RETRY_BACKOFF_MS),
    ...(promptTemplate ? { promptTemplate } : {}),
    ...(pinnedWorkflows.length ? { pinnedWorkflows } : {}),
    ...(toolAllowList.length ? { toolAllowList } : {}),
    ...(toolDenyList.length ? { toolDenyList } : {})
  }
}

function normalizePinnedWorkflows(value: unknown): AgentPinnedWorkflow[] {
  if (!Array.isArray(value)) return []

  const workflows: AgentPinnedWorkflow[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Partial<AgentPinnedWorkflow>
    const id = String(record.id ?? '').trim() || `workflow-${workflows.length + 1}`
    if (seen.has(id)) continue
    seen.add(id)
    const name = String(record.name ?? '').trim() || id
    const prompt = String(record.prompt ?? '')
      .trim()
      .slice(0, MAX_WORKFLOW_PROMPT_CHARS)
    if (!prompt) continue
    workflows.push({
      id,
      name,
      prompt,
      pinned: record.pinned !== false
    })
    if (workflows.length >= MAX_PINNED_WORKFLOWS) break
  }
  return workflows
}

/** One workflow per line: `Name | prompt text`. Lines without `|` use the whole line as prompt. */
export function formatPinnedWorkflowsText(workflows: AgentPinnedWorkflow[] | undefined): string {
  return (workflows ?? [])
    .filter((workflow) => workflow.pinned !== false)
    .map((workflow) => `${workflow.name} | ${workflow.prompt}`)
    .join('\n')
}

export function parsePinnedWorkflowsText(text: string): AgentPinnedWorkflow[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return normalizePinnedWorkflows(
    lines.map((line, index) => {
      const separator = line.indexOf('|')
      if (separator < 0) {
        return {
          id: `workflow-${index + 1}`,
          name: `Workflow ${index + 1}`,
          prompt: line
        }
      }

      return {
        id: `workflow-${index + 1}`,
        name: line.slice(0, separator).trim() || `Workflow ${index + 1}`,
        prompt: line.slice(separator + 1).trim()
      }
    })
  )
}

function buildLegacyOpenApiProfile(config: Partial<AgentConfig>): AgentOpenApiProfile | undefined {
  const baseUrl = String(config.openApiBaseUrl ?? '')
  const document = String(config.openApiDocument ?? '')
  if (!baseUrl.trim() && !document.trim()) return undefined

  return normalizeOpenApiProfile({
    id: 'legacy-openapi',
    name: 'OpenAPI',
    baseUrl,
    document,
    timeoutMs: config.openApiTimeoutMs,
    maxRetries: config.openApiMaxRetries,
    retryBackoffMs: config.openApiRetryBackoffMs
  })
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.round(numeric)))
}
