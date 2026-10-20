/**
 * Pure session lifecycle policies for the hosted Pi agent session.
 * Extracted from pi-host.ts so the reuse/rebuild decisions are unit-testable
 * without dragging in the Electron-heavy session wiring.
 */

import { hostedMcpToolFingerprint } from '../../shared/mcp-servers'
import type { AgentConfig, AgentMcpServerConfig } from '../../shared/agent-types'

export const HOSTED_SESSION_TOOL_PROFILE = 'pty-targets-scoped-files-approval-v2'

export interface HostedSessionSnapshot {
  cwd: string
  toolProfile: string
  skillProfile: string
}

export function hostedSessionToolProfile(mcpServers: AgentMcpServerConfig[] = []): string {
  return `${HOSTED_SESSION_TOOL_PROFILE}:mcp:${hostedMcpToolFingerprint(mcpServers)}`
}

/** Fingerprint skill roots so checkbox / skillRoot changes recreate the session. */
export function hostedSessionSkillProfile(
  config: Pick<AgentConfig, 'skillRoot' | 'loadGlobalAgentSkills'>
): string {
  const skillRoot = config.skillRoot?.trim() || '~/.crescent/skills'
  const loadGlobal = Boolean(config.loadGlobalAgentSkills)
  return `skills:${skillRoot}:global:${loadGlobal ? '1' : '0'}`
}

/**
 * A hosted session is reused only when its tool profile, skill profile, and
 * workspace cwd are unchanged; otherwise pi-host disposes and recreates it.
 */
export function shouldReuseHostedSession(
  existing: HostedSessionSnapshot | undefined,
  next: { cwd: string; toolProfile: string; skillProfile: string }
): boolean {
  return Boolean(
    existing &&
    existing.toolProfile === next.toolProfile &&
    existing.skillProfile === next.skillProfile &&
    existing.cwd === next.cwd
  )
}

/**
 * A model change is needed when the session has no model yet, or when the
 * resolved model differs by id or provider.
 */
export function needsModelChange(
  current: { id?: string; provider?: string } | undefined,
  next: { id: string; provider: string }
): boolean {
  if (!current) return true
  return current.id !== next.id || current.provider !== next.provider
}
