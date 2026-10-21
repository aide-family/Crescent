import { APP_THEMES, type AppThemeId } from './theme-definitions'

function cardRule(selector: string, fill: string, stroke: string): string {
  return `${selector}{fill:${fill} !important;stroke:${stroke} !important;}`
}

/** Flowchart shape/cluster/edge rules embedded in the rendered SVG. */
/** Build a strict config at render time; no DOM or Electron dependency. */
export function buildMermaidRenderConfig(themeId: AppThemeId = 'crescent') {
  const theme = APP_THEMES[themeId]
  const palette = theme.diagram
  const diagram = {
    ...palette,
    clusterBorder: palette.kinds.ingress.border,
    service: palette.kinds.service.fill,
    serviceBorder: palette.kinds.service.border,
    data: palette.kinds.data.fill,
    dataBorder: palette.kinds.data.border,
    client: palette.kinds.client.fill,
    clientBorder: palette.kinds.client.border,
    decision: palette.kinds.decision.fill,
    decisionBorder: palette.kinds.decision.border
  }
  const chart = {
    surface: palette.cluster,
    surfaceRaised: palette.cluster,
    surfaceMuted: palette.canvas,
    borderSubtle: palette.kinds.client.glow,
    text: palette.text,
    line: palette.muted,
    note: palette.kinds.decision.fill,
    noteText: palette.text,
    noteBorder: palette.kinds.decision.border
  }
  const themeCSS = [
    '@keyframes app-mermaid-edge-flow{from{stroke-dashoffset:0}to{stroke-dashoffset:-32}}',
    `.node > rect.basic,.cluster > rect{rx:${theme.geometry.radius}px;ry:${theme.geometry.radius}px;}`,
    cardRule('.node > rect.basic', diagram.service, diagram.serviceBorder),
    cardRule('.node > path.basic', diagram.data, diagram.dataBorder),
    cardRule('.node > polygon', diagram.decision, diagram.decisionBorder),
    cardRule('.node > circle,.node > ellipse', diagram.client, diagram.clientBorder),
    cardRule('.cluster > rect', diagram.cluster, diagram.clusterBorder),
    '.edgePaths path{stroke-linecap:round;stroke-linejoin:round;}',
    '.edgePaths path.edge-pattern-solid{stroke-dasharray:6 10;animation:app-mermaid-edge-flow 1.6s linear infinite;}'
  ].join('')

  const themeVariables = {
    darkMode: true,
    background: diagram.canvas,
    mainBkg: diagram.service,
    secondBkg: chart.surfaceRaised,
    tertiaryColor: chart.surfaceMuted,
    primaryColor: diagram.service,
    primaryTextColor: diagram.text,
    primaryBorderColor: diagram.serviceBorder,
    secondaryColor: chart.surfaceRaised,
    secondaryTextColor: diagram.text,
    secondaryBorderColor: chart.borderSubtle,
    tertiaryTextColor: diagram.text,
    tertiaryBorderColor: chart.borderSubtle,
    lineColor: chart.line,
    arrowheadColor: chart.line,
    textColor: diagram.text,
    nodeTextColor: diagram.text,
    titleColor: diagram.text,
    edgeLabelBackground: diagram.cluster,
    clusterBkg: diagram.cluster,
    clusterBorder: diagram.clusterBorder,
    noteBkgColor: chart.note,
    noteTextColor: chart.noteText,
    noteBorderColor: chart.noteBorder,
    actorBkg: chart.surface,
    actorTextColor: chart.text,
    actorBorder: diagram.serviceBorder,
    signalColor: chart.text,
    signalTextColor: chart.text,
    labelTextColor: chart.text,
    loopTextColor: chart.text,
    activationBkgColor: chart.surfaceRaised,
    activationBorderColor: diagram.serviceBorder,
    sequenceNumberColor: theme.terminal.background
  } as const

  return {
    startOnLoad: false,
    securityLevel: 'strict' as const,
    htmlLabels: false,
    flowchart: {
      htmlLabels: false,
      curve: 'rounded' as const
    },
    theme: 'base' as const,
    themeVariables,
    themeCSS,
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
  }
}

export const MERMAID_RENDER_CONFIG = buildMermaidRenderConfig()
export const appMermaidThemeCss = MERMAID_RENDER_CONFIG.themeCSS
export const appMermaidThemeVariables = MERMAID_RENDER_CONFIG.themeVariables
