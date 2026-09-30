export const APP_ACCENT_COLOR = '#13c2c2'

export const APP_TERMINAL_TYPOGRAPHY = {
  fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, ui-monospace, monospace',
  fontSize: 13,
  lineHeight: 1.35,
  subterminalFontSize: 12,
  subterminalLineHeight: 1.3
} as const

export const APP_UI_THEME = {
  accent: APP_ACCENT_COLOR,
  terminal: {
    background: '#08090c',
    foreground: '#e8eef6',
    selection: '#23495f',
    rail: '#10141a',
    black: '#0b0d10',
    red: '#ff5f57',
    green: '#5af78e',
    yellow: '#f3f99d',
    blue: APP_ACCENT_COLOR,
    magenta: '#ff6ac1',
    cyan: '#9aedfe',
    white: '#f1f5f9',
    brightBlack: '#5c6773',
    brightRed: '#ff6b64',
    brightGreen: '#6fffa3',
    brightYellow: '#ffffa5',
    brightBlue: '#6ff4f4',
    brightMagenta: '#ff7acb',
    brightCyan: '#b6f4ff',
    brightWhite: '#ffffff'
  },
  chart: {
    surface: '#12161c',
    surfaceRaised: '#1c232d',
    surfaceMuted: '#151a21',
    borderAccent: 'rgba(19,194,194,0.28)',
    borderSubtle: 'rgba(203,213,225,0.18)',
    text: '#eef2f7',
    line: '#8fa7b8',
    note: '#302719',
    noteText: '#f0bd75',
    noteBorder: 'rgba(240,189,117,0.26)'
  },
  diagram: {
    canvas: '#0b0e14',
    cluster: '#12161f',
    clusterBorder: 'rgba(245,158,11,0.45)',
    text: '#eef2f7',
    muted: '#8b96a8',
    grid: 'rgba(148,163,184,0.07)',
    kinds: {
      client: { fill: 'rgba(148,163,184,0.12)', border: '#94a3b8', glow: 'rgba(148,163,184,0.28)' },
      frontend: { fill: 'rgba(56,189,248,0.12)', border: '#38bdf8', glow: 'rgba(56,189,248,0.32)' },
      ingress: { fill: 'rgba(245,158,11,0.12)', border: '#f59e0b', glow: 'rgba(245,158,11,0.32)' },
      service: { fill: 'rgba(52,211,153,0.12)', border: '#34d399', glow: 'rgba(52,211,153,0.32)' },
      data: { fill: 'rgba(167,139,250,0.12)', border: '#a78bfa', glow: 'rgba(167,139,250,0.32)' },
      auth: { fill: 'rgba(244,114,182,0.12)', border: '#f472b6', glow: 'rgba(244,114,182,0.32)' },
      external: {
        fill: 'rgba(148,163,184,0.10)',
        border: '#64748b',
        glow: 'rgba(100,116,139,0.28)'
      },
      queue: { fill: 'rgba(217,119,6,0.12)', border: '#d97706', glow: 'rgba(217,119,6,0.32)' },
      decision: {
        fill: 'rgba(240,189,117,0.12)',
        border: '#f0bd75',
        glow: 'rgba(240,189,117,0.28)'
      }
    },
    // Mermaid flowchart shape colors (not architecture :::class rules)
    service: 'rgba(52,211,153,0.18)',
    serviceBorder: '#34d399',
    data: 'rgba(167,139,250,0.18)',
    dataBorder: '#a78bfa',
    ingress: 'rgba(245,158,11,0.18)',
    ingressBorder: '#f59e0b',
    client: 'rgba(148,163,184,0.16)',
    clientBorder: '#94a3b8',
    external: 'rgba(100,116,139,0.16)',
    externalBorder: '#64748b',
    decision: 'rgba(240,189,117,0.16)',
    decisionBorder: '#f0bd75'
  }
} as const

export const appTerminalTheme = {
  background: APP_UI_THEME.terminal.background,
  foreground: APP_UI_THEME.terminal.foreground,
  cursor: APP_UI_THEME.accent,
  selectionBackground: APP_UI_THEME.terminal.selection,
  black: APP_UI_THEME.terminal.black,
  red: APP_UI_THEME.terminal.red,
  green: APP_UI_THEME.terminal.green,
  yellow: APP_UI_THEME.terminal.yellow,
  blue: APP_UI_THEME.terminal.blue,
  magenta: APP_UI_THEME.terminal.magenta,
  cyan: APP_UI_THEME.terminal.cyan,
  white: APP_UI_THEME.terminal.white,
  brightBlack: APP_UI_THEME.terminal.brightBlack,
  brightRed: APP_UI_THEME.terminal.brightRed,
  brightGreen: APP_UI_THEME.terminal.brightGreen,
  brightYellow: APP_UI_THEME.terminal.brightYellow,
  brightBlue: APP_UI_THEME.terminal.brightBlue,
  brightMagenta: APP_UI_THEME.terminal.brightMagenta,
  brightCyan: APP_UI_THEME.terminal.brightCyan,
  brightWhite: APP_UI_THEME.terminal.brightWhite
} as const

export { appMermaidThemeVariables } from '../../../shared/mermaid-theme'

export const appMarkdownTheme = {
  canvas: APP_UI_THEME.terminal.background,
  surface: APP_UI_THEME.chart.surface,
  surfaceRaised: APP_UI_THEME.chart.surfaceRaised,
  text: APP_UI_THEME.chart.text,
  muted: APP_UI_THEME.chart.line,
  border: APP_UI_THEME.chart.borderSubtle,
  accent: APP_ACCENT_COLOR,
  accentBorder: APP_UI_THEME.chart.borderAccent
} as const
