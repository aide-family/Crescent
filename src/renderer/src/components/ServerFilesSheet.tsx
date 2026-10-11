import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  HomeIcon,
  Loader2Icon,
  AlertCircleIcon
} from 'lucide-react'

import { RemoteFileCodePreview } from '@renderer/components/RemoteFileCodePreview'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import type { Dictionary } from '@renderer/i18n'
import {
  canOpenFilePreview,
  formatPreviewGateMessage,
  type PreviewGateReason
} from '@renderer/lib/files/preview-gate'
import { cn } from '@renderer/lib/utils'
import type { ConnectionConfig } from '../../../shared/agent-types'
import type { RemoteFsEntry, RemoteFsReadResult } from '../../../shared/remote-fs-types'

export interface ServerFilesSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection: ConnectionConfig | null
  formatConnectionTarget: (connection: ConnectionConfig) => string
  t: Dictionary
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatMtime(mtime?: number): string {
  if (!mtime || mtime <= 0) return '—'
  const date = new Date(mtime * 1000)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function sortEntries(entries: RemoteFsEntry[]): RemoteFsEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.')
}

function isPermissionError(message: string): boolean {
  return (
    /permission denied/i.test(message) ||
    /\bcode=3\b/.test(message) ||
    /cannot access this path/i.test(message)
  )
}

function parentPath(path: string): string {
  if (path === '/' || !path) return '/'
  const trimmed = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path
  const index = trimmed.lastIndexOf('/')
  if (index <= 0) return '/'
  return trimmed.slice(0, index) || '/'
}

function breadcrumbParts(path: string): Array<{ label: string; path: string }> {
  if (path === '/') return [{ label: '/', path: '/' }]
  const parts = path.split('/').filter(Boolean)
  const crumbs: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }]
  let current = ''
  for (const part of parts) {
    current += `/${part}`
    crumbs.push({ label: part, path: current })
  }
  return crumbs
}

/** Inner browser body — remounted via key when connection changes. */
function ServerFilesBrowser({
  connection,
  formatConnectionTarget,
  t
}: {
  connection: ConnectionConfig
  formatConnectionTarget: (connection: ConnectionConfig) => string
  t: Dictionary
}): React.JSX.Element {
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<RemoteFsEntry[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [preview, setPreview] = useState<RemoteFsReadResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewBlockReason, setPreviewBlockReason] = useState<PreviewGateReason | null>(null)
  const [previewBlockSize, setPreviewBlockSize] = useState<number | undefined>()
  const [showAll, setShowAll] = useState(false)
  const [nameFilter, setNameFilter] = useState('')

  const connectionId = connection.id

  const loadList = useCallback(
    async (nextPath: string) => {
      setListLoading(true)
      setListError(null)
      try {
        const result = await window.api.remoteFs.list({ connectionId, path: nextPath })
        setEntries(result.entries)
        setPath(result.path)
      } catch (error) {
        // Keep breadcrumb on the attempted path so failed enters (e.g. /.ssh) are visible.
        setPath(nextPath)
        setEntries([])
        setListError(error instanceof Error ? error.message : String(error))
      } finally {
        setListLoading(false)
      }
    },
    [connectionId]
  )

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      void loadList('/')
    })
    return () => {
      cancelled = true
    }
  }, [loadList])

  const filteredEntries = useMemo(() => {
    const query = nameFilter.trim().toLowerCase()
    return sortEntries(
      entries.filter((entry) => {
        if (!showAll && isHiddenName(entry.name)) return false
        if (query && !entry.name.toLowerCase().includes(query)) return false
        return true
      })
    )
  }, [entries, nameFilter, showAll])

  async function openDirectory(nextPath: string): Promise<void> {
    setSelectedFile(null)
    setPreview(null)
    setPreviewError(null)
    setPreviewBlockReason(null)
    await loadList(nextPath)
  }

  async function tryOpenAsDirectory(
    nextPath: string,
    options?: { surfaceError?: boolean }
  ): Promise<boolean> {
    setListLoading(true)
    setListError(null)
    try {
      const result = await window.api.remoteFs.list({ connectionId, path: nextPath })
      setEntries(result.entries)
      setPath(result.path)
      setSelectedFile(null)
      setPreview(null)
      setPreviewError(null)
      setPreviewBlockReason(null)
      return true
    } catch (error) {
      if (options?.surfaceError) {
        setPath(nextPath)
        setEntries([])
        setListError(error instanceof Error ? error.message : String(error))
        setSelectedFile(null)
        setPreview(null)
        setPreviewError(null)
        setPreviewBlockReason(null)
      }
      return false
    } finally {
      setListLoading(false)
    }
  }

  function looksLikeDirectoryEntry(entry: RemoteFsEntry): boolean {
    if (entry.isDir || entry.type === 'dir') return true
    if (entry.type === 'link') return true
    // Hidden dirs often arrive with incomplete attrs (type=other).
    if (entry.type === 'other' && isHiddenName(entry.name)) return true
    return false
  }

  async function openEntry(entry: RemoteFsEntry): Promise<void> {
    if (entry.isDir || entry.type === 'dir') {
      await openDirectory(entry.path)
      return
    }

    // Symlinks / incomplete attrs (common for hidden dirs): try navigate first.
    if (entry.type === 'link' || entry.type === 'other') {
      const surfaceError = looksLikeDirectoryEntry(entry)
      const openedAsDir = await tryOpenAsDirectory(entry.path, { surfaceError })
      if (openedAsDir) return
      if (surfaceError) return
    }

    const gate = canOpenFilePreview(entry)
    if (!gate.ok) {
      setSelectedFile(entry.path)
      setPreview(null)
      setPreviewError(null)
      setPreviewBlockReason(gate.reason)
      setPreviewBlockSize(entry.size)
      return
    }

    setSelectedFile(entry.path)
    setPreviewBlockReason(null)
    setPreviewError(null)
    setPreview(null)
    setPreviewLoading(true)
    try {
      const result = await window.api.remoteFs.read({ connectionId, path: entry.path })
      setPreview(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Misclassified directory: fall back to listing.
      if (/directory/i.test(message)) {
        const openedAsDir = await tryOpenAsDirectory(entry.path, { surfaceError: true })
        if (openedAsDir) return
        return
      }
      setPreviewError(message)
    } finally {
      setPreviewLoading(false)
    }
  }

  const crumbs = breadcrumbParts(path)
  const target = formatConnectionTarget(connection)
  const description = t.serverFiles.description
    .replace('{name}', connection.name)
    .replace('{target}', target)

  return (
    <>
      <SheetHeader className="gap-1 pr-8 text-left">
        <SheetTitle>{t.serverFiles.title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          aria-label={t.serverFiles.home}
          title={t.serverFiles.home}
          onClick={() => void openDirectory('/')}
        >
          <HomeIcon aria-hidden="true" />
        </Button>
        <nav
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-xs"
          aria-label="Breadcrumb"
        >
          {crumbs.map((crumb, index) => (
            <span key={crumb.path} className="flex shrink-0 items-center gap-0.5">
              {index > 0 ? (
                <ChevronRightIcon className="size-3 text-muted-foreground" aria-hidden="true" />
              ) : null}
              <button
                type="button"
                className={cn(
                  'rounded-sm px-1 py-0.5 font-mono outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50',
                  crumb.path === path ? 'text-foreground' : 'text-muted-foreground'
                )}
                onClick={() => void openDirectory(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
        <Input
          value={nameFilter}
          onChange={(event) => setNameFilter(event.target.value)}
          placeholder={t.serverFiles.filterPlaceholder}
          className="h-7 w-40 text-xs"
          aria-label={t.serverFiles.filterPlaceholder}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
            className="size-3.5 accent-primary"
          />
          {t.serverFiles.showAll}
        </label>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <div className="flex w-[min(34%,280px)] shrink-0 flex-col gap-1 overflow-hidden border-r border-border/60 pr-2">
          {path !== '/' ? (
            <button
              type="button"
              className="app-list-row flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
              onClick={() => void openDirectory(parentPath(path))}
            >
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-mono">{t.serverFiles.parentDir}</span>
            </button>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {listLoading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                {t.serverFiles.loading}
              </div>
            ) : listError ? (
              <div className="flex items-start gap-2 px-2 py-3 text-xs text-destructive">
                <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span className="flex min-w-0 flex-col gap-1">
                  <span>
                    {t.serverFiles.loadFailed}: {listError}
                  </span>
                  {isPermissionError(listError) ? (
                    <span className="text-muted-foreground">{t.serverFiles.permissionHint}</span>
                  ) : null}
                </span>
              </div>
            ) : filteredEntries.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">{t.serverFiles.emptyDir}</p>
            ) : (
              filteredEntries.map((entry) => {
                const selected = selectedFile === entry.path
                const showAsDir = entry.isDir || entry.type === 'dir' || entry.type === 'link'
                return (
                  <button
                    key={entry.path}
                    type="button"
                    data-selected={selected ? 'true' : undefined}
                    className="app-list-row flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs"
                    title={entry.name}
                    onClick={() => void openEntry(entry)}
                  >
                    {showAsDir ? (
                      <FolderIcon
                        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : (
                      <FileIcon
                        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono">{entry.name}</span>
                      {!showAsDir ? (
                        <span className="block tabular-nums text-[10px] text-muted-foreground">
                          {formatSize(entry.size)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {previewBlockReason ? (
            <div className="flex flex-col gap-2 rounded-md border border-border/70 bg-muted/20 p-3 text-xs">
              <p className="font-medium">{t.serverFiles.previewBlockedTitle}</p>
              <p className="text-muted-foreground">
                {formatPreviewGateMessage(previewBlockReason, previewBlockSize, {
                  tooLarge: (mib, maxMib) =>
                    t.serverFiles.previewTooLarge
                      .replace('{mib}', String(mib))
                      .replace('{maxMib}', String(maxMib))
                })}
              </p>
            </div>
          ) : previewLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
              {t.serverFiles.previewLoading}
            </div>
          ) : previewError ? (
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="flex min-w-0 flex-col gap-1">
                <span>
                  {t.serverFiles.previewFailed}: {previewError}
                </span>
                {isPermissionError(previewError) ? (
                  <span className="text-muted-foreground">{t.serverFiles.permissionHint}</span>
                ) : null}
              </span>
            </div>
          ) : preview?.binary ? (
            <p className="text-xs text-muted-foreground">{t.serverFiles.previewBinary}</p>
          ) : preview?.content != null ? (
            <RemoteFileCodePreview
              key={preview.path}
              filePath={preview.path}
              content={preview.content}
              truncated={preview.truncated}
              truncatedLabel={t.serverFiles.previewTruncated}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
              <p className="text-xs text-muted-foreground">{t.serverFiles.selectHint}</p>
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-md border border-border/60">
                <table className="w-full table-fixed text-left text-xs">
                  <thead className="sticky top-0 bg-card/95 text-[10px] tracking-wide text-muted-foreground uppercase">
                    <tr>
                      <th className="w-[45%] px-2 py-1.5 font-medium">{t.serverFiles.colName}</th>
                      <th className="w-[18%] px-2 py-1.5 font-medium">{t.serverFiles.colMode}</th>
                      <th className="w-[12%] px-2 py-1.5 font-medium">{t.serverFiles.colSize}</th>
                      <th className="w-[25%] px-2 py-1.5 font-medium">{t.serverFiles.colMtime}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((entry) => (
                      <tr
                        key={entry.path}
                        className="cursor-pointer border-t border-border/40 hover:bg-muted/30"
                        onClick={() => void openEntry(entry)}
                      >
                        <td
                          className="break-all px-2 py-1 font-mono whitespace-normal"
                          title={entry.name}
                        >
                          {entry.name}
                        </td>
                        <td className="truncate px-2 py-1 font-mono whitespace-nowrap text-muted-foreground">
                          {entry.mode || '—'}
                        </td>
                        <td className="px-2 py-1 tabular-nums whitespace-nowrap text-muted-foreground">
                          {entry.isDir ? '—' : formatSize(entry.size)}
                        </td>
                        <td className="px-2 py-1 tabular-nums whitespace-nowrap text-muted-foreground">
                          {formatMtime(entry.mtime)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/** Read-only remote file browser sheet (YiduPilot-style master–detail). */
export function ServerFilesSheet({
  open,
  onOpenChange,
  connection,
  formatConnectionTarget,
  t
}: ServerFilesSheetProps): React.JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[min(96vw,1100px)]! max-w-[min(96vw,1100px)]! flex-col gap-3 p-4 sm:max-w-[min(96vw,1100px)]!"
      >
        {connection ? (
          <ServerFilesBrowser
            key={connection.id}
            connection={connection}
            formatConnectionTarget={formatConnectionTarget}
            t={t}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
