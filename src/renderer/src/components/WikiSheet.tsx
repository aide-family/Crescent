import { useMemo, useState, type CSSProperties } from 'react'
import {
  Code2Icon,
  EyeIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'

import { MarkdownContent } from '@renderer/components/MarkdownContent'
import { buildMarkdownHeadingId } from '@renderer/lib/markdown-heading'
import { SkillManageStatus, type SkillManageMessage } from '@renderer/components/StatusIndicators'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import { Textarea } from '@renderer/components/ui/textarea'
import type { Dictionary } from '@renderer/i18n'
import { formatHistoryTime } from '@renderer/lib/agent-log'
import { parseWikiHeadings } from '@renderer/lib/wiki'
import type { WikiDocument, WikiDocumentSummary } from '../../../shared/agent-types'

const WIKI_HEADING_PREFIX = 'wiki-preview'

export interface WikiSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  t: Dictionary
  wikiLoading: boolean
  wikiDocumentLoadingId: string | null
  wikiDocuments: WikiDocumentSummary[]
  filteredWikiDocuments: WikiDocumentSummary[]
  selectedWikiDocument: WikiDocument | null
  wikiSearchQuery: string
  wikiEditing: boolean
  wikiEditContent: string
  wikiSaving: boolean
  wikiDeletingId: string | null
  wikiMessage: SkillManageMessage | null
  wikiPreviewWidth: number
  onRefresh: () => void
  onSearchQueryChange: (query: string) => void
  onOpenDocument: (document: WikiDocumentSummary) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdits: () => void
  onDeleteDocument: () => void
  onEditContentChange: (content: string) => void
  onStartResize: (startX: number, startWidth: number) => void
}

export function WikiSheet({
  open,
  onOpenChange,
  t,
  wikiLoading,
  wikiDocumentLoadingId,
  wikiDocuments,
  filteredWikiDocuments,
  selectedWikiDocument,
  wikiSearchQuery,
  wikiEditing,
  wikiEditContent,
  wikiSaving,
  wikiDeletingId,
  wikiMessage,
  wikiPreviewWidth,
  onRefresh,
  onSearchQueryChange,
  onOpenDocument,
  onStartEdit,
  onCancelEdit,
  onSaveEdits,
  onDeleteDocument,
  onEditContentChange,
  onStartResize
}: WikiSheetProps): React.JSX.Element {
  const wikiHeadingContent =
    selectedWikiDocument && wikiEditing ? wikiEditContent : selectedWikiDocument?.content
  const selectedWikiHeadings = useMemo(
    () => (wikiHeadingContent ? parseWikiHeadings(wikiHeadingContent) : []),
    [wikiHeadingContent]
  )
  const isDeletingSelected = wikiDeletingId === selectedWikiDocument?.id

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-[var(--wiki-sheet-width)] max-w-[calc(100vw-3rem)] sm:max-w-[calc(100vw-3rem)]"
        style={
          {
            '--wiki-sheet-width': selectedWikiDocument
              ? `${280 + 12 + 180 + 12 + 32 + wikiPreviewWidth}px`
              : '420px',
            maxWidth: 'calc(100vw - 3rem)'
          } as CSSProperties
        }
      >
        <SheetHeader className="flex-row items-start justify-between gap-3 pr-16">
          <div className="min-w-0">
            <SheetTitle>{t.wiki.title}</SheetTitle>
            <SheetDescription>{t.wiki.description}</SheetDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={onRefresh}
            disabled={wikiLoading}
            aria-label={t.wiki.refresh}
            title={t.wiki.refresh}
          >
            {wikiLoading ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCwIcon aria-hidden="true" />
            )}
          </Button>
        </SheetHeader>

        <div
          className="app-wiki-grid grid min-h-0 flex-1 grid-cols-1 gap-3 px-4"
          style={
            selectedWikiDocument
              ? { gridTemplateColumns: `280px 180px minmax(360px, ${wikiPreviewWidth}px)` }
              : undefined
          }
        >
          <WikiDocumentList
            t={t}
            wikiLoading={wikiLoading}
            wikiDocuments={wikiDocuments}
            filteredWikiDocuments={filteredWikiDocuments}
            selectedWikiDocument={selectedWikiDocument}
            wikiSearchQuery={wikiSearchQuery}
            onSearchQueryChange={onSearchQueryChange}
            onOpenDocument={onOpenDocument}
          />

          {selectedWikiDocument && <WikiHeadingNavigation t={t} headings={selectedWikiHeadings} />}

          {selectedWikiDocument && (
            <WikiDocumentPanel
              t={t}
              document={selectedWikiDocument}
              loading={wikiDocumentLoadingId === selectedWikiDocument.id}
              editing={wikiEditing}
              editContent={wikiEditContent}
              saving={wikiSaving}
              deleting={isDeletingSelected}
              previewWidth={wikiPreviewWidth}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onSaveEdits={onSaveEdits}
              onDeleteDocument={onDeleteDocument}
              onEditContentChange={onEditContentChange}
              onStartResize={onStartResize}
            />
          )}
        </div>

        <SheetFooter className="gap-2 sm:justify-between">
          <SkillManageStatus message={wikiMessage} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function WikiDocumentList({
  t,
  wikiLoading,
  wikiDocuments,
  filteredWikiDocuments,
  selectedWikiDocument,
  wikiSearchQuery,
  onSearchQueryChange,
  onOpenDocument
}: {
  t: Dictionary
  wikiLoading: boolean
  wikiDocuments: WikiDocumentSummary[]
  filteredWikiDocuments: WikiDocumentSummary[]
  selectedWikiDocument: WikiDocument | null
  wikiSearchQuery: string
  onSearchQueryChange: (query: string) => void
  onOpenDocument: (document: WikiDocumentSummary) => void
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Input
        type="search"
        value={wikiSearchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        placeholder={t.wiki.searchPlaceholder}
        autoComplete="off"
        spellCheck={false}
        aria-label={t.wiki.searchPlaceholder}
      />
      <div className="min-h-0 space-y-1.5 overflow-auto overscroll-contain">
        {wikiLoading && (
          <div className="flex items-center gap-2 rounded-md border p-2.5 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            {t.wiki.loading}
          </div>
        )}
        {!wikiLoading && wikiDocuments.length === 0 && (
          <div className="rounded-md border p-2.5 text-sm text-muted-foreground">
            {t.wiki.empty}
          </div>
        )}
        {!wikiLoading && wikiDocuments.length > 0 && filteredWikiDocuments.length === 0 && (
          <div className="rounded-md border p-2.5 text-sm text-muted-foreground">
            {t.wiki.empty}
          </div>
        )}
        {filteredWikiDocuments.map((document) => (
          <button
            key={document.id}
            type="button"
            className={`block w-full min-w-0 overflow-hidden rounded-lg border px-2.5 py-2 text-left text-xs transition-[border-color,background-color] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              selectedWikiDocument?.id === document.id
                ? 'border-primary/50 bg-primary/8'
                : 'border-border/70 hover:bg-muted/25'
            }`}
            onClick={() => onOpenDocument(document)}
          >
            <span className="block truncate text-[13px] font-medium">{document.title}</span>
            <span className="mt-0.5 block truncate tabular-nums text-[11px] text-muted-foreground">
              {formatHistoryTime(document.updatedAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function WikiHeadingNavigation({
  t,
  headings
}: {
  t: Dictionary
  headings: ReturnType<typeof parseWikiHeadings>
}): React.JSX.Element {
  return (
    <aside className="min-h-0 overflow-auto overscroll-contain rounded-md border bg-muted/10 p-2">
      <div className="sticky top-0 z-10 border-b bg-background px-1 py-2 text-xs font-semibold text-muted-foreground">
        {t.wiki.navigation}
      </div>
      {headings.length === 0 ? (
        <div className="px-1 py-3 text-xs text-muted-foreground">{t.wiki.noHeadings}</div>
      ) : (
        <div className="space-y-1 py-2">
          {headings.map((heading) => (
            <button
              key={`${heading.index}:${heading.text}`}
              type="button"
              className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              style={{ paddingLeft: `${Math.min(heading.level - 1, 3) * 10 + 8}px` }}
              title={heading.text}
              onClick={() => {
                document
                  .getElementById(
                    buildMarkdownHeadingId(WIKI_HEADING_PREFIX, heading.text, heading.index)
                  )
                  ?.scrollIntoView({
                    block: 'start',
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                      ? 'auto'
                      : 'smooth'
                  })
              }}
            >
              {heading.text}
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}

function WikiDocumentPanel({
  t,
  document: wikiDocument,
  loading,
  editing,
  editContent,
  saving,
  deleting,
  previewWidth,
  onStartEdit,
  onCancelEdit,
  onSaveEdits,
  onDeleteDocument,
  onEditContentChange,
  onStartResize
}: {
  t: Dictionary
  document: WikiDocument
  loading: boolean
  editing: boolean
  editContent: string
  saving: boolean
  deleting: boolean
  previewWidth: number
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdits: () => void
  onDeleteDocument: () => void
  onEditContentChange: (content: string) => void
  onStartResize: (startX: number, startWidth: number) => void
}): React.JSX.Element {
  return (
    <div className="app-document-panel relative min-h-0 overflow-auto rounded-md border bg-background">
      {loading ? (
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          {t.wiki.loading}
        </div>
      ) : editing ? (
        <WikiDocumentEditor
          t={t}
          content={editContent}
          saving={saving}
          onContentChange={onEditContentChange}
          onCancel={onCancelEdit}
          onSave={onSaveEdits}
        />
      ) : (
        <WikiDocumentPreview
          t={t}
          document={wikiDocument}
          deleting={deleting}
          onStartEdit={onStartEdit}
          onDeleteDocument={onDeleteDocument}
        />
      )}
      <div
        className="absolute inset-y-0 right-0 hidden w-2 cursor-col-resize hover:bg-primary/40 lg:block"
        role="separator"
        aria-orientation="vertical"
        aria-label={t.wiki.resize}
        title={t.wiki.resize}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          onStartResize(event.clientX, previewWidth)
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
        }}
      />
    </div>
  )
}

function WikiDocumentEditor({
  t,
  content,
  saving,
  onContentChange,
  onCancel,
  onSave
}: {
  t: Dictionary
  content: string
  saving: boolean
  onContentChange: (content: string) => void
  onCancel: () => void
  onSave: () => void
}): React.JSX.Element {
  const [previewing, setPreviewing] = useState(false)

  return (
    <div className="flex min-h-full flex-col text-sm">
      <div className="sticky top-0 z-10 flex w-full items-center justify-between gap-3 border-b bg-card px-5 py-3 shadow-sm shadow-black/20">
        <FieldLabel htmlFor="wiki-edit-content">
          {previewing ? t.wiki.markdownPreview : t.wiki.markdownSource}
        </FieldLabel>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => setPreviewing((current) => !current)}
            disabled={saving}
            aria-label={previewing ? t.wiki.editMarkdownSource : t.wiki.previewMarkdown}
            title={previewing ? t.wiki.editMarkdownSource : t.wiki.previewMarkdown}
          >
            {previewing ? <Code2Icon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={onCancel}
            disabled={saving}
            aria-label={t.wiki.cancelEdit}
            title={t.wiki.cancelEdit}
          >
            <XIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            onClick={onSave}
            disabled={saving}
            aria-label={t.wiki.saveEdit}
            title={t.wiki.saveEdit}
          >
            {saving ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <SaveIcon aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      <Field className="min-h-0 flex-1 p-5">
        {previewing ? (
          <div className="min-h-[520px] rounded-md border bg-background p-4">
            <MarkdownContent value={content} t={t} headingIdPrefix={WIKI_HEADING_PREFIX} />
          </div>
        ) : (
          <Textarea
            id="wiki-edit-content"
            className="min-h-[520px] resize-y font-mono text-xs"
            value={content}
            onChange={(event) => onContentChange(event.target.value)}
          />
        )}
      </Field>
    </div>
  )
}

function WikiDocumentPreview({
  t,
  document: wikiDocument,
  deleting,
  onStartEdit,
  onDeleteDocument
}: {
  t: Dictionary
  document: WikiDocument
  deleting: boolean
  onStartEdit: () => void
  onDeleteDocument: () => void
}): React.JSX.Element {
  return (
    <article className="min-h-full text-sm">
      <div className="sticky top-0 z-10 flex w-full items-start justify-between gap-3 border-b bg-card px-5 py-4 shadow-sm shadow-black/20">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{wikiDocument.title}</h2>
          <p className="mt-1 break-all text-xs text-muted-foreground">{wikiDocument.path}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={onStartEdit}
            disabled={deleting}
            aria-label={t.wiki.edit}
            title={t.wiki.edit}
          >
            <PencilIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="icon-sm"
            onClick={onDeleteDocument}
            disabled={deleting}
            aria-label={t.wiki.delete}
            title={t.wiki.delete}
          >
            {deleting ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2Icon aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      <div className="mx-auto w-full max-w-4xl space-y-4 p-5">
        <MarkdownContent value={wikiDocument.content} t={t} headingIdPrefix={WIKI_HEADING_PREFIX} />
      </div>
    </article>
  )
}
