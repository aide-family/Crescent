import { ipcMain } from 'electron'

import {
  WORKBENCH_LAYOUT_DB_KEY,
  applyWorkbenchLayoutUpdate,
  parseWorkbenchLayout,
  type WorkbenchLayout
} from '../shared/workbench-layout'
import { readCrescentDbValue, writeCrescentDbValue } from './crescent-sqlite'

export function readStoredWorkbenchLayout(): WorkbenchLayout | null {
  return parseWorkbenchLayout(readCrescentDbValue(WORKBENCH_LAYOUT_DB_KEY))
}

export function registerWorkbenchLayoutIpc(): void {
  ipcMain.handle('app:get-workbench-layout', () => {
    return { layout: readStoredWorkbenchLayout() }
  })

  ipcMain.handle('app:set-workbench-layout', (_event, layout: unknown) => {
    const next = applyWorkbenchLayoutUpdate(layout)
    if (!next.ok) return next
    writeCrescentDbValue(WORKBENCH_LAYOUT_DB_KEY, next.layout)
    return next
  })
}
