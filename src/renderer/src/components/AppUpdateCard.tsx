import { useEffect, useState } from 'react'
import { DownloadIcon, RefreshCwIcon, RocketIcon } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@renderer/components/ui/field'
import type { Dictionary } from '@renderer/i18n'
import type { AppUpdateStatusEvent } from '../../../shared/update-types'

interface AppUpdateCardProps {
  t: Dictionary
}

function formatUpdateStatus(
  t: Dictionary,
  status: AppUpdateStatusEvent | { state: 'idle' },
  appVersion: string
): string {
  switch (status.state) {
    case 'idle':
      return t.settings.updateStatusIdle
    case 'checking':
      return t.settings.updateStatusChecking
    case 'available':
      return t.settings.updateStatusAvailable.replace('{version}', status.version)
    case 'not-available':
      return t.settings.updateStatusNotAvailable.replace('{version}', status.version || appVersion)
    case 'downloading':
      return t.settings.updateStatusDownloading.replace(
        '{percent}',
        Math.max(0, Math.min(100, Math.round(status.percent))).toString()
      )
    case 'downloaded':
      return t.settings.updateStatusDownloaded.replace('{version}', status.version)
    case 'error':
      return t.settings.updateStatusError.replace('{message}', status.message)
    default:
      return t.settings.updateStatusIdle
  }
}

export function AppUpdateCard({ t }: AppUpdateCardProps): React.JSX.Element {
  const [appVersion, setAppVersion] = useState('')
  const [status, setStatus] = useState<AppUpdateStatusEvent | { state: 'idle' }>({ state: 'idle' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.update.getVersion().then((result) => {
      if (!cancelled) setAppVersion(result.version)
    })
    const unsubscribe = window.api.update.onStatus((event) => {
      setStatus(event)
      if (
        event.state === 'error' ||
        event.state === 'available' ||
        event.state === 'not-available'
      ) {
        setBusy(false)
      }
      if (event.state === 'downloaded') setBusy(false)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const canDownload = status.state === 'available'
  const canInstall = status.state === 'downloaded'

  return (
    <div className="space-y-2 rounded-md border bg-muted/10 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-medium">{t.settings.updateSection}</div>
          <FieldDescription>{t.settings.updateSectionHint}</FieldDescription>
        </div>
        <div className="shrink-0 rounded border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          v{appVersion || '…'}
        </div>
      </div>
      <Field className="gap-1">
        <FieldLabel className="text-[11px] text-muted-foreground">
          {t.settings.updateStatus}
        </FieldLabel>
        <div className="text-xs leading-snug text-foreground">
          {formatUpdateStatus(t, status, appVersion)}
        </div>
      </Field>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setStatus({ state: 'checking' })
            void window.api.update.check().then((result) => {
              if (!result.ok) {
                setBusy(false)
                setStatus({
                  state: 'error',
                  message: result.error || t.settings.updateCheckFailed
                })
              }
            })
          }}
        >
          <RefreshCwIcon data-icon="inline-start" />
          {t.settings.updateCheck}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || !canDownload}
          onClick={() => {
            setBusy(true)
            void window.api.update.download().then((result) => {
              if (!result.ok) {
                setBusy(false)
                setStatus({
                  state: 'error',
                  message: result.error || t.settings.updateDownloadFailed
                })
              }
            })
          }}
        >
          <DownloadIcon data-icon="inline-start" />
          {t.settings.updateDownload}
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={busy || !canInstall}
          onClick={() => {
            void window.api.update.install().then((result) => {
              if (!result.ok) {
                setStatus({
                  state: 'error',
                  message: result.error || t.settings.updateInstallFailed
                })
              }
            })
          }}
        >
          <RocketIcon data-icon="inline-start" />
          {t.settings.updateInstall}
        </Button>
      </div>
    </div>
  )
}
