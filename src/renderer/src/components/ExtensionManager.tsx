import { type KeyboardEvent, useState } from 'react'
import {
  DownloadIcon,
  FilePlusIcon,
  Loader2Icon,
  PuzzleIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'

import { MarkdownContent } from '@renderer/components/MarkdownContent'
import {
  SkillManageStatus,
  StatusDot,
  type SkillManageMessage
} from '@renderer/components/StatusIndicators'
import { Badge } from '@renderer/components/ui/badge'
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
  filterLocalExtensions,
  isPiPackageSearchResultInstalled
} from '@renderer/lib/extension-management'
import { formatInstallCount } from '@renderer/lib/skill-management'
import type { AgentExtensionOption, AgentPiPackageSearchResult } from '../../../shared/agent-types'

const CARD_CLASS = 'app-list-row flex min-w-0 flex-col text-xs'

type ExtensionManagerPane = 'installed' | 'discover'

export interface ExtensionManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  t: Dictionary
  extensions: AgentExtensionOption[]
  searchQuery: string
  catalogQuery: string
  catalogResults: AgentPiPackageSearchResult[]
  catalogLoading: boolean
  installingSource: string | null
  manageMessage: SkillManageMessage | null
  deletingPath: string | null
  preview: { extension: AgentExtensionOption; content: string } | null
  previewLoadingPath: string | null
  onSearchQueryChange: (value: string) => void
  onCatalogQueryChange: (value: string) => void
  onRefresh: () => void
  onImport: () => void
  onSearchCatalog: () => void
  onInstallPackage: (result: AgentPiPackageSearchResult) => void
  onDelete: (extension: AgentExtensionOption) => void
  onToggleEnabled: (extension: AgentExtensionOption, enabled: boolean) => void
  onPreview: (extension: AgentExtensionOption) => void
  onPreviewChange: (value: { extension: AgentExtensionOption; content: string } | null) => void
}

export function ExtensionManager({
  open,
  onOpenChange,
  t,
  extensions,
  searchQuery,
  catalogQuery,
  catalogResults,
  catalogLoading,
  installingSource,
  manageMessage,
  deletingPath,
  preview,
  previewLoadingPath,
  onSearchQueryChange,
  onCatalogQueryChange,
  onRefresh,
  onImport,
  onSearchCatalog,
  onInstallPackage,
  onDelete,
  onToggleEnabled,
  onPreview,
  onPreviewChange
}: ExtensionManagerProps): React.JSX.Element {
  const filtered = filterLocalExtensions(extensions, searchQuery)
  const previewOpen = Boolean(preview)
  const [pane, setPane] = useState<ExtensionManagerPane>('installed')
  const [confirmDelete, setConfirmDelete] = useState<AgentExtensionOption | null>(null)

  function handleSheetKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' && preview) {
      event.stopPropagation()
      onPreviewChange(null)
    }
  }

  function handlePaneKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setPane((current) => (current === 'installed' ? 'discover' : 'installed'))
    }
  }

  function selectDiscover(): void {
    setPane('discover')
    if (catalogResults.length === 0 && !catalogLoading) onSearchCatalog()
  }

  const previewFence = preview?.extension.kind === 'package' ? 'json' : 'ts'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={`w-full overflow-hidden ${previewOpen ? 'sm:max-w-5xl' : 'sm:max-w-2xl'}`}
        onKeyDown={handleSheetKeyDown}
      >
        <SheetHeader>
          <SheetTitle>{t.settings.extensionsManagement}</SheetTitle>
          <SheetDescription>{t.settings.extensionsManagementHint}</SheetDescription>
        </SheetHeader>
        <div className="app-sheet-split flex min-h-0 flex-1 flex-row gap-3 overflow-hidden px-4">
          <div className="app-sheet-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <p className="mb-2 shrink-0 rounded-md border border-border/70 border-l-2 border-l-primary bg-muted/20 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
              {t.settings.extensionsSecurityWarning}
            </p>
            <div className="flex shrink-0 items-center justify-between gap-2 pb-2">
              <div
                role="tablist"
                aria-label={t.settings.extensionsManagement}
                className="inline-flex h-7 items-center rounded-md border border-border/70 bg-muted/20 p-0.5"
                onKeyDown={handlePaneKeyDown}
              >
                <PaneTab
                  selected={pane === 'installed'}
                  label={t.settings.localExtensions}
                  count={filtered.length}
                  onSelect={() => setPane('installed')}
                />
                <PaneTab
                  selected={pane === 'discover'}
                  label={t.settings.extensionsDiscover}
                  count={catalogResults.length || undefined}
                  onSelect={selectDiscover}
                />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {pane === 'installed' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={onImport}
                    aria-label={t.settings.addExtension}
                  >
                    <FilePlusIcon data-icon="inline-start" />
                    {t.settings.addExtension}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.settings.refreshExtensions}
                  title={t.settings.refreshExtensions}
                  onClick={onRefresh}
                >
                  <RefreshCwIcon aria-hidden="true" />
                </Button>
              </div>
            </div>
            <SkillManageStatus message={manageMessage} />
            <p className="mb-2 shrink-0 text-[11px] text-muted-foreground">
              {t.settings.extensionTakesEffectHint}
            </p>
            {pane === 'installed' ? (
              <>
                <div className="app-search-field mb-2 shrink-0">
                  <SearchIcon aria-hidden="true" />
                  <Input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => onSearchQueryChange(event.target.value)}
                    placeholder={t.settings.extensionsSearchPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={t.settings.extensionsSearchPlaceholder}
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                  {extensions.length === 0 ? (
                    <EmptyState text={t.settings.noExtensions} />
                  ) : filtered.length === 0 ? (
                    <EmptyState text={t.settings.noMatchedExtensions} />
                  ) : (
                    <div
                      className={`grid grid-cols-1 gap-2 ${previewOpen ? '' : 'sm:grid-cols-2'}`}
                    >
                      {filtered.map((extension) => {
                        const selected = preview?.extension.path === extension.path
                        const loading = previewLoadingPath === extension.path
                        return (
                          <div
                            key={extension.path}
                            data-selected={selected ? 'true' : undefined}
                            className={CARD_CLASS}
                          >
                            <div className="flex min-w-0 items-start gap-1">
                              <button
                                type="button"
                                className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                                onClick={() => onPreview(extension)}
                              >
                                <div className="flex min-w-0 items-start gap-2">
                                  <StatusDot
                                    state={
                                      extension.loadError
                                        ? 'not-ready'
                                        : extension.enabled
                                          ? 'ready'
                                          : 'pending'
                                    }
                                    title={
                                      extension.loadError
                                        ? t.settings.extensionLoadError
                                        : extension.enabled
                                          ? t.settings.extensionEnabled
                                          : t.settings.extensionDisabled
                                    }
                                  />
                                  <div className="min-w-0">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                      <PuzzleIcon className="size-3 shrink-0 text-muted-foreground" />
                                      <span className="truncate font-medium">{extension.name}</span>
                                    </div>
                                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                      {extension.path}
                                    </p>
                                  </div>
                                </div>
                              </button>
                              <Button
                                type="button"
                                variant={extension.enabled ? 'outline' : 'secondary'}
                                size="xs"
                                aria-label={
                                  extension.enabled
                                    ? t.settings.extensionDisabled
                                    : t.settings.extensionEnabled
                                }
                                onClick={() => onToggleEnabled(extension, !extension.enabled)}
                              >
                                {extension.enabled
                                  ? t.settings.extensionDisabled
                                  : t.settings.extensionEnabled}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t.settings.deleteExtension}
                                disabled={deletingPath === extension.path}
                                onClick={() => setConfirmDelete(extension)}
                              >
                                <Trash2Icon aria-hidden="true" />
                              </Button>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {extension.kind === 'directory' ? (
                                <Badge variant="outline">{t.settings.extensionDirectory}</Badge>
                              ) : null}
                              {extension.kind === 'package' ? (
                                <Badge variant="outline">{t.settings.extensionPackage}</Badge>
                              ) : null}
                              {extension.tools.length ? (
                                <Badge variant="secondary">
                                  {t.settings.extensionTools}: {extension.tools.length}
                                </Badge>
                              ) : null}
                              {extension.commands.length ? (
                                <Badge variant="secondary">
                                  {t.settings.extensionCommands}: {extension.commands.length}
                                </Badge>
                              ) : null}
                              {loading ? (
                                <Badge variant="outline">
                                  {t.settings.extensionPreviewLoading}
                                </Badge>
                              ) : null}
                            </div>
                            {extension.loadError ? (
                              <p className="mt-1 text-[11px] text-destructive">
                                {extension.loadError}
                              </p>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex shrink-0 gap-2 pb-1.5">
                  <div className="app-search-field min-w-0 flex-1">
                    <SearchIcon aria-hidden="true" />
                    <Input
                      id="extension-catalog-search"
                      type="search"
                      value={catalogQuery}
                      onChange={(event) => onCatalogQueryChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        onSearchCatalog()
                      }}
                      placeholder={t.settings.extensionsCatalogSearchPlaceholder}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={t.settings.extensionsCatalogSearchPlaceholder}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onSearchCatalog}
                    disabled={catalogLoading}
                  >
                    {catalogLoading ? (
                      <Loader2Icon className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <SearchIcon data-icon="inline-start" />
                    )}
                    {t.settings.searchExtensions}
                  </Button>
                </div>
                <p className="mb-2 shrink-0 text-[11px] text-muted-foreground">
                  {t.settings.extensionsCatalogSearchHint}
                </p>
                <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                  {catalogLoading && catalogResults.length === 0 ? (
                    <EmptyState text={t.settings.extensionsSearching} />
                  ) : catalogResults.length === 0 ? (
                    <EmptyState text={t.settings.noExtensionCatalogResults} />
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {catalogResults.map((result) => {
                        const installed = isPiPackageSearchResultInstalled(result, extensions)
                        const installing = installingSource === result.source
                        return (
                          <div key={result.id} className={CARD_CLASS}>
                            <div className="flex min-w-0 items-start gap-2">
                              <PuzzleIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium">{result.name}</p>
                                {result.description ? (
                                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                                    {result.description}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {result.types.map((type) => (
                                <Badge key={type} variant="outline">
                                  {type}
                                </Badge>
                              ))}
                            </div>
                            <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
                              <p className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                                {result.source}
                                <span className="px-1">·</span>
                                <span className="tabular-nums">
                                  {formatInstallCount(result.downloads)}
                                </span>
                              </p>
                              <Button
                                type="button"
                                size="xs"
                                variant={installing ? 'outline' : 'default'}
                                disabled={installing}
                                onClick={() => onInstallPackage(result)}
                              >
                                {installing ? (
                                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                                ) : (
                                  <DownloadIcon data-icon="inline-start" />
                                )}
                                {installing
                                  ? t.settings.extensionInstalling
                                  : installed
                                    ? t.settings.updateExtension
                                    : t.settings.installExtension}
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {preview ? (
            <aside className="flex min-h-0 w-full max-w-md shrink-0 flex-col overflow-hidden border-l pl-3">
              <div className="flex shrink-0 items-center justify-between gap-2 pb-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{preview.extension.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {preview.extension.path}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.common.close}
                  onClick={() => onPreviewChange(null)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-md border bg-muted/10 p-2">
                <MarkdownContent
                  value={`\`\`\`${previewFence}\n${preview.content}\n\`\`\``}
                  t={t}
                />
              </div>
            </aside>
          ) : null}
        </div>
        {confirmDelete ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 p-4">
            <div
              role="dialog"
              aria-modal="true"
              className="w-full max-w-sm rounded-lg border bg-background p-3"
            >
              <p className="text-sm font-medium">{t.settings.deleteExtension}</p>
              <p className="mt-1 text-xs text-muted-foreground">{confirmDelete.name}</p>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setConfirmDelete(null)}
                >
                  {t.common.cancel}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="xs"
                  onClick={() => {
                    onDelete(confirmDelete)
                    setConfirmDelete(null)
                  }}
                >
                  {t.common.delete}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function PaneTab({
  selected,
  label,
  count,
  onSelect
}: {
  selected: boolean
  label: string
  count?: number
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`inline-flex h-6 items-center gap-1 rounded px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
        selected
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      onClick={onSelect}
    >
      {label}
      {typeof count === 'number' ? (
        <span className="tabular-nums text-muted-foreground">{count}</span>
      ) : null}
    </button>
  )
}

function EmptyState({ text }: { text: string }): React.JSX.Element {
  return <div className="app-empty-state">{text}</div>
}
