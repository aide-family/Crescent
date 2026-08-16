import { ArrowUpCircleIcon, CheckIcon, Loader2Icon } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import { agentStyleTitle } from '@renderer/lib/agent-style-ui'
import { normalizeAgentStyle, type AgentStyle } from '../../../shared/agent-style'
import { CRESCENT_GITHUB_URL, crescentReleaseTagUrl } from '../../../shared/app-links'
import type { AppUpdateStatusEvent } from '../../../shared/update-types'

function GitHubMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.7 7.7 0 0 1 8 4.7c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"
      />
    </svg>
  )
}

export function AppFooter({
  version,
  updateStatus,
  agentStyle,
  t,
  onDownloadUpdate
}: {
  version: string
  updateStatus: AppUpdateStatusEvent | { state: 'idle' }
  agentStyle: AgentStyle
  t: Dictionary
  onDownloadUpdate: () => void
}): React.JSX.Element {
  const style = normalizeAgentStyle(agentStyle)
  const styleLabel = agentStyleTitle(style, t)
  const updateAvailable = updateStatus.state === 'available'
  const downloading = updateStatus.state === 'downloading'
  const downloaded = updateStatus.state === 'downloaded' && Boolean(updateStatus.installerPath)
  const updateVersion =
    updateStatus.state === 'available' || updateStatus.state === 'downloaded'
      ? updateStatus.version
      : ''
  const percent =
    updateStatus.state === 'downloading'
      ? Math.max(0, Math.min(100, Math.round(updateStatus.percent))).toString()
      : '0'
  const showUpdate = updateAvailable || downloading || downloaded
  const updateLabel = downloading
    ? t.app.updateDownloading.replace('{percent}', percent)
    : downloaded
      ? t.app.updateSaved
      : t.app.updateAvailable.replace('{version}', updateVersion)
  const displayVersion = version || '…'
  const releaseLabel = t.app.openRelease.replace('{version}', displayVersion)

  return (
    <footer className="app-footer flex h-8 shrink-0 items-center justify-between gap-3 px-3 text-[11px] text-muted-foreground">
      <span className="app-footer-cluster">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="app-footer-action app-footer-version font-mono tabular-nums"
          aria-label={releaseLabel}
          title={releaseLabel}
          onClick={() => {
            void window.api.app.openExternal(crescentReleaseTagUrl(version))
          }}
        >
          v{displayVersion}
        </Button>
        {showUpdate ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="app-footer-action app-footer-update"
            disabled={downloading}
            aria-label={
              downloading
                ? updateLabel
                : downloaded
                  ? t.app.updateSaved
                  : t.app.downloadInstaller.replace('{version}', updateVersion)
            }
            title={updateLabel}
            onClick={onDownloadUpdate}
          >
            {downloading ? (
              <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
            ) : downloaded ? (
              <CheckIcon className="size-3" aria-hidden="true" />
            ) : (
              <ArrowUpCircleIcon className="size-3" aria-hidden="true" />
            )}
            <span className="font-mono tabular-nums">
              {downloading ? `${percent}%` : updateVersion}
            </span>
          </Button>
        ) : null}
        <span className="app-footer-sep" aria-hidden="true" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="app-footer-action"
          aria-label={t.app.github}
          title={t.app.github}
          onClick={() => {
            void window.api.app.openExternal(CRESCENT_GITHUB_URL)
          }}
        >
          <GitHubMark className="size-3.5" />
        </Button>
      </span>
      <span className="app-footer-mode shrink-0" title={t.settings.agentStyleHint}>
        {styleLabel}
      </span>
    </footer>
  )
}
