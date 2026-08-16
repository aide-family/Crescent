import { type KeyboardEvent, useState } from 'react'
import {
  BookOpenIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'

import { MarkdownContent } from '@renderer/components/MarkdownContent'
import {
  SkillInstallStatusDot,
  SkillManageStatus,
  StatusDot,
  type SkillInstallLogStatus,
  type SkillManageMessage
} from '@renderer/components/StatusIndicators'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import type { Dictionary } from '@renderer/i18n'
import {
  formatInstallCount,
  isSkillSearchResultInstalled,
  catalogSkillPageUrl
} from '@renderer/lib/skill-management'
import type { AgentSkillOption, AgentSkillSearchResult } from '../../../shared/agent-types'

type SkillManagerPane = 'installed' | 'discover'

export type SkillPreviewState = {
  skill: AgentSkillOption
  content: string
  catalogResultId?: string
}

const CARD_CLASS =
  'flex min-w-0 flex-col rounded-lg border bg-card/70 px-2.5 py-2 text-xs transition-[border-color,background-color] hover:bg-muted/25'
const CARD_SELECTED_CLASS = 'border-primary/50 bg-primary/8'
const CARD_IDLE_CLASS = 'border-border/70'

export interface SkillManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  t: Dictionary
  skillRoot: string
  skills: AgentSkillOption[]
  filteredLocalSkills: AgentSkillOption[]
  localSkillSearchQuery: string
  skillSearchQuery: string
  skillSearchResults: AgentSkillSearchResult[]
  skillSearchLoading: boolean
  skillDeletingPath: string | null
  copiedSkillCommandId: string | null
  skillManageMessage: SkillManageMessage | null
  selectedSkillPreview: SkillPreviewState | null
  skillPreviewLoadingPath: string | null
  copiedSkillInstallLogId: string | null
  skillInstallCancelingIds: Record<string, boolean>
  skillInstallIds: Record<string, string>
  skillInstallLogs: Record<string, string>
  skillInstallLogNames: Record<string, string>
  skillInstallLogStatuses: Record<string, SkillInstallLogStatus>
  skillInstallLogResultId: string | null
  installedSkillNames: Set<string>
  onSkillRootChange: (value: string) => void
  onSaveSkillRoot: () => void
  onLocalSkillSearchQueryChange: (value: string) => void
  onSkillSearchQueryChange: (value: string) => void
  onRefreshSkills: () => void
  onSearchSkills: () => void
  onInstallSkill: (result: AgentSkillSearchResult) => void
  onCancelSkillInstall: (resultId: string) => void
  onCopySkillInstallCommand: (result: AgentSkillSearchResult) => void
  onCopySelectedSkillInstallLog: () => void
  onDeleteSkill: (skill: AgentSkillOption) => void
  onPreviewSkill: (skill: AgentSkillOption) => void
  onPreviewCatalogSkill: (result: AgentSkillSearchResult) => void
  onDeleteSkillInstallLog: (resultId: string) => void
  onSelectedSkillPreviewChange: (value: SkillPreviewState | null) => void
  onSkillInstallLogResultIdChange: (resultId: string | null) => void
}

export function SkillManager({
  open,
  onOpenChange,
  t,
  skillRoot,
  skills,
  filteredLocalSkills,
  localSkillSearchQuery,
  skillSearchQuery,
  skillSearchResults,
  skillSearchLoading,
  skillDeletingPath,
  copiedSkillCommandId,
  skillManageMessage,
  selectedSkillPreview,
  skillPreviewLoadingPath,
  copiedSkillInstallLogId,
  skillInstallCancelingIds,
  skillInstallIds,
  skillInstallLogs,
  skillInstallLogNames,
  skillInstallLogStatuses,
  skillInstallLogResultId,
  installedSkillNames,
  onSkillRootChange,
  onSaveSkillRoot,
  onLocalSkillSearchQueryChange,
  onSkillSearchQueryChange,
  onRefreshSkills,
  onSearchSkills,
  onInstallSkill,
  onCancelSkillInstall,
  onCopySkillInstallCommand,
  onCopySelectedSkillInstallLog,
  onDeleteSkill,
  onPreviewSkill,
  onPreviewCatalogSkill,
  onDeleteSkillInstallLog,
  onSelectedSkillPreviewChange,
  onSkillInstallLogResultIdChange
}: SkillManagerProps): React.JSX.Element {
  const [pane, setPane] = useState<SkillManagerPane>('installed')
  const skillInstallLogResultIds = Object.keys(skillInstallLogs)
  const skillInstallLogCount = skillInstallLogResultIds.length
  const runningInstallCount = skillInstallLogResultIds.filter((id) => skillInstallIds[id]).length
  const selectedSkillInstallName = skillInstallLogResultId
    ? (skillInstallLogNames[skillInstallLogResultId] ?? skillInstallLogResultId)
    : ''
  const selectedSkillInstallRunning = Boolean(
    skillInstallLogResultId && skillInstallIds[skillInstallLogResultId]
  )
  const selectedSkillInstallStatus: SkillInstallLogStatus = selectedSkillInstallRunning
    ? 'running'
    : skillInstallLogResultId
      ? (skillInstallLogStatuses[skillInstallLogResultId] ?? 'success')
      : 'success'
  const selectedSkillInstallLog = skillInstallLogResultId
    ? (skillInstallLogs[skillInstallLogResultId] ?? '')
    : ''
  const logDetailOpen = Boolean(skillInstallLogResultId)
  const previewDetailOpen = Boolean(selectedSkillPreview) && !logDetailOpen
  const sidePanelOpen = logDetailOpen || previewDetailOpen
  const catalogPreviewResult = selectedSkillPreview?.catalogResultId
    ? skillSearchResults.find((result) => result.id === selectedSkillPreview.catalogResultId)
    : undefined
  const catalogPreviewLoading =
    Boolean(selectedSkillPreview?.catalogResultId) &&
    skillPreviewLoadingPath === selectedSkillPreview?.catalogResultId

  function togglePreview(skill: AgentSkillOption): void {
    if (selectedSkillPreview?.skill.path === skill.path && !skillInstallLogResultId) {
      onSelectedSkillPreviewChange(null)
      return
    }
    void onPreviewSkill(skill)
  }

  function toggleCatalogPreview(result: AgentSkillSearchResult): void {
    if (selectedSkillPreview?.catalogResultId === result.id && !skillInstallLogResultId) {
      onSelectedSkillPreviewChange(null)
      return
    }
    void onPreviewCatalogSkill(result)
  }

  function toggleInstallLogs(): void {
    if (skillInstallLogResultId) {
      onSkillInstallLogResultIdChange(null)
      return
    }
    onSkillInstallLogResultIdChange(skillInstallLogResultIds[0] ?? null)
  }

  function handleSheetKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      onSaveSkillRoot()
      return
    }
    if (
      pane === 'discover' &&
      (event.metaKey || event.ctrlKey) &&
      event.key === 'Enter' &&
      (event.target as HTMLElement | null)?.id === 'skill-catalog-search'
    ) {
      event.preventDefault()
      void onSearchSkills()
    }
  }

  function handlePaneKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setPane((current) => (current === 'installed' ? 'discover' : 'installed'))
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={`w-full overflow-hidden ${sidePanelOpen ? 'sm:max-w-5xl' : 'sm:max-w-2xl'}`}
        onKeyDown={handleSheetKeyDown}
      >
        <SheetHeader>
          <SheetTitle>{t.settings.skillsManagement}</SheetTitle>
          <SheetDescription>{t.settings.skillsManagementHint}</SheetDescription>
        </SheetHeader>
        <div className="app-sheet-split flex min-h-0 flex-1 flex-row-reverse gap-3 overflow-hidden px-4">
          <div className="app-sheet-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-2 pb-2">
              <div
                role="tablist"
                aria-label={t.settings.skillsManagement}
                className="inline-flex h-7 items-center rounded-md border border-border/70 bg-muted/20 p-0.5"
                onKeyDown={handlePaneKeyDown}
              >
                <PaneTab
                  selected={pane === 'installed'}
                  label={t.settings.localSkills}
                  count={filteredLocalSkills.length}
                  onSelect={() => setPane('installed')}
                />
                <PaneTab
                  selected={pane === 'discover'}
                  label={t.settings.skillsDiscover}
                  count={skillSearchResults.length || undefined}
                  onSelect={() => setPane('discover')}
                />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.settings.refreshSkills}
                  title={t.settings.refreshSkills}
                  onClick={onRefreshSkills}
                >
                  <RefreshCwIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant={logDetailOpen ? 'secondary' : 'outline'}
                  size="xs"
                  disabled={skillInstallLogCount === 0}
                  onClick={toggleInstallLogs}
                >
                  {runningInstallCount > 0 ? (
                    <StatusDot state="pending" title={t.settings.skillInstallingShort} />
                  ) : (
                    <FileTextIcon data-icon="inline-start" />
                  )}
                  {t.settings.skillInstallLogs}
                  {skillInstallLogCount > 0 ? (
                    <span className="tabular-nums text-muted-foreground">
                      {skillInstallLogCount}
                    </span>
                  ) : null}
                </Button>
              </div>
            </div>
            {pane === 'installed' ? (
              <>
                <Field className="shrink-0 gap-1.5 pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor="skill-root">{t.settings.skillDirectory}</FieldLabel>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => void onSaveSkillRoot()}
                    >
                      {t.settings.saveSkillDirectory}
                    </Button>
                  </div>
                  <Input
                    id="skill-root"
                    value={skillRoot}
                    onChange={(event) => onSkillRootChange(event.target.value)}
                    placeholder="~/.agents/skills"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <FieldDescription>{t.settings.skillDirectoryHint}</FieldDescription>
                </Field>
                <Input
                  type="search"
                  className="mb-2 shrink-0"
                  value={localSkillSearchQuery}
                  onChange={(event) => onLocalSkillSearchQueryChange(event.target.value)}
                  placeholder={t.settings.localSkillsSearchPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t.settings.localSkillsSearchPlaceholder}
                />
                <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                  {skills.length === 0 ? (
                    <EmptyState text={t.settings.noLocalSkills} />
                  ) : filteredLocalSkills.length === 0 ? (
                    <EmptyState text={t.settings.noMatchedLocalSkills} />
                  ) : (
                    <div
                      className={`grid grid-cols-1 gap-2 ${sidePanelOpen ? '' : 'sm:grid-cols-2'}`}
                    >
                      {filteredLocalSkills.map((skill) => {
                        const selected =
                          previewDetailOpen && selectedSkillPreview?.skill.path === skill.path
                        const loading = skillPreviewLoadingPath === skill.path

                        return (
                          <div
                            key={skill.path}
                            className={`${CARD_CLASS} ${selected ? CARD_SELECTED_CLASS : CARD_IDLE_CLASS}`}
                          >
                            <div className="flex min-w-0 items-start gap-1">
                              <button
                                type="button"
                                className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                                onClick={() => togglePreview(skill)}
                              >
                                <div className="flex min-w-0 items-start gap-2">
                                  <StatusDot
                                    state="ready"
                                    title={
                                      skill.removable === false
                                        ? t.settings.protectedSkill
                                        : t.settings.localSkills
                                    }
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-0.5">
                                      <span className="min-w-0 flex-1 wrap-break-word text-[13px] leading-snug font-medium">
                                        {skill.name}
                                      </span>
                                      {skill.removable === false && (
                                        <Badge
                                          variant="secondary"
                                          className="h-4 shrink-0 px-1.5 font-mono text-[10px]"
                                        >
                                          {t.settings.protectedSkill}
                                        </Badge>
                                      )}
                                      {loading && (
                                        <Loader2Icon
                                          className="size-3 shrink-0 animate-spin text-muted-foreground"
                                          aria-hidden="true"
                                        />
                                      )}
                                    </div>
                                    {skill.description ? (
                                      <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                                        {skill.description}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={!skill.removable || skillDeletingPath === skill.path}
                                aria-label={t.settings.deleteSkill}
                                title={t.settings.deleteSkill}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void onDeleteSkill(skill)
                                }}
                              >
                                {skillDeletingPath === skill.path ? (
                                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                                ) : (
                                  <Trash2Icon aria-hidden="true" />
                                )}
                              </Button>
                            </div>
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
                  <Input
                    id="skill-catalog-search"
                    type="search"
                    value={skillSearchQuery}
                    onChange={(event) => onSkillSearchQueryChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void onSearchSkills()
                      }
                    }}
                    placeholder={t.settings.skillsSearchPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={t.settings.skillsSearchPlaceholder}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void onSearchSkills()}
                    disabled={skillSearchLoading}
                  >
                    {skillSearchLoading ? (
                      <Loader2Icon className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <SearchIcon data-icon="inline-start" />
                    )}
                    {t.settings.searchSkills}
                  </Button>
                </div>
                <FieldDescription className="shrink-0 pb-2">
                  {t.settings.skillsSearchHint}
                </FieldDescription>
                <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                  <div className="space-y-2">
                    <SkillManageStatus message={skillManageMessage} />
                    {skillSearchResults.length > 0 ? (
                      <div
                        className={`grid grid-cols-1 gap-2 ${sidePanelOpen ? '' : 'sm:grid-cols-2'}`}
                      >
                        {skillSearchResults.map((result) => {
                          const installed = isSkillSearchResultInstalled(
                            result,
                            installedSkillNames
                          )
                          const installing = Boolean(skillInstallIds[result.id])
                          const selected =
                            (previewDetailOpen &&
                              selectedSkillPreview?.catalogResultId === result.id) ||
                            skillInstallLogResultId === result.id
                          const loading = skillPreviewLoadingPath === result.id

                          return (
                            <div
                              key={result.id}
                              className={`${CARD_CLASS} ${selected ? CARD_SELECTED_CLASS : CARD_IDLE_CLASS}`}
                            >
                              <div className="flex min-w-0 flex-col gap-1.5">
                                <button
                                  type="button"
                                  className="min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                                  onClick={() => toggleCatalogPreview(result)}
                                >
                                  <div className="flex min-w-0 items-start gap-2">
                                    {installing || installed ? (
                                      <StatusDot
                                        state={installing ? 'pending' : 'ready'}
                                        title={
                                          installing
                                            ? t.settings.skillInstallingShort
                                            : t.settings.skillInstalledStatus
                                        }
                                      />
                                    ) : null}
                                    <div className="min-w-0 flex-1">
                                      <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-0.5">
                                        <span className="min-w-0 flex-1 wrap-break-word text-[13px] leading-snug font-medium">
                                          {result.name}
                                        </span>
                                        {installed && (
                                          <Badge
                                            variant="secondary"
                                            className="h-4 shrink-0 px-1.5 text-[10px]"
                                          >
                                            {t.settings.skillInstalledStatus}
                                          </Badge>
                                        )}
                                        {loading && (
                                          <Loader2Icon
                                            className="size-3 shrink-0 animate-spin text-muted-foreground"
                                            aria-hidden="true"
                                          />
                                        )}
                                      </div>
                                      {result.description ? (
                                        <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                                          {result.description}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </button>
                                <div className="flex min-w-0 items-center justify-between gap-2">
                                  <div className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                                    {result.source}
                                    <span className="px-1">·</span>
                                    <span className="tabular-nums">
                                      {t.settings.skillInstalls}{' '}
                                      {formatInstallCount(result.installs)}
                                    </span>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-0.5">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={t.settings.copySkillInstallCommand}
                                      title={t.settings.copySkillInstallCommand}
                                      onClick={() => void onCopySkillInstallCommand(result)}
                                    >
                                      {copiedSkillCommandId === result.id ? (
                                        <CheckIcon aria-hidden="true" />
                                      ) : (
                                        <CopyIcon aria-hidden="true" />
                                      )}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant={installing ? 'outline' : 'default'}
                                      onClick={() => void onInstallSkill(result)}
                                    >
                                      {installing ? (
                                        <Loader2Icon
                                          className="animate-spin"
                                          data-icon="inline-start"
                                        />
                                      ) : (
                                        <DownloadIcon data-icon="inline-start" />
                                      )}
                                      {installing
                                        ? t.settings.skillInstallingShort
                                        : installed
                                          ? t.settings.updateSkill
                                          : t.settings.installSkill}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>
          {logDetailOpen ? (
            <div className="app-sheet-detail flex w-[560px] shrink-0 flex-col overflow-hidden rounded-md border bg-background">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <SkillInstallStatusDot status={selectedSkillInstallStatus} />
                    <span className="min-w-0 truncate">
                      {t.settings.skillInstallLog}: {selectedSkillInstallName}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {selectedSkillInstallRunning
                      ? t.settings.skillInstallRunningHint
                      : t.settings.skillInstallFinishedHint}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t.settings.copySkillInstallLog}
                    title={t.settings.copySkillInstallLog}
                    disabled={!selectedSkillInstallLog}
                    onClick={() => void onCopySelectedSkillInstallLog()}
                  >
                    {copiedSkillInstallLogId === skillInstallLogResultId ? (
                      <CheckIcon aria-hidden="true" />
                    ) : (
                      <CopyIcon aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t.settings.deleteSkillInstallLog}
                    title={t.settings.deleteSkillInstallLog}
                    onClick={() =>
                      skillInstallLogResultId && onDeleteSkillInstallLog(skillInstallLogResultId)
                    }
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t.common.close}
                    title={t.common.close}
                    onClick={() => onSkillInstallLogResultIdChange(null)}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {skillInstallLogCount > 1 ? (
                <div className="shrink-0 border-b px-3 py-2">
                  <Select
                    value={skillInstallLogResultId ?? undefined}
                    onValueChange={onSkillInstallLogResultIdChange}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {skillInstallLogResultIds.map((resultId) => {
                        const running = Boolean(skillInstallIds[resultId])
                        const status: SkillInstallLogStatus = running
                          ? 'running'
                          : (skillInstallLogStatuses[resultId] ?? 'success')
                        const label = skillInstallLogNames[resultId] ?? resultId

                        return (
                          <SelectItem key={resultId} value={resultId}>
                            {status === 'running'
                              ? `${label} · ${t.settings.skillInstallingShort}`
                              : status === 'error'
                                ? `${label} · ${t.settings.skillInstallFailed}`
                                : label}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <pre className="min-h-0 flex-1 select-text overflow-auto bg-[var(--app-markdown-canvas)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-[var(--app-markdown-text)]">
                {selectedSkillInstallLog || t.settings.skillInstallWaitingLog}
              </pre>
              {selectedSkillInstallRunning ? (
                <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(
                      skillInstallLogResultId && skillInstallCancelingIds[skillInstallLogResultId]
                    )}
                    onClick={() =>
                      skillInstallLogResultId && void onCancelSkillInstall(skillInstallLogResultId)
                    }
                  >
                    {skillInstallLogResultId &&
                      skillInstallCancelingIds[skillInstallLogResultId] && (
                        <Loader2Icon className="animate-spin" data-icon="inline-start" />
                      )}
                    {t.settings.cancelSkillInstall}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : previewDetailOpen && selectedSkillPreview ? (
            <div className="app-sheet-detail flex w-[560px] shrink-0 flex-col overflow-hidden rounded-md border bg-background">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 wrap-break-word">
                      {selectedSkillPreview.skill.name}
                    </span>
                    {selectedSkillPreview.skill.removable === false && (
                      <Badge variant="secondary" className="h-4 px-1.5 font-mono text-[10px]">
                        {t.settings.protectedSkill}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {catalogPreviewResult
                      ? catalogSkillPageUrl(catalogPreviewResult)
                      : selectedSkillPreview.skill.path}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.common.close}
                  title={t.common.close}
                  onClick={() => onSelectedSkillPreviewChange(null)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3 text-sm">
                {selectedSkillPreview.content && !catalogPreviewLoading ? (
                  <MarkdownContent value={selectedSkillPreview.content} t={t} />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden="true" />
                    {t.settings.skillPreviewLoading}
                  </div>
                )}
              </div>
              {catalogPreviewResult ? (
                <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={skillInstallIds[catalogPreviewResult.id] ? 'outline' : 'default'}
                    onClick={() => void onInstallSkill(catalogPreviewResult)}
                  >
                    {skillInstallIds[catalogPreviewResult.id] ? (
                      <Loader2Icon className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <DownloadIcon data-icon="inline-start" />
                    )}
                    {skillInstallIds[catalogPreviewResult.id]
                      ? t.settings.skillInstallingShort
                      : isSkillSearchResultInstalled(catalogPreviewResult, installedSkillNames)
                        ? t.settings.updateSkill
                        : t.settings.installSkill}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
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
  return (
    <div className="rounded-md border bg-muted/10 p-3 text-xs text-muted-foreground">{text}</div>
  )
}
