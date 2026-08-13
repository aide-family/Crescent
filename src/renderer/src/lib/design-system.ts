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

export const appMermaidThemeVariables = {
  darkMode: true,
  background: APP_UI_THEME.terminal.background,
  mainBkg: APP_UI_THEME.chart.surface,
  secondBkg: APP_UI_THEME.chart.surfaceRaised,
  tertiaryColor: APP_UI_THEME.chart.surfaceMuted,
  primaryColor: APP_UI_THEME.chart.surface,
  primaryTextColor: APP_UI_THEME.chart.text,
  primaryBorderColor: APP_UI_THEME.chart.borderAccent,
  secondaryColor: APP_UI_THEME.chart.surfaceRaised,
  secondaryTextColor: APP_UI_THEME.chart.text,
  secondaryBorderColor: APP_UI_THEME.chart.borderSubtle,
  tertiaryTextColor: APP_UI_THEME.chart.text,
  tertiaryBorderColor: 'rgba(203,213,225,0.16)',
  lineColor: APP_UI_THEME.chart.line,
  textColor: APP_UI_THEME.chart.text,
  edgeLabelBackground: APP_UI_THEME.chart.surface,
  clusterBkg: APP_UI_THEME.terminal.black,
  clusterBorder: 'rgba(19,194,194,0.22)',
  noteBkgColor: APP_UI_THEME.chart.note,
  noteTextColor: APP_UI_THEME.chart.noteText,
  noteBorderColor: APP_UI_THEME.chart.noteBorder,
  actorBkg: APP_UI_THEME.chart.surface,
  actorTextColor: APP_UI_THEME.chart.text,
  actorBorder: 'rgba(19,194,194,0.24)',
  signalColor: APP_UI_THEME.chart.text,
  signalTextColor: APP_UI_THEME.chart.text,
  labelTextColor: APP_UI_THEME.chart.text,
  loopTextColor: APP_UI_THEME.chart.text,
  activationBkgColor: APP_UI_THEME.chart.surfaceRaised,
  activationBorderColor: 'rgba(19,194,194,0.22)',
  sequenceNumberColor: APP_UI_THEME.terminal.background
} as const

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
