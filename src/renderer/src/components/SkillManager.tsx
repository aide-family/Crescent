import {
  BookOpenIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  SearchIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'

import { MarkdownContent } from '@renderer/components/MarkdownContent'
import {
  SkillInstallStatusDot,
  SkillManageStatus,
  type SkillInstallLogStatus,
  type SkillManageMessage
} from '@renderer/components/StatusIndicators'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import type { Dictionary } from '@renderer/i18n'
import {
  buildSkillInstallCommand,
  formatInstallCount,
  isSkillSearchResultInstalled
} from '@renderer/lib/skill-management'
import type { AgentSkillOption, AgentSkillSearchResult } from '../../../shared/agent-types'

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
  selectedSkillPreview: { skill: AgentSkillOption; content: string } | null
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
  onDeleteSkillInstallLog: (resultId: string) => void
  onSelectedSkillPreviewChange: (value: { skill: AgentSkillOption; content: string } | null) => void
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
  onDeleteSkillInstallLog,
  onSelectedSkillPreviewChange,
  onSkillInstallLogResultIdChange
}: SkillManagerProps): React.JSX.Element {
  const skillInstallLogResultIds = Object.keys(skillInstallLogs)
  const skillInstallLogCount = skillInstallLogResultIds.length
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
  const skillSidePanelOpen = Boolean(skillInstallLogResultId || selectedSkillPreview)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={`w-full ${skillSidePanelOpen ? 'sm:max-w-6xl' : 'sm:max-w-2xl'}`}
      >
        <SheetHeader>
          <SheetTitle>{t.settings.skillsManagement}</SheetTitle>
          <SheetDescription>{t.settings.skillsManagementHint}</SheetDescription>
        </SheetHeader>
        <div className="app-sheet-split flex min-h-0 flex-1 flex-row-reverse gap-3 overflow-hidden px-4">
          <div className="app-sheet-main min-w-0 flex-1 space-y-4 overflow-auto">
            <div className="space-y-3 rounded-lg border bg-muted/10 p-3">
              <Field>
                <FieldLabel htmlFor="skill-root">{t.settings.skillDirectory}</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="skill-root"
                    value={skillRoot}
                    onChange={(event) => onSkillRootChange(event.target.value)}
                    placeholder="~/.agents/skills"
                  />
                  <Button type="button" variant="outline" onClick={() => void onSaveSkillRoot()}>
                    {t.settings.saveSkillDirectory}
                  </Button>
                </div>
                <FieldDescription>{t.settings.skillDirectoryHint}</FieldDescription>
              </Field>
            </div>
            <div className="space-y-3 rounded-lg border bg-muted/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">
                  {t.settings.localSkills} · {filteredLocalSkills.length}/{skills.length}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={onRefreshSkills}>
                  <SearchIcon data-icon="inline-start" />
                  {t.settings.refreshSkills}
                </Button>
              </div>
              <Input
                type="search"
                value={localSkillSearchQuery}
                onChange={(event) => onLocalSkillSearchQueryChange(event.target.value)}
                placeholder={t.settings.localSkillsSearchPlaceholder}
                autoComplete="off"
                spellCheck={false}
                aria-label={t.settings.localSkillsSearchPlaceholder}
              />
              <div className="max-h-72 space-y-1.5 overflow-auto overscroll-contain">
                {skills.length === 0 ? (
                  <div className="rounded-md border bg-background p-2.5 text-xs text-muted-foreground">
                    {t.settings.noLocalSkills}
                  </div>
                ) : filteredLocalSkills.length === 0 ? (
                  <div className="rounded-md border bg-background p-2.5 text-xs text-muted-foreground">
                    {t.settings.noMatchedLocalSkills}
                  </div>
                ) : (
                  filteredLocalSkills.map((skill) => (
                    <div
                      key={skill.path}
                      className={`flex items-start justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs transition-[border-color,background-color] ${
                        selectedSkillPreview?.skill.path === skill.path
                          ? 'border-primary/50 bg-primary/8'
                          : 'border-border/70 bg-background hover:bg-muted/25'
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 space-y-0.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        onClick={() => void onPreviewSkill(skill)}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[13px] font-medium">{skill.name}</span>
                          {!skill.removable && (
                            <Badge variant="outline" className="h-5 text-[10px]">
                              {t.settings.protectedSkill}
                            </Badge>
                          )}
                          {skillPreviewLoadingPath === skill.path && (
                            <Loader2Icon
                              className="size-3 shrink-0 animate-spin text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        {skill.description && (
                          <div className="line-clamp-2 text-[11px] text-muted-foreground">
                            {skill.description}
                          </div>
                        )}
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {skill.path}
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
                  ))
                )}
              </div>
            </div>
            <div className="space-y-3 rounded-lg border bg-muted/10 p-3">
              <div className="flex gap-2">
                <Input
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
                  onClick={onSearchSkills}
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
              <FieldDescription>{t.settings.skillsSearchHint}</FieldDescription>
              {skillSearchResults.length > 0 && (
                <div className="max-h-80 space-y-2 overflow-auto">
                  {skillSearchResults.map((result) => {
                    const installed = isSkillSearchResultInstalled(result, installedSkillNames)
                    const installing = Boolean(skillInstallIds[result.id])

                    return (
                      <div
                        key={result.id}
                        className="flex items-start justify-between gap-3 rounded-md border bg-background p-3 text-xs"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex min-w-0 items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">{result.name}</span>
                              {installed && (
                                <Badge variant="secondary" className="shrink-0">
                                  {t.settings.skillInstalledStatus}
                                </Badge>
                              )}
                            </div>
                            <Badge variant="outline" className="shrink-0">
                              {t.settings.skillInstalls}: {formatInstallCount(result.installs)}
                            </Badge>
                          </div>
                          {result.description && (
                            <div className="line-clamp-2 text-muted-foreground">
                              {result.description}
                            </div>
                          )}
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {buildSkillInstallCommand(result)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
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
                            size="sm"
                            variant={installing ? 'outline' : 'default'}
                            onClick={() => void onInstallSkill(result)}
                          >
                            {installing ? (
                              <Loader2Icon className="animate-spin" data-icon="inline-start" />
                            ) : (
                              <DownloadIcon data-icon="inline-start" />
                            )}
                            {installing
                              ? t.settings.skillInstalling
                              : installed
                                ? t.settings.updateSkill
                                : t.settings.installSkill}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <SkillManageStatus message={skillManageMessage} />
            </div>
          </div>
          {skillInstallLogResultId ? (
            <div className="app-sheet-detail flex w-[680px] shrink-0 overflow-hidden rounded-md border bg-background">
              <div className="w-44 shrink-0 overflow-auto border-r bg-muted/20 p-1">
                {skillInstallLogResultIds.map((resultId) => {
                  const running = Boolean(skillInstallIds[resultId])
                  const status: SkillInstallLogStatus = running
                    ? 'running'
                    : (skillInstallLogStatuses[resultId] ?? 'success')
                  const selected = resultId === skillInstallLogResultId

                  return (
                    <div
                      key={resultId}
                      className={`mb-1 block w-full rounded px-2 py-2 text-left text-[11px] transition ${
                        selected
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                      }`}
                      title={skillInstallLogNames[resultId] ?? resultId}
                    >
                      <button
                        type="button"
                        className="flex w-full min-w-0 items-start gap-2 text-left"
                        onClick={() => onSkillInstallLogResultIdChange(resultId)}
                      >
                        <SkillInstallStatusDot status={status} />
                        <span className="min-w-0 flex-1 break-words leading-snug">
                          {skillInstallLogNames[resultId] ?? resultId}
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-3 border-b px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-start gap-2 text-sm font-semibold">
                      <SkillInstallStatusDot status={selectedSkillInstallStatus} />
                      <span className="min-w-0 break-words">
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
                <pre className="min-h-0 flex-1 select-text overflow-auto bg-[var(--app-markdown-canvas)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-[var(--app-markdown-text)]">
                  {selectedSkillInstallLog || t.settings.skillInstallWaitingLog}
                </pre>
                <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
                  {selectedSkillInstallRunning && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={Boolean(
                        skillInstallLogResultId && skillInstallCancelingIds[skillInstallLogResultId]
                      )}
                      onClick={() =>
                        skillInstallLogResultId &&
                        void onCancelSkillInstall(skillInstallLogResultId)
                      }
                    >
                      {skillInstallLogResultId &&
                        skillInstallCancelingIds[skillInstallLogResultId] && (
                          <Loader2Icon className="animate-spin" data-icon="inline-start" />
                        )}
                      {t.settings.cancelSkillInstall}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : selectedSkillPreview ? (
            <div className="app-sheet-detail flex w-[680px] shrink-0 flex-col overflow-hidden rounded-md border bg-background">
              <div className="flex items-start justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {t.settings.skillPreview}: {selectedSkillPreview.skill.name}
                    </span>
                    {!selectedSkillPreview.skill.removable && (
                      <Badge variant="outline">{t.settings.protectedSkill}</Badge>
                    )}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {selectedSkillPreview.skill.path}
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
                {selectedSkillPreview.content ? (
                  <MarkdownContent value={selectedSkillPreview.content} t={t} />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden="true" />
                    {t.settings.skillPreviewLoading}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            disabled={skillInstallLogCount === 0}
            onClick={() => onSkillInstallLogResultIdChange(skillInstallLogResultIds[0] ?? null)}
          >
            <FileTextIcon data-icon="inline-start" />
            {t.settings.skillInstallLogs}
            {skillInstallLogCount > 0 ? ` (${skillInstallLogCount})` : ''}
          </Button>
          <Button type="button" variant="outline" onClick={() => void onRefreshSkills()}>
            <SearchIcon data-icon="inline-start" />
            {t.settings.refreshSkills}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
