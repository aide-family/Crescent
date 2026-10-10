import { buildMermaidRenderConfig } from '../../../shared/mermaid-theme'
import { APP_THEMES, type AppThemeId } from './theme-definitions'

export {
  MERMAID_RENDER_CONFIG,
  appMermaidThemeCss,
  appMermaidThemeVariables
} from '../../../shared/mermaid-theme'

type MermaidApi = typeof import('mermaid').default
let mermaidLoader: Promise<MermaidApi> | undefined
let renderQueue: Promise<unknown> = Promise.resolve()

/** Load once; initialize inside the serialized render so global config cannot race. */
export function loadMermaid(): Promise<MermaidApi> {
  return (mermaidLoader ??= import('mermaid').then((mod) => mod.default))
}

export function renderThemedMermaid(
  id: string,
  code: string,
  theme: AppThemeId,
  shouldRender: () => boolean = () => true
): Promise<string | null> {
  const task = renderQueue.then(async () => {
    const mermaid = await loadMermaid()
    if (!shouldRender()) return null
    mermaid.initialize(buildMermaidRenderConfig(theme))
    const rendered = (await mermaid.render(id, code)).svg
    // Embed the canvas so standalone SVG and PNG exports match the visible theme.
    const doc = new DOMParser().parseFromString(rendered, 'image/svg+xml')
    const svg = doc.documentElement
    const bounds = svg
      .getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number)
    if (svg.localName === 'svg' && bounds?.length === 4 && bounds.every(Number.isFinite)) {
      const canvas = doc.createElementNS('http://www.w3.org/2000/svg', 'rect')
      for (const [index, attribute] of ['x', 'y', 'width', 'height'].entries()) {
        canvas.setAttribute(attribute, String(bounds[index]))
      }
      canvas.setAttribute('fill', APP_THEMES[theme].diagram.canvas)
      canvas.setAttribute('aria-hidden', 'true')
      svg.insertBefore(canvas, svg.firstChild)
      return new XMLSerializer().serializeToString(svg)
    }
    return rendered
  })
  renderQueue = task.catch(() => undefined)
  return task
}
