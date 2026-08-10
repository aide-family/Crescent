import './assets/main.css'

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { AppErrorBoundary } from '@renderer/components/AppErrorBoundary'
import { RendererCrashLoopPanel } from '@renderer/components/RendererCrashLoopPanel'
import App from './App'
import { dictionaries, type Locale } from './i18n'

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

function BootShell({ dictionary }: { dictionary: (typeof dictionaries)[Locale] }): React.JSX.Element {
  const [mode, setMode] = useState<'loading' | 'none' | 'pending' | 'crash-loop'>('loading')

  useEffect(() => {
    let cancelled = false
    void window.api.app
      .getRendererRecoveryMode()
      .then((result) => {
        if (cancelled) return
        setMode(result.mode)
      })
      .catch(() => {
        if (!cancelled) setMode('none')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (mode === 'loading') {
    return <div className="min-h-screen bg-background" />
  }
  if (mode === 'crash-loop') {
    return <RendererCrashLoopPanel t={dictionary} />
  }
  return <App recoveryMode={mode === 'pending' ? 'pending' : 'none'} />
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary t={t}>
    <BootShell dictionary={t} />
  </AppErrorBoundary>
)
