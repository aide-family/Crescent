import { appMermaidThemeVariables } from '@renderer/lib/design-system'

export const MERMAID_RENDER_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  flowchart: {
    htmlLabels: false
  },
  theme: 'base',
  themeVariables: appMermaidThemeVariables,
  fontFamily: 'ui-sans-serif, system-ui, sans-serif'
} as const

type MermaidApi = typeof import('mermaid').default

let mermaidLoader: Promise<MermaidApi> | undefined

/** Load mermaid on first diagram render so the renderer entry stays under the chunk budget. */
export function loadMermaid(): Promise<MermaidApi> {
  mermaidLoader ??= import('mermaid').then((mod) => {
    const mermaid = mod.default
    mermaid.initialize(MERMAID_RENDER_CONFIG)
    return mermaid
  })
  return mermaidLoader
}
