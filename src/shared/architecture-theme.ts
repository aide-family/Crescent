import type { ArchitectureKind } from './architecture-spec'
import { APP_THEMES, type AppThemeId } from './theme-definitions'
export type { KindTone as ArchitectureKindTone } from './theme-definitions'

export function getArchitectureTheme(themeId: AppThemeId = 'crescent') {
  return APP_THEMES[themeId].diagram
}

// Default aliases remain for documentation consumers, backed by the unified palette.
export const ARCHITECTURE_CANVAS = getArchitectureTheme().canvas
export const ARCHITECTURE_GRID = getArchitectureTheme().grid
export const ARCHITECTURE_TEXT = getArchitectureTheme().text
export const ARCHITECTURE_KIND_TONE = getArchitectureTheme().kinds
export const CHART_SERIES_COLORS = APP_THEMES.crescent.chart.series

export const ARCHITECTURE_KIND_ORDER: ArchitectureKind[] = [
  'client',
  'frontend',
  'ingress',
  'service',
  'data',
  'auth',
  'external',
  'queue'
]

export * from './architecture-geometry'
