/** Crescent-owned subagent profiles. Inspired by pi-subagents; not loaded from npm:pi-subagents. */

export const SUBAGENT_PROFILE_NAMES = [
  'scout',
  'researcher',
  'worker',
  'reviewer',
  'oracle',
  'delegate'
] as const

export type SubagentProfileName = (typeof SUBAGENT_PROFILE_NAMES)[number]

export type SubagentToolName = 'read' | 'bash' | 'edit' | 'write'

export interface SubagentProfile {
  name: SubagentProfileName
  label: string
  tools: SubagentToolName[]
  systemPrompt: string
}

const READ_BASH: SubagentToolName[] = ['read', 'bash']
const IMPLEMENT: SubagentToolName[] = ['read', 'bash', 'edit', 'write']

export const SUBAGENT_PROFILES: Record<SubagentProfileName, SubagentProfile> = {
  scout: {
    name: 'scout',
    label: 'Scout',
    tools: READ_BASH,
    systemPrompt: [
      'You are Crescent scout: fast local recon.',
      'Find relevant files, entry points, data flow, and risks.',
      'Do not edit files. Prefer read and read-only bash.',
      'Return a concise structured brief the parent agent can act on.'
    ].join(' ')
  },
  researcher: {
    name: 'researcher',
    label: 'Researcher',
    tools: READ_BASH,
    systemPrompt: [
      'You are Crescent researcher: gather facts from the workspace, docs, and command output.',
      'Cite sources (paths, commands). Do not edit files.',
      'Return a short research brief with findings and remaining unknowns.'
    ].join(' ')
  },
  worker: {
    name: 'worker',
    label: 'Worker',
    tools: IMPLEMENT,
    systemPrompt: [
      'You are Crescent worker: implement the delegated task.',
      'Edit and validate. Escalate unapproved decisions instead of guessing.',
      'Do not spawn further subagents. Return what changed and how you verified it.'
    ].join(' ')
  },
  reviewer: {
    name: 'reviewer',
    label: 'Reviewer',
    tools: READ_BASH,
    systemPrompt: [
      'You are Crescent reviewer: review against the task or plan.',
      'Check correctness, tests, edge cases, and unnecessary complexity.',
      'Do not implement large changes. Return findings first, then optional small-fix suggestions.'
    ].join(' ')
  },
  oracle: {
    name: 'oracle',
    label: 'Oracle',
    tools: READ_BASH,
    systemPrompt: [
      'You are Crescent oracle: a second opinion before acting.',
      'Challenge assumptions. Do not edit files.',
      'Return what might be missing, risks, and a recommended next step.'
    ].join(' ')
  },
  delegate: {
    name: 'delegate',
    label: 'Delegate',
    tools: IMPLEMENT,
    systemPrompt: [
      'You are a Crescent delegate: behave close to the parent session for a bounded task.',
      'Complete the task in this pane. Do not spawn further subagents.',
      'Return a concise result the parent can summarize.'
    ].join(' ')
  }
}

export function isSubagentProfileName(value: string): value is SubagentProfileName {
  return (SUBAGENT_PROFILE_NAMES as readonly string[]).includes(value)
}

const HOST_ONLY_TOOLS = new Set(['subagent', 'open_subterminal', 'create-skill', 'create-sop'])
const WRITER_TOOLS = new Set<SubagentToolName>(['edit', 'write'])

export function childProfileOmitsHostTools(profile: SubagentProfile): boolean {
  return profile.tools.every((tool) => !HOST_ONLY_TOOLS.has(tool))
}

/** True when the profile may mutate workspace files (must not run in parallel). */
export function profileHasWriters(profile: SubagentProfile): boolean {
  return profile.tools.some((tool) => WRITER_TOOLS.has(tool))
}

export function resolveSubagentProfile(name: string): SubagentProfile | undefined {
  const key = name.trim().toLowerCase()
  if (!isSubagentProfileName(key)) return undefined
  return SUBAGENT_PROFILES[key]
}
