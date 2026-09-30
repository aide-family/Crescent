/** Shared Mermaid theme for app chat + VitePress docs (no React/Electron deps). */

const diagram = {
  canvas: '#0b0e14',
  cluster: '#12161f',
  clusterBorder: 'rgba(245,158,11,0.45)',
  text: '#eef2f7',
  service: 'rgba(52,211,153,0.18)',
  serviceBorder: '#34d399',
  data: 'rgba(167,139,250,0.18)',
  dataBorder: '#a78bfa',
  client: 'rgba(148,163,184,0.16)',
  clientBorder: '#94a3b8',
  decision: 'rgba(240,189,117,0.16)',
  decisionBorder: '#f0bd75'
} as const

const chart = {
  surface: '#12161c',
  surfaceRaised: '#1c232d',
  surfaceMuted: '#151a21',
  borderSubtle: 'rgba(203,213,225,0.18)',
  text: '#eef2f7',
  line: '#8fa7b8',
  note: '#302719',
  noteText: '#f0bd75',
  noteBorder: 'rgba(240,189,117,0.26)'
} as const

function cardRule(selector: string, fill: string, stroke: string): string {
  return `${selector}{fill:${fill} !important;stroke:${stroke} !important;}`
}

/** Flowchart shape/cluster/edge rules embedded in the rendered SVG. */
export const appMermaidThemeCss = [
  '@keyframes app-mermaid-edge-flow{from{stroke-dashoffset:0}to{stroke-dashoffset:-32}}',
  '.node > rect.basic,.cluster > rect{rx:10px;ry:10px;}',
  cardRule('.node > rect.basic', diagram.service, diagram.serviceBorder),
  cardRule('.node > path.basic', diagram.data, diagram.dataBorder),
  cardRule('.node > polygon', diagram.decision, diagram.decisionBorder),
  cardRule('.node > circle,.node > ellipse', diagram.client, diagram.clientBorder),
  cardRule('.cluster > rect', diagram.cluster, diagram.clusterBorder),
  '.edgePaths path{stroke-linecap:round;stroke-linejoin:round;}',
  '.edgePaths path.edge-pattern-solid{stroke-dasharray:6 10;animation:app-mermaid-edge-flow 1.6s linear infinite;}'
].join('')

export const appMermaidThemeVariables = {
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
  tertiaryBorderColor: 'rgba(203,213,225,0.16)',
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
  actorBorder: 'rgba(19,194,194,0.24)',
  signalColor: chart.text,
  signalTextColor: chart.text,
  labelTextColor: chart.text,
  loopTextColor: chart.text,
  activationBkgColor: chart.surfaceRaised,
  activationBorderColor: 'rgba(19,194,194,0.22)',
  sequenceNumberColor: '#08090c'
} as const

export const MERMAID_RENDER_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict' as const,
  htmlLabels: false,
  flowchart: {
    htmlLabels: false,
    curve: 'rounded' as const
  },
  theme: 'base' as const,
  themeVariables: appMermaidThemeVariables,
  themeCSS: appMermaidThemeCss,
  fontFamily: 'ui-sans-serif, system-ui, sans-serif'
}
