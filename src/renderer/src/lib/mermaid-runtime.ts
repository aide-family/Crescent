import {
  MERMAID_RENDER_CONFIG,
  appMermaidThemeCss,
  appMermaidThemeVariables
} from '../../../shared/mermaid-theme'

export { MERMAID_RENDER_CONFIG, appMermaidThemeCss, appMermaidThemeVariables }

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
