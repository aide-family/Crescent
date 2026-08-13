import type { Dictionary } from '@renderer/i18n'
import { AGENT_STYLES, type AgentStyle } from '../../../shared/agent-style'

export function agentStyleTitle(style: AgentStyle, t: Dictionary): string {
  const titles: Record<AgentStyle, string> = {
    swift: t.settings.agentStyleSwift,
    concise: t.settings.agentStyleConcise,
    guided: t.settings.agentStyleGuided,
    teach: t.settings.agentStyleTeach
  }
  return titles[style]
}

export function agentStyleHint(style: AgentStyle, t: Dictionary): string {
  const hints: Record<AgentStyle, string> = {
    swift: t.settings.agentStyleSwiftHint,
    concise: t.settings.agentStyleConciseHint,
    guided: t.settings.agentStyleGuidedHint,
    teach: t.settings.agentStyleTeachHint
  }
  return hints[style]
}

export function agentStyleSelectOptions(t: Dictionary): Array<{
  id: AgentStyle
  title: string
  description: string
}> {
  return AGENT_STYLES.map((style) => ({
    id: style,
    title: agentStyleTitle(style, t),
    description: agentStyleHint(style, t)
  }))
}
