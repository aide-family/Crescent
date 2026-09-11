export const WORKBENCH_LAYOUTS = ['split', 'chat', 'terminal'] as const
export type WorkbenchLayout = (typeof WORKBENCH_LAYOUTS)[number]

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayout = 'terminal'
export const WORKBENCH_LAYOUT_DB_KEY = 'workbench_layout'

export function isWorkbenchLayout(value: unknown): value is WorkbenchLayout {
  return value === 'split' || value === 'chat' || value === 'terminal'
}

export function parseWorkbenchLayout(value: unknown): WorkbenchLayout | null {
  return isWorkbenchLayout(value) ? value : null
}

export function applyWorkbenchLayoutUpdate(
  layout: unknown
): { ok: true; layout: WorkbenchLayout } | { ok: false; error: string } {
  if (!isWorkbenchLayout(layout)) {
    return { ok: false, error: 'Invalid workbench layout.' }
  }
  return { ok: true, layout }
}
