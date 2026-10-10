import { rendererIpc } from './ipc-security'

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
  rendererIpc.handle('app:get-workbench-layout', () => {
    return { layout: readStoredWorkbenchLayout() }
  })

  rendererIpc.handle('app:set-workbench-layout', (_event, layout: unknown) => {
    const next = applyWorkbenchLayoutUpdate(layout)
    if (!next.ok) return next
    writeCrescentDbValue(WORKBENCH_LAYOUT_DB_KEY, next.layout)
    return next
  })
}
