import { FolderOpenIcon, LinkIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'

import { StatusDot } from '@renderer/components/StatusIndicators'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  filterOpenApiValidationTools,
  summarizeOpenApiDocument
} from '@renderer/lib/openapi-settings'
import type { Dictionary } from '@renderer/i18n'
import type { AgentOpenApiProfile, AgentValidationResult } from '../../../shared/agent-types'

interface OpenApiProfileListProps {
  profiles: AgentOpenApiProfile[]
  activeProfileId?: string
  editorProfileId?: string
  editorOpen: boolean
  t: Dictionary
  onCreateProfile: () => void
  onToggleProfileDetails: (profileId: string) => void
}

export function OpenApiProfileList({
  profiles,
  activeProfileId,
  editorProfileId,
  editorOpen,
  t,
  onCreateProfile,
  onToggleProfileDetails
}: OpenApiProfileListProps): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">{t.settings.openApiSection}</div>
        <FieldDescription>{t.settings.openApiSectionHint}</FieldDescription>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          {t.settings.openApiProfiles} · {profiles.length}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onCreateProfile}>
          <PlusIcon data-icon="inline-start" />
          {t.settings.newOpenApiProfile}
        </Button>
      </div>
      {profiles.length === 0 ? (
        <div className="rounded-md border bg-muted/10 p-3 text-xs text-muted-foreground">
          {t.settings.noOpenApiProfiles}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {profiles.map((profile) => {
            const selected = editorOpen && editorProfileId === profile.id
            const isActive = activeProfileId === profile.id
            const summary = summarizeOpenApiDocument(profile.document)
            const ready = Boolean(profile.baseUrl.trim() && profile.document.trim())

            return (
              <div
                key={profile.id}
                className={`flex min-w-0 flex-col rounded-lg border bg-card/70 px-2.5 py-2 text-xs transition-[border-color,background-color] hover:bg-muted/25 ${
                  selected ? 'border-primary/50 bg-primary/8' : 'border-border/70'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => onToggleProfileDetails(profile.id)}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusDot state={ready ? 'ready' : 'not-ready'} />
                        <span className="truncate text-[13px] font-medium">
                          {profile.name || profile.id}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {profile.id}
                      </div>
                    </div>
                    {isActive && (
                      <Badge variant="secondary" className="h-5 shrink-0 text-[10px]">
                        {t.settings.openApiActiveBadge}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground">
                    {profile.baseUrl || '-'}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {summary.kind === 'empty' ? t.settings.openApiDocumentEmpty : summary.kind}
                    </span>
                    <span>·</span>
                    <span className="tabular-nums">
                      {profile.timeoutMs}ms / {profile.maxRetries}x
                    </span>
                  </div>
                </button>
              </div>
            )
          })}
        </div>
      )}
      <FieldDescription>{t.settings.openApiProfileHint}</FieldDescription>
    </div>
  )
}

interface OpenApiProfileEditorFieldsProps {
  profile: AgentOpenApiProfile
  openApiBaseUrl: string
  openApiDocument: string
  openApiTimeoutMs: number
  openApiMaxRetries: number
  openApiRetryBackoffMs: number
  promptTemplate: string
  pinnedWorkflowsText: string
  toolAllowListText: string
  toolDenyListText: string
  validation: AgentValidationResult | undefined
  importing: boolean
  t: Dictionary
  onProfileNameChange: (value: string) => void
  onBaseUrlChange: (value: string) => void
  onDocumentChange: (value: string) => void
  onTimeoutMsChange: (value: number) => void
  onMaxRetriesChange: (value: number) => void
  onRetryBackoffMsChange: (value: number) => void
  onPromptTemplateChange: (value: string) => void
  onPinnedWorkflowsTextChange: (value: string) => void
  onToolAllowListTextChange: (value: string) => void
  onToolDenyListTextChange: (value: string) => void
  onImportFile: () => void
  onClearDocument: () => void
}

export function OpenApiProfileEditorFields({
  profile,
  openApiBaseUrl,
  openApiDocument,
  openApiTimeoutMs,
  openApiMaxRetries,
  openApiRetryBackoffMs,
  promptTemplate,
  pinnedWorkflowsText,
  toolAllowListText,
  toolDenyListText,
  validation,
  importing,
  t,
  onProfileNameChange,
  onBaseUrlChange,
  onDocumentChange,
  onTimeoutMsChange,
  onMaxRetriesChange,
  onRetryBackoffMsChange,
  onPromptTemplateChange,
  onPinnedWorkflowsTextChange,
  onToolAllowListTextChange,
  onToolDenyListTextChange,
  onImportFile,
  onClearDocument
}: OpenApiProfileEditorFieldsProps): React.JSX.Element {
  const summary = summarizeOpenApiDocument(openApiDocument)
  const openApiTools = filterOpenApiValidationTools(validation)

  return (
    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel htmlFor="openapi-profile-name">{t.settings.openApiProfileName}</FieldLabel>
        <Input
          id="openapi-profile-name"
          value={profile.name}
          onChange={(event) => onProfileNameChange(event.target.value)}
          placeholder="Production API"
          autoComplete="off"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="openapi-base-url">{t.settings.openApiBaseUrl}</FieldLabel>
        <Input
          id="openapi-base-url"
          value={openApiBaseUrl}
          onChange={(event) => onBaseUrlChange(event.target.value)}
          placeholder="https://api.example.com/v1"
          autoComplete="off"
        />
        <FieldDescription>{t.settings.openApiBaseUrlHint}</FieldDescription>
      </Field>
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor="openapi-document">{t.settings.document}</FieldLabel>
          <div className="flex items-center gap-2">
            {summary.kind !== 'empty' ? (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {summary.kind}
              </Badge>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={importing}
              onClick={onImportFile}
            >
              <FolderOpenIcon data-icon="inline-start" />
              {importing ? t.settings.importingOpenApi : t.settings.importOpenApiFile}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!openApiDocument.trim()}
              onClick={onClearDocument}
            >
              <Trash2Icon data-icon="inline-start" />
              {t.settings.clearOpenApiDocument}
            </Button>
          </div>
        </div>
        <Textarea
          id="openapi-document"
          className="min-h-28 resize-y font-mono text-xs"
          value={openApiDocument}
          onChange={(event) => onDocumentChange(event.target.value)}
          placeholder={t.settings.openApiDocumentPlaceholder}
        />
        <FieldDescription>
          <span className="inline-flex items-start gap-1">
            <LinkIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span>{t.settings.openApiDocumentHint}</span>
          </span>
        </FieldDescription>
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="openapi-timeout-ms">{t.settings.openApiTimeoutMs}</FieldLabel>
          <Input
            id="openapi-timeout-ms"
            type="number"
            min={1000}
            max={600000}
            step={1000}
            value={openApiTimeoutMs}
            onChange={(event) => onTimeoutMsChange(Number(event.target.value))}
          />
          <FieldDescription>{t.settings.openApiTimeoutMsHint}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="openapi-max-retries">{t.settings.openApiMaxRetries}</FieldLabel>
          <Input
            id="openapi-max-retries"
            type="number"
            min={0}
            max={5}
            value={openApiMaxRetries}
            onChange={(event) => onMaxRetriesChange(Number(event.target.value))}
          />
          <FieldDescription>{t.settings.openApiMaxRetriesHint}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="openapi-retry-backoff-ms">
            {t.settings.openApiRetryBackoffMs}
          </FieldLabel>
          <Input
            id="openapi-retry-backoff-ms"
            type="number"
            min={0}
            max={10000}
            step={100}
            value={openApiRetryBackoffMs}
            onChange={(event) => onRetryBackoffMsChange(Number(event.target.value))}
          />
          <FieldDescription>{t.settings.openApiRetryBackoffMsHint}</FieldDescription>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="openapi-prompt-template">
          {t.settings.openApiPromptTemplate}
        </FieldLabel>
        <Textarea
          id="openapi-prompt-template"
          className="min-h-20 resize-y text-xs"
          value={promptTemplate}
          onChange={(event) => onPromptTemplateChange(event.target.value)}
          placeholder={t.settings.openApiPromptTemplatePlaceholder}
        />
        <FieldDescription>{t.settings.openApiPromptTemplateHint}</FieldDescription>
      </Field>
      <OpenApiPolicyTextFields
        key={profile.id}
        pinnedWorkflowsText={pinnedWorkflowsText}
        toolAllowListText={toolAllowListText}
        toolDenyListText={toolDenyListText}
        t={t}
        onPinnedWorkflowsTextChange={onPinnedWorkflowsTextChange}
        onToolAllowListTextChange={onToolAllowListTextChange}
        onToolDenyListTextChange={onToolDenyListTextChange}
      />
      {openApiTools.length > 0 ? (
        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel>{t.settings.selectedTools}</FieldLabel>
            <span className="text-xs text-muted-foreground">{openApiTools.length}</span>
          </div>
          <div className="max-h-56 space-y-2 overflow-auto rounded-md border bg-muted/10 p-2">
            {openApiTools.map((tool) => (
              <div
                key={`${tool.method}:${tool.path}:${tool.name}`}
                className="min-w-0 rounded-md border bg-background p-2 text-xs"
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{tool.name}</span>
                  <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                    {tool.method.toUpperCase()}
                  </Badge>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {tool.path}
                </div>
                {tool.description ? (
                  <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                    {tool.description}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Field>
      ) : null}
    </FieldGroup>
  )
}

function OpenApiPolicyTextFields({
  pinnedWorkflowsText,
  toolAllowListText,
  toolDenyListText,
  t,
  onPinnedWorkflowsTextChange,
  onToolAllowListTextChange,
  onToolDenyListTextChange
}: {
  pinnedWorkflowsText: string
  toolAllowListText: string
  toolDenyListText: string
  t: Dictionary
  onPinnedWorkflowsTextChange: (value: string) => void
  onToolAllowListTextChange: (value: string) => void
  onToolDenyListTextChange: (value: string) => void
}): React.JSX.Element {
  const [pinnedDraft, setPinnedDraft] = useState(pinnedWorkflowsText)
  const [allowDraft, setAllowDraft] = useState(toolAllowListText)
  const [denyDraft, setDenyDraft] = useState(toolDenyListText)

  return (
    <>
      <Field>
        <FieldLabel htmlFor="openapi-pinned-workflows">
          {t.settings.openApiPinnedWorkflows}
        </FieldLabel>
        <Textarea
          id="openapi-pinned-workflows"
          className="min-h-20 resize-y font-mono text-xs"
          value={pinnedDraft}
          onChange={(event) => {
            setPinnedDraft(event.target.value)
            onPinnedWorkflowsTextChange(event.target.value)
          }}
          placeholder={t.settings.openApiPinnedWorkflowsPlaceholder}
        />
        <FieldDescription>{t.settings.openApiPinnedWorkflowsHint}</FieldDescription>
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="openapi-tool-allow">{t.settings.openApiToolAllowList}</FieldLabel>
          <Textarea
            id="openapi-tool-allow"
            className="min-h-20 resize-y font-mono text-xs"
            value={allowDraft}
            onChange={(event) => {
              setAllowDraft(event.target.value)
              onToolAllowListTextChange(event.target.value)
            }}
            placeholder={t.settings.toolNameListPlaceholder}
          />
          <FieldDescription>{t.settings.openApiToolAllowListHint}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="openapi-tool-deny">{t.settings.openApiToolDenyList}</FieldLabel>
          <Textarea
            id="openapi-tool-deny"
            className="min-h-20 resize-y font-mono text-xs"
            value={denyDraft}
            onChange={(event) => {
              setDenyDraft(event.target.value)
              onToolDenyListTextChange(event.target.value)
            }}
            placeholder={t.settings.toolNameListPlaceholder}
          />
          <FieldDescription>{t.settings.openApiToolDenyListHint}</FieldDescription>
        </Field>
      </div>
    </>
  )
}
