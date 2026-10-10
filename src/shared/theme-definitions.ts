import type { ArchitectureKind } from './architecture-spec'

export const APP_THEME_IDS = ['crescent', 'night-shift', 'route-survey', 'ink-signal'] as const
export type AppThemeId = (typeof APP_THEME_IDS)[number]
export type DiagramKind = ArchitectureKind | 'decision'
export type KindTone = { fill: string; border: string; glow: string }
export interface CrescentThemeDefinition {
  id: AppThemeId
  meta: { accent: string }
  geometry: { radius: number; radiusSmall: number }
  terminal: Record<(typeof terminalKeys)[number], string>
  chart: { series: readonly string[] }
  diagram: {
    canvas: string
    cluster: string
    grid: string
    text: string
    muted: string
    kinds: Record<DiagramKind, KindTone>
  }
}

const terminalKeys = [
  'background',
  'foreground',
  'cursor',
  'selectionBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
] as const
const kindKeys = [
  'client',
  'frontend',
  'ingress',
  'service',
  'data',
  'auth',
  'external',
  'queue',
  'decision'
] as const satisfies readonly DiagramKind[]

type Palette<Keys extends readonly string[]> = { [Index in keyof Keys]: string }

function defineTheme(
  id: AppThemeId,
  radius: number,
  radiusSmall: number,
  terminalColors: Palette<typeof terminalKeys>,
  canvas: string,
  cluster: string,
  muted: string,
  kindColors: Palette<typeof kindKeys>
): CrescentThemeDefinition {
  const terminal = Object.fromEntries(
    terminalKeys.map((key, i) => [key, terminalColors[i]!])
  ) as CrescentThemeDefinition['terminal']
  const kinds = Object.fromEntries(
    kindKeys.map((kind, i) => {
      const border = kindColors[i]!
      return [kind, { border, fill: `${border}1f`, glow: `${border}33` }]
    })
  ) as Record<DiagramKind, KindTone>
  return {
    id,
    meta: { accent: terminal.cursor },
    geometry: { radius, radiusSmall },
    terminal,
    chart: { series: kindColors.slice(0, 8) },
    diagram: {
      canvas,
      cluster,
      grid: `${terminal.cursor}12`,
      text: terminal.foreground,
      muted,
      kinds
    }
  }
}

export const APP_THEMES: Record<AppThemeId, CrescentThemeDefinition> = {
  crescent: defineTheme(
    'crescent',
    7,
    4,
    [
      '#070A0E',
      '#DCE7EE',
      '#13C2C2',
      'rgba(19,194,194,0.20)',
      '#080B0E',
      '#F87171',
      '#5FD6A5',
      '#F4C96B',
      '#37C8D0',
      '#C084FC',
      '#73E0E0',
      '#D8E2EA',
      '#56616D',
      '#FF7B7B',
      '#75E6B6',
      '#FFD97F',
      '#62E2E4',
      '#D8A6FF',
      '#A2F3F3',
      '#FFFFFF'
    ],
    '#090D12',
    '#141C25',
    '#8795A5',
    [
      '#94A3B8',
      '#37C8D0',
      '#F4C96B',
      '#5FD6A5',
      '#C084FC',
      '#F472B6',
      '#8291A3',
      '#D89A35',
      '#F4C96B'
    ]
  ),
  'night-shift': defineTheme(
    'night-shift',
    3,
    2,
    [
      '#050705',
      '#CDE4B5',
      '#B8E454',
      'rgba(184,228,84,0.17)',
      '#050705',
      '#DC6B64',
      '#98D95F',
      '#C9D77A',
      '#75A99A',
      '#A79AC8',
      '#93C7A1',
      '#CFDCC5',
      '#596653',
      '#EE8078',
      '#C9FF88',
      '#E4ED91',
      '#8BC0AF',
      '#BDB0D7',
      '#B4E4C0',
      '#EAF4E3'
    ],
    '#070A06',
    '#11180E',
    '#819077',
    [
      '#9DAF8F',
      '#B8E454',
      '#C9D77A',
      '#98D95F',
      '#A79AC8',
      '#D5A5AF',
      '#8C9B83',
      '#BCAB6A',
      '#E4ED91'
    ]
  ),
  'route-survey': defineTheme(
    'route-survey',
    6,
    3,
    [
      '#040B11',
      '#D7E8ED',
      '#38BDF8',
      'rgba(56,189,248,0.20)',
      '#050D13',
      '#F87171',
      '#34D399',
      '#E7C76A',
      '#38BDF8',
      '#A78BFA',
      '#22D3EE',
      '#D6E5EA',
      '#527080',
      '#FB8C8C',
      '#5DE6B2',
      '#F5D985',
      '#70D3FF',
      '#C1AAFF',
      '#67E8F9',
      '#F2FAFC'
    ],
    '#061018',
    '#0A1B27',
    '#7F9FAB',
    [
      '#94A3B8',
      '#38BDF8',
      '#F6B94C',
      '#22D3EE',
      '#A78BFA',
      '#F472B6',
      '#64748B',
      '#D89A35',
      '#E9C46A'
    ]
  ),
  'ink-signal': defineTheme(
    'ink-signal',
    2,
    1,
    [
      '#08090A',
      '#E0DEDB',
      '#FF5C56',
      'rgba(255,92,86,0.17)',
      '#090A0B',
      '#FF5C56',
      '#72C991',
      '#E6B450',
      '#77A8C9',
      '#C586C0',
      '#77C9BD',
      '#D8D6D2',
      '#626466',
      '#FF7770',
      '#89D8A7',
      '#F2C76B',
      '#91BDD8',
      '#D69BD0',
      '#91DBCF',
      '#F6F3EF'
    ],
    '#0C0D0E',
    '#181A1C',
    '#919395',
    [
      '#A4A7AA',
      '#77A8C9',
      '#E6B450',
      '#77C9BD',
      '#C586C0',
      '#FF7770',
      '#919395',
      '#CDA15C',
      '#F2C76B'
    ]
  )
}

export function getAppThemeDefinition(id: AppThemeId): CrescentThemeDefinition {
  return APP_THEMES[id]
}
export function getAppTerminalTheme(id: AppThemeId): CrescentThemeDefinition['terminal'] {
  return { ...APP_THEMES[id].terminal }
}
export function getChartSeriesColors(id: AppThemeId): readonly string[] {
  return APP_THEMES[id].chart.series
}
