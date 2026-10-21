import { useSyncExternalStore } from 'react'
import { readAppTheme, subscribeAppTheme, type AppThemeId } from '@renderer/lib/app-theme'

export function useAppTheme(): AppThemeId {
  return useSyncExternalStore(subscribeAppTheme, readAppTheme, readAppTheme)
}

/** Keep CSS/xterm switching immediate; repaint expensive libraries after the first UI frame. */
function subscribeDiagramTheme(listener: () => void): () => void {
  let firstFrame = 0
  let repaintFrame = 0
  const stop = subscribeAppTheme(() => {
    cancelAnimationFrame(firstFrame)
    cancelAnimationFrame(repaintFrame)
    firstFrame = requestAnimationFrame(() => {
      repaintFrame = requestAnimationFrame(listener)
    })
  })
  return () => {
    stop()
    cancelAnimationFrame(firstFrame)
    cancelAnimationFrame(repaintFrame)
  }
}

export function useDiagramTheme(): AppThemeId {
  return useSyncExternalStore(subscribeDiagramTheme, readAppTheme, readAppTheme)
}
