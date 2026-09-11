import './assets/main.css'

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { AppErrorBoundary } from '@renderer/components/AppErrorBoundary'
import { RendererCrashLoopPanel } from '@renderer/components/RendererCrashLoopPanel'
import App from './App'
import { dictionaries, type Locale } from './i18n'
import { parseWorkbenchLayout, type WorkbenchLayout } from '@renderer/lib/app-shell'

function resolveBootLocale(): Locale {
  try {
    const stored = localStorage.getItem('crescent.locale')
    if (stored === 'zh-CN' || stored === 'en') return stored
  } catch {
    // ignore
  }
  return 'zh-CN'
}

function installGlobalErrorReporting(): void {
  const report = (message: string): void => {
    try {
      window.api.app.reportDiagnosticError(message.slice(0, 2048))
    } catch {
      // ignore
    }
  }

  window.onerror = (message, source, lineno, colno, error) => {
    const text = [
      String(message),
      source ? `at ${source}:${lineno ?? 0}:${colno ?? 0}` : '',
      error?.stack ?? ''
    ]
      .filter(Boolean)
      .join('\n')
    report(text)
    return false
  }

  window.onunhandledrejection = (event) => {
    const reason = event.reason
    const text =
      reason instanceof Error
        ? `${reason.message}\n${reason.stack ?? ''}`
        : String(reason ?? 'unhandledrejection')
    report(text)
  }
}

installGlobalErrorReporting()

const locale = resolveBootLocale()
const t = dictionaries[locale]

function BootShell({
  dictionary
}: {
  dictionary: (typeof dictionaries)[Locale]
}): React.JSX.Element {
  const [boot, setBoot] = useState<{
    mode: 'none' | 'pending' | 'crash-loop'
    layout: WorkbenchLayout | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.api.app.getRendererRecoveryMode(),
      window.api.app.getWorkbenchLayout().catch(() => ({ layout: null }))
    ])
      .then(([recovery, layoutResult]) => {
        if (cancelled) return
        setBoot({
          mode: recovery.mode,
          layout: parseWorkbenchLayout(layoutResult.layout)
        })
      })
      .catch(() => {
        if (!cancelled) setBoot({ mode: 'none', layout: null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (boot == null) {
    return <div className="h-full bg-background" />
  }
  if (boot.mode === 'crash-loop') {
    return <RendererCrashLoopPanel t={dictionary} />
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <App
        recoveryMode={boot.mode === 'pending' ? 'pending' : 'none'}
        initialWorkbenchLayout={boot.layout}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary t={t}>
    <BootShell dictionary={t} />
  </AppErrorBoundary>
)
