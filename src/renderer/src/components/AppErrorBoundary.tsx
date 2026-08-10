import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'

interface AppErrorBoundaryProps {
  t: Dictionary
  children: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
  message: string
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message ? String(error.message).slice(0, 500) : 'Unknown error'
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const payload = `${error.message}\n${info.componentStack ?? ''}`.slice(0, 2048)
    try {
      window.api.app.reportDiagnosticError(payload)
    } catch {
      // ignore reporting failures
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    const { t } = this.props
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <h1 className="text-lg font-semibold text-foreground">{t.recovery.errorBoundaryTitle}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{t.recovery.errorBoundaryBody}</p>
        {this.state.message ? (
          <pre className="max-h-40 max-w-lg overflow-auto rounded border bg-muted/30 p-3 text-left text-[11px] text-muted-foreground">
            {this.state.message}
          </pre>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={() => window.location.reload()}>
            {t.recovery.errorBoundaryReload}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void window.api.app.exportRendererDiagnostics()}
          >
            {t.recovery.exportDiagnostics}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => this.setState({ hasError: false, message: '' })}
          >
            {t.recovery.errorBoundaryContinue}
          </Button>
        </div>
      </div>
    )
  }
}
