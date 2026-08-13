import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'

export function RendererCrashLoopPanel({ t }: { t: Dictionary }): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
      <h1 className="text-lg font-semibold text-pretty text-foreground">
        {t.recovery.crashLoopTitle}
      </h1>
      <p className="max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">
        {t.recovery.crashLoopBody}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={() => {
            void window.api.app.clearRendererRecovery().then(() => {
              window.location.reload()
            })
          }}
        >
          {t.recovery.retryStart}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void window.api.app.exportRendererDiagnostics()}
        >
          {t.recovery.exportDiagnostics}
        </Button>
      </div>
    </div>
  )
}
