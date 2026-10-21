import { appClient } from '@renderer/clients'
import {
  CLOSE_TERMINAL_CONFIRM_STORAGE_KEY,
  WORKBENCH_LAYOUT_STORAGE_KEY,
  isWorkbenchLayout,
  persistWorkbenchLayout,
  resolveInitialPaneOrder,
  resolveInitialWorkbenchLayout,
  type PaneOrder,
  type WorkbenchLayout
} from '@renderer/lib/app-shell'
import { useCallback, useEffect, useState } from 'react'

interface Parameters {
  initialWorkbenchLayout?: WorkbenchLayout | null
}

export function useWorkbenchLayout({ initialWorkbenchLayout }: Parameters) {
  const [terminalPanePercent, setTerminalPanePercent] = useState(65)

  const [subterminalPanelHeight, setSubterminalPanelHeight] = useState(256)

  const [subterminalCollapsed, setSubterminalCollapsed] = useState(false)

  const [workbenchLayout, setWorkbenchLayout] = useState<WorkbenchLayout>(() =>
    resolveInitialWorkbenchLayout(initialWorkbenchLayout)
  )

  const persistAndSetWorkbenchLayout = useCallback((layout: WorkbenchLayout) => {
    persistWorkbenchLayout(layout)
    void appClient.setWorkbenchLayout(layout)
    setWorkbenchLayout(layout)
  }, [])

  const [paneOrder, setPaneOrder] = useState<PaneOrder>(() => resolveInitialPaneOrder())

  const [closeTerminalConfirmEnabled, setCloseTerminalConfirmEnabled] = useState(
    () => localStorage.getItem(CLOSE_TERMINAL_CONFIRM_STORAGE_KEY) !== 'false'
  )

  useEffect(() => {
    if (isWorkbenchLayout(initialWorkbenchLayout)) {
      persistWorkbenchLayout(initialWorkbenchLayout)
      return
    }
    const cached = localStorage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY)
    if (isWorkbenchLayout(cached)) {
      void appClient.setWorkbenchLayout(cached)
    }
  }, [initialWorkbenchLayout])

  useEffect(() => {
    localStorage.setItem(
      CLOSE_TERMINAL_CONFIRM_STORAGE_KEY,
      closeTerminalConfirmEnabled ? 'true' : 'false'
    )
  }, [closeTerminalConfirmEnabled])
  return {
    terminalPanePercent,
    setTerminalPanePercent,
    subterminalPanelHeight,
    setSubterminalPanelHeight,
    subterminalCollapsed,
    setSubterminalCollapsed,
    workbenchLayout,
    setWorkbenchLayout,
    persistAndSetWorkbenchLayout,
    paneOrder,
    setPaneOrder,
    closeTerminalConfirmEnabled,
    setCloseTerminalConfirmEnabled
  }
}
