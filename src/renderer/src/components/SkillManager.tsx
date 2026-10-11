import { type CSSProperties, type KeyboardEvent, useState } from 'react'
import {
  BookOpenIcon,
  CheckIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
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
import { Textarea } from '@renderer/components/ui/textarea'
import type { Dictionary } from '@renderer/i18n'
import { SKILL_LIST_COLUMN_WIDTH, SKILL_SHEET_CHROME_WIDTH } from '@renderer/lib/app-runtime'
import {
  catalogSkillPageUrl,
  formatInstallCount,
  formatSkillFileAsMarkdownCode,
  isSkillMarkdownFile,
  isSkillSearchResultInstalled
} from '@renderer/lib/skill-management'
import { parseSkillMarkdown } from '@renderer/lib/skill-markdown'
import type {
  AgentSkillFileEntry,
  AgentSkillOption,
  AgentSkillSearchResult
} from '../../../shared/agent-types'

type SkillManagerPane = 'installed' | 'discover'

export type SkillPreviewState = {
  skill: AgentSkillOption
  content: string
  catalogResultId?: string
  files?: AgentSkillFileEntry[]
  selectedFilePath?: string
  selectedFileBinary?: boolean
  selectedFileTruncated?: boolean
  selectedFileError?: string
}

const CARD_CLASS = 'app-list-row flex min-w-0 flex-col text-xs'

export interface SkillManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  t: Dictionary
  skillRoot: string
  loadGlobalAgentSkills: boolean
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
  skillDetailWidth: number
  skillFileSaving: boolean
  onSkillRootChange: (value: string) => void
  onSaveSkillRoot: () => void
  onLoadGlobalAgentSkillsChange: (value: boolean) => void
  onLocalSkillSearchQueryChange: (value: string) => void
  onSkillSearchQueryChange: (value: string) => void
  onRefreshSkills: () => void
  onImportSkills: () => void
  onSearchSkills: () => void
  onInstallSkill: (result: AgentSkillSearchResult) => void
  onCancelSkillInstall: (resultId: string) => void
  onCopySkillInstallCommand: (result: AgentSkillSearchResult) => void
  onCopySelectedSkillInstallLog: () => void
  onDeleteSkill: (skill: AgentSkillOption) => void
  onPreviewSkill: (skill: AgentSkillOption) => void
  onPreviewCatalogSkill: (result: AgentSkillSearchResult) => void
  onSelectSkillPreviewFile: (relativePath: string) => void
  onSaveSkillFile: (
    skill: AgentSkillOption,
    relativePath: string,
    content: string
  ) => Promise<boolean>
  onDeleteSkillInstallLog: (resultId: string) => void
  onSelectedSkillPreviewChange: (value: SkillPreviewState | null) => void
  onSkillInstallLogResultIdChange: (resultId: string | null) => void
  onStartDetailResize: (startX: number, startWidth: number) => void
}

export function SkillManager({
  open,
  onOpenChange,
  t,
  skillRoot,
  loadGlobalAgentSkills,
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
  skillDetailWidth,
  skillFileSaving,
  onSkillRootChange,
  onSaveSkillRoot,
  onLoadGlobalAgentSkillsChange,
  onLocalSkillSearchQueryChange,
  onSkillSearchQueryChange,
  onRefreshSkills,
  onImportSkills,
  onSearchSkills,
  onInstallSkill,
  onCancelSkillInstall,
  onCopySkillInstallCommand,
  onCopySelectedSkillInstallLog,
  onDeleteSkill,
  onPreviewSkill,
  onPreviewCatalogSkill,
  onSelectSkillPreviewFile,
  onSaveSkillFile,
  onDeleteSkillInstallLog,
  onSelectedSkillPreviewChange,
  onSkillInstallLogResultIdChange,
  onStartDetailResize
}: SkillManagerProps): React.JSX.Element {
  const [pane, setPane] = useState<SkillManagerPane>('installed')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editPreviewing, setEditPreviewing] = useState(false)
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
  const previewMarkdown =
    selectedSkillPreview &&
    (!selectedSkillPreview.selectedFilePath ||
      selectedSkillPreview.selectedFilePath === 'SKILL.md' ||
      Boolean(selectedSkillPreview.catalogResultId))
      ? parseSkillMarkdown(selectedSkillPreview.content)
      : null
  const previewName = previewMarkdown?.name || selectedSkillPreview?.skill.name || ''
  const previewDescription =
    previewMarkdown?.description || selectedSkillPreview?.skill.description || ''
  const previewIsMarkdown = isSkillMarkdownFile(
    selectedSkillPreview?.catalogResultId ? 'SKILL.md' : selectedSkillPreview?.selectedFilePath
  )
  const previewMarkdownBody = previewMarkdown
    ? previewMarkdown.body
    : selectedSkillPreview?.content || ''
  const canEditSelectedFile =
    Boolean(selectedSkillPreview) &&
    !catalogPreviewResult &&
    Boolean(selectedSkillPreview?.skill.writable) &&
    !selectedSkillPreview?.selectedFileBinary &&
    !selectedSkillPreview?.selectedFileTruncated &&
    !selectedSkillPreview?.selectedFileError &&
    Boolean(selectedSkillPreview?.selectedFilePath || selectedSkillPreview?.content)
  const sheetWidthPx = sidePanelOpen
    ? SKILL_LIST_COLUMN_WIDTH + 12 + skillDetailWidth + SKILL_SHEET_CHROME_WIDTH
    : 672

  function resetEditState(): void {
    setEditing(false)
    setEditContent('')
    setEditPreviewing(false)
  }

  function confirmLeaveEdit(): boolean {
    if (!editing) return true
    if (editContent === (selectedSkillPreview?.content ?? '')) {
      resetEditState()
      return true
    }
    if (!window.confirm(t.settings.skillFileDiscardEdits)) return false
    resetEditState()
    return true
  }

  function togglePreview(skill: AgentSkillOption): void {
    if (!confirmLeaveEdit()) return
    if (selectedSkillPreview?.skill.path === skill.path && !skillInstallLogResultId) {
      onSelectedSkillPreviewChange(null)
      return
    }
    resetEditState()
    void onPreviewSkill(skill)
  }

  function toggleCatalogPreview(result: AgentSkillSearchResult): void {
    if (!confirmLeaveEdit()) return
    if (selectedSkillPreview?.catalogResultId === result.id && !skillInstallLogResultId) {
      onSelectedSkillPreviewChange(null)
      return
    }
    resetEditState()
    void onPreviewCatalogSkill(result)
  }

  function toggleInstallLogs(): void {
    if (!confirmLeaveEdit()) return
    resetEditState()
    if (skillInstallLogResultId) {
      onSkillInstallLogResultIdChange(null)
      return
    }
    onSkillInstallLogResultIdChange(skillInstallLogResultIds[0] ?? null)
  }

  function handleSelectPreviewFile(relativePath: string): void {
    if (!confirmLeaveEdit()) return
    resetEditState()
    onSelectSkillPreviewFile(relativePath)
  }

  function startEdit(): void {
    if (!canEditSelectedFile || !selectedSkillPreview) return
    setEditContent(selectedSkillPreview.content)
    setEditPreviewing(false)
    setEditing(true)
  }

  function cancelEdit(): void {
    resetEditState()
  }

  async function saveEdit(): Promise<void> {
    if (!selectedSkillPreview?.selectedFilePath) return
    const ok = await onSaveSkillFile(
      selectedSkillPreview.skill,
      selectedSkillPreview.selectedFilePath,
      editContent
    )
    if (ok) resetEditState()
  }

  function handleSheetKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (editing) {
        void saveEdit()
        return
      }
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
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !confirmLeaveEdit()) return
        onOpenChange(nextOpen)
      }}
    >
      <SheetContent
        className="w-[var(--skill-sheet-width)] overflow-hidden max-w-[calc(100vw-3rem)] sm:max-w-[calc(100vw-3rem)]"
        style={
          {
            '--skill-sheet-width': `${sheetWidthPx}px`,
            maxWidth: 'calc(100vw - 3rem)'
          } as CSSProperties
        }
        onKeyDown={handleSheetKeyDown}
      >
        <SheetHeader>
          <SheetTitle>{t.settings.skillsManagement}</SheetTitle>
          <SheetDescription>{t.settings.skillsManagementHint}</SheetDescription>
        </SheetHeader>
        <div className="app-sheet-split flex min-h-0 flex-1 flex-row gap-3 overflow-hidden px-4">
          <div
            className={
              sidePanelOpen
                ? 'app-sheet-main flex min-h-0 shrink-0 flex-col overflow-hidden'
                : 'app-sheet-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
            }
            style={sidePanelOpen ? { width: SKILL_LIST_COLUMN_WIDTH } : undefined}
          >
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
                {pane === 'installed' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={onImportSkills}
                    aria-label={t.settings.importSkill}
                  >
                    <FilePlusIcon data-icon="inline-start" />
                    {t.settings.importSkill}
                  </Button>
                ) : null}
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
                    placeholder="~/.crescent/skills"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <FieldDescription>{t.settings.skillDirectoryHint}</FieldDescription>
                  <label
                    htmlFor="load-global-agent-skills"
                    className="flex items-start gap-2 pt-1 text-xs text-muted-foreground"
                  >
                    <Input
                      id="load-global-agent-skills"
                      type="checkbox"
                      checked={loadGlobalAgentSkills}
                      onChange={(event) => onLoadGlobalAgentSkillsChange(event.target.checked)}
                      className="mt-0.5 size-3.5 shrink-0 accent-primary"
                    />
                    <span>
                      <span className="block text-foreground">
                        {t.settings.loadGlobalAgentSkills}
                      </span>
                      {t.settings.loadGlobalAgentSkillsHint}
                    </span>
                  </label>
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
                            data-selected={selected ? 'true' : undefined}
                            className={CARD_CLASS}
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
                                    {skill.relativePath?.includes('/') ? (
                                      <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                                        {skill.relativePath}
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
                              data-selected={selected ? 'true' : undefined}
                              className={CARD_CLASS}
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
            <div
              className="app-sheet-detail relative flex shrink-0 flex-col overflow-hidden rounded-md border bg-background"
              style={{ width: skillDetailWidth }}
            >
              <div
                className="absolute inset-y-0 right-0 z-10 hidden w-2 cursor-col-resize hover:bg-primary/40 sm:block"
                role="separator"
                aria-orientation="vertical"
                aria-label={t.settings.resizeSkillPreview}
                title={t.settings.resizeSkillPreview}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  onStartDetailResize(event.clientX, skillDetailWidth)
                  document.body.style.cursor = 'col-resize'
                  document.body.style.userSelect = 'none'
                }}
              />
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
            <div
              className="app-sheet-detail relative flex shrink-0 flex-col overflow-hidden rounded-md border bg-background"
              style={{ width: skillDetailWidth }}
            >
              <div
                className="absolute inset-y-0 right-0 z-10 hidden w-2 cursor-col-resize hover:bg-primary/40 sm:block"
                role="separator"
                aria-orientation="vertical"
                aria-label={t.settings.resizeSkillPreview}
                title={t.settings.resizeSkillPreview}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  onStartDetailResize(event.clientX, skillDetailWidth)
                  document.body.style.cursor = 'col-resize'
                  document.body.style.userSelect = 'none'
                }}
              />
              <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0 border-l-2 border-primary pl-2.5">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 wrap-break-word">{previewName}</span>
                    {selectedSkillPreview.skill.removable === false && (
                      <Badge variant="secondary" className="h-4 px-1.5 font-mono text-[10px]">
                        {t.settings.protectedSkill}
                      </Badge>
                    )}
                    {selectedSkillPreview.skill.writable === false && !catalogPreviewResult ? (
                      <Badge variant="outline" className="h-4 px-1.5 font-mono text-[10px]">
                        {t.settings.skillFileReadOnly}
                      </Badge>
                    ) : null}
                  </div>
                  {previewDescription ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {previewDescription}
                    </p>
                  ) : null}
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {catalogPreviewResult
                      ? catalogSkillPageUrl(catalogPreviewResult)
                      : (selectedSkillPreview.selectedFilePath ??
                        selectedSkillPreview.skill.relativePath ??
                        selectedSkillPreview.skill.path)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {canEditSelectedFile ? (
                    editing ? (
                      <>
                        {previewIsMarkdown ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={skillFileSaving}
                            aria-label={
                              editPreviewing ? t.settings.editSkillFile : t.settings.skillPreview
                            }
                            title={
                              editPreviewing ? t.settings.editSkillFile : t.settings.skillPreview
                            }
                            onClick={() => setEditPreviewing((current) => !current)}
                          >
                            {editPreviewing ? (
                              <Code2Icon aria-hidden="true" />
                            ) : (
                              <EyeIcon aria-hidden="true" />
                            )}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={skillFileSaving}
                          aria-label={t.settings.cancelSkillFileEdit}
                          title={t.settings.cancelSkillFileEdit}
                          onClick={cancelEdit}
                        >
                          <XIcon aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={skillFileSaving}
                          aria-label={t.settings.saveSkillFile}
                          title={t.settings.saveSkillFile}
                          onClick={() => void saveEdit()}
                        >
                          {skillFileSaving ? (
                            <Loader2Icon className="animate-spin" aria-hidden="true" />
                          ) : (
                            <SaveIcon aria-hidden="true" />
                          )}
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t.settings.editSkillFile}
                        title={t.settings.editSkillFile}
                        onClick={startEdit}
                      >
                        <PencilIcon aria-hidden="true" />
                      </Button>
                    )
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t.common.close}
                    title={t.common.close}
                    onClick={() => {
                      if (!confirmLeaveEdit()) return
                      onSelectedSkillPreviewChange(null)
                    }}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 overflow-hidden">
                {!catalogPreviewResult && selectedSkillPreview.files ? (
                  <div className="flex w-[168px] shrink-0 flex-col overflow-hidden border-r bg-muted/10">
                    <div className="min-h-0 flex-1 overflow-auto p-1.5">
                      {selectedSkillPreview.files.length === 0 ? (
                        <div className="px-1.5 py-2 text-[11px] text-muted-foreground">
                          {t.settings.skillPreviewEmptyTree}
                        </div>
                      ) : (
                        selectedSkillPreview.files.map((entry) => {
                          const depth = entry.relativePath.split('/').length - 1
                          const selected =
                            entry.kind === 'file' &&
                            selectedSkillPreview.selectedFilePath === entry.relativePath
                          if (entry.kind === 'directory') {
                            return (
                              <div
                                key={entry.relativePath}
                                className="flex items-center gap-1 truncate px-1.5 py-0.5 text-[11px] text-muted-foreground"
                                style={{ paddingLeft: `${6 + depth * 10}px` }}
                              >
                                <FolderIcon className="size-3 shrink-0" aria-hidden="true" />
                                <span className="truncate">{entry.name}</span>
                              </div>
                            )
                          }
                          return (
                            <button
                              key={entry.relativePath}
                              type="button"
                              className={`flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                                selected
                                  ? 'bg-accent text-accent-foreground'
                                  : 'text-foreground hover:bg-muted/60'
                              }`}
                              style={{ paddingLeft: `${6 + depth * 10}px` }}
                              onClick={() => handleSelectPreviewFile(entry.relativePath)}
                            >
                              {entry.name === 'SKILL.md' ? (
                                <BookOpenIcon className="size-3 shrink-0" aria-hidden="true" />
                              ) : (
                                <FileTextIcon className="size-3 shrink-0" aria-hidden="true" />
                              )}
                              <span className="truncate">{entry.name}</span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3 text-sm">
                  {editing ? (
                    editPreviewing && previewIsMarkdown ? (
                      <MarkdownContent
                        value={parseSkillMarkdown(editContent).body || editContent}
                        t={t}
                      />
                    ) : (
                      <Textarea
                        value={editContent}
                        onChange={(event) => setEditContent(event.target.value)}
                        disabled={skillFileSaving}
                        spellCheck={false}
                        className="min-h-[420px] resize-y font-mono text-xs"
                      />
                    )
                  ) : catalogPreviewLoading ||
                    (skillPreviewLoadingPath === selectedSkillPreview.skill.path &&
                      !selectedSkillPreview.content &&
                      !selectedSkillPreview.selectedFileBinary &&
                      !selectedSkillPreview.selectedFileError) ? (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden="true" />
                      {t.settings.skillPreviewLoading}
                    </div>
                  ) : selectedSkillPreview.selectedFileError ? (
                    <div className="text-xs text-destructive">
                      {selectedSkillPreview.selectedFileError}
                    </div>
                  ) : selectedSkillPreview.selectedFileBinary ? (
                    <div className="text-xs text-muted-foreground">
                      {t.settings.skillPreviewBinary}
                    </div>
                  ) : selectedSkillPreview.content ? (
                    <div className="flex flex-col gap-2">
                      {selectedSkillPreview.selectedFileTruncated ? (
                        <div className="text-[11px] text-muted-foreground">
                          {t.settings.skillPreviewTruncated}
                        </div>
                      ) : null}
                      {previewIsMarkdown ? (
                        <MarkdownContent value={previewMarkdownBody} t={t} />
                      ) : (
                        <MarkdownContent
                          value={formatSkillFileAsMarkdownCode(
                            selectedSkillPreview.selectedFilePath ?? 'file.txt',
                            selectedSkillPreview.content
                          )}
                          t={t}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden="true" />
                      {t.settings.skillPreviewLoading}
                    </div>
                  )}
                </div>
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
