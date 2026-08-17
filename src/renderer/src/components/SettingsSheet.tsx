import {
  BotIcon,
  CheckIcon,
  FileTextIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'

import { OpenApiProfileEditorFields } from '@renderer/components/OpenApiSettingsFields'
import { StatusDot } from '@renderer/components/StatusIndicators'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Separator } from '@renderer/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@renderer/components/ui/sheet'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import type { Dictionary } from '@renderer/i18n'
import { agentStyleSelectOptions } from '@renderer/lib/agent-style-ui'
import { buildModelSelectionValue, parseModelSelectionValue } from '@renderer/lib/app-runtime'
import {
  formatPinnedWorkflowsText,
  parsePinnedWorkflowsText
} from '../../../shared/openapi-profiles'
import { formatToolNameListText, parseToolNameListText } from '../../../shared/tool-policy'
import { normalizeAgentStyle, resolveShowAgentThinking } from '../../../shared/agent-style'
import type {
  AgentConfig,
  AgentModelOption,
  AgentOpenApiProfile,
  AgentProviderConfig,
  AgentStyle,
  AgentValidationResult,
  LocalInstructionDocument
} from '../../../shared/agent-types'

export type OpenApiProfilePatch = Partial<{
  name: string
  baseUrl: string
  document: string
  timeoutMs: number
  maxRetries: number
  retryBackoffMs: number
  promptTemplate: string
  pinnedWorkflows: AgentOpenApiProfile['pinnedWorkflows']
  toolAllowList: string[]
  toolDenyList: string[]
}>

export interface SettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  t: Dictionary
  config: AgentConfig
  settingsProvider: AgentProviderConfig
  settingsProviderId: string
  modelOptions: AgentModelOption[]
  providerModelsText: string
  commandWhitelistText: string
  instructionFiles: LocalInstructionDocument[]
  selectedInstructionName: string
  selectedInstructionFile: LocalInstructionDocument | undefined
  instructionContent: string
  instructionSaved: boolean
  providerEditorOpen: boolean
  openApiEditorOpen: boolean
  settingsOpenApiProfile: AgentOpenApiProfile | undefined
  instructionEditorOpen: boolean
  validation: AgentValidationResult | undefined
  saved: boolean
  importingOpenApi: boolean
  closeTerminalConfirmEnabled: boolean
  onCreateProvider: () => void
  onToggleProviderDetails: (providerId: string) => void
  onDeleteProvider: (providerId: string) => void
  onApplyDefaultModel: (selection: string) => void | Promise<void>
  onCloseTerminalConfirmChange: (enabled: boolean) => void
  onAgentStyleChange: (style: AgentStyle) => void
  onShowAgentThinkingChange: (value: boolean | undefined) => void
  onWorkspaceCwdChange: (value: string) => void
  onMaxActiveToolsChange: (value: number) => void
  onCommandWhitelistChange: (text: string) => void
  onCreateOpenApiProfile: () => void
  onToggleOpenApiProfileDetails: (profileId: string) => void
  onDeleteOpenApiProfile: () => void
  onOpenApiEditorOpenChange: (open: boolean) => void
  onPatchActiveOpenApiProfile: (patch: OpenApiProfilePatch) => void
  onImportOpenApiDocument: () => void | Promise<void>
  onToggleInstructionDetails: (name: string) => void
  onProviderEditorOpenChange: (open: boolean) => void
  onUpdateSettingsProvider: <K extends keyof AgentProviderConfig>(
    key: K,
    value: AgentProviderConfig[K]
  ) => void
  onUpdateSettingsProviderModels: (value: string) => void
  onSaveProviderEditor: () => void | Promise<void>
  onSaveOpenApiEditor: () => void | Promise<void>
  onInstructionEditorOpenChange: (open: boolean) => void
  onInstructionContentChange: (value: string) => void
  onSaveInstructionFile: () => void | Promise<void>
}

export function SettingsSheet({
  open,
  onOpenChange,
  t,
  config,
  settingsProvider,
  settingsProviderId,
  modelOptions,
  providerModelsText,
  commandWhitelistText: _commandWhitelistText,
  instructionFiles,
  selectedInstructionName,
  selectedInstructionFile,
  instructionContent,
  instructionSaved,
  providerEditorOpen,
  openApiEditorOpen,
  settingsOpenApiProfile,
  instructionEditorOpen,
  validation,
  saved,
  importingOpenApi,
  closeTerminalConfirmEnabled,
  onCreateProvider,
  onToggleProviderDetails,
  onApplyDefaultModel,
  onCloseTerminalConfirmChange,
  onAgentStyleChange,
  onShowAgentThinkingChange,
  onWorkspaceCwdChange,
  onMaxActiveToolsChange: _onMaxActiveToolsChange,
  onCommandWhitelistChange: _onCommandWhitelistChange,
  onCreateOpenApiProfile: _onCreateOpenApiProfile,
  onToggleOpenApiProfileDetails: _onToggleOpenApiProfileDetails,
  onDeleteOpenApiProfile,
  onOpenApiEditorOpenChange,
  onPatchActiveOpenApiProfile,
  onImportOpenApiDocument,
  onToggleInstructionDetails,
  onDeleteProvider,
  onProviderEditorOpenChange,
  onUpdateSettingsProvider,
  onUpdateSettingsProviderModels,
  onSaveProviderEditor,
  onSaveOpenApiEditor,
  onInstructionEditorOpenChange,
  onInstructionContentChange,
  onSaveInstructionFile
}: SettingsSheetProps): React.JSX.Element {
  const defaultModelSelection =
    modelOptions.find(
      (model) => model.providerId === config.providerId && model.id === config.model
    ) ?? modelOptions.find((model) => model.id === config.model)
  const defaultModelValue = defaultModelSelection
    ? buildModelSelectionValue(defaultModelSelection.providerId, defaultModelSelection.id)
    : buildModelSelectionValue(config.providerId, config.model)
  const editingProvider =
    config.providers.find((provider) => provider.id === settingsProviderId) ?? settingsProvider
  const detailEditorOpen =
    (providerEditorOpen && Boolean(settingsProviderId)) ||
    (openApiEditorOpen && Boolean(settingsOpenApiProfile)) ||
    (instructionEditorOpen && Boolean(selectedInstructionFile))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t.common.settings}
          title={t.common.settings}
        >
          <SettingsIcon aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent className={`w-full ${detailEditorOpen ? 'sm:max-w-5xl' : 'sm:max-w-2xl'}`}>
        <SheetHeader>
          <SheetTitle>{t.settings.title}</SheetTitle>
          <SheetDescription>
            {t.settings.titleDescription}
            {saved ? (
              <span className="ml-2 text-primary" aria-live="polite">
                {t.settings.saved}
              </span>
            ) : null}
          </SheetDescription>
        </SheetHeader>
        <div className="app-sheet-split flex min-h-0 flex-1 flex-row-reverse gap-3 overflow-hidden px-4">
          <div className="app-sheet-main min-w-0 flex-1 space-y-3 overflow-auto overscroll-contain">
            <div className="flex items-center justify-between gap-2">
              <p className="app-section-label">
                {t.settings.providerList} · {config.providers.length}
              </p>
              <Button type="button" variant="outline" size="xs" onClick={onCreateProvider}>
                <PlusIcon data-icon="inline-start" />
                {t.settings.newProvider}
              </Button>
            </div>
            {config.providers.length === 0 ? (
              <div className="app-empty-state">
                <BotIcon className="mr-2 inline size-3" aria-hidden="true" />
                {t.settings.modelHint}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {config.providers.map((provider) => {
                  const selected = providerEditorOpen && settingsProviderId === provider.id
                  const isDefaultProvider = config.providerId === provider.id
                  const modelCount = provider.models.length
                  const hasApiKey = Boolean(provider.apiKey?.trim())
                  const canDeleteProvider = config.providers.length > 1

                  return (
                    <div
                      key={provider.id}
                      data-selected={selected ? 'true' : undefined}
                      className="app-list-row flex min-w-0 flex-col text-xs"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          onClick={() => onToggleProviderDetails(provider.id)}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <StatusDot
                              state={
                                provider.baseUrl.trim() && modelCount > 0 ? 'ready' : 'not-ready'
                              }
                            />
                            <span className="truncate text-[13px] font-medium">
                              {provider.name.trim() || provider.id || t.settings.newProvider}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {provider.id || '-'}
                          </div>
                          <div className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground">
                            {provider.baseUrl || '-'}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="tabular-nums">
                              {t.settings.providerModels}: {modelCount}
                            </span>
                            <span>·</span>
                            <span>{hasApiKey ? t.settings.apiKey : '-'}</span>
                          </div>
                          {provider.models.length > 0 && (
                            <div className="mt-1 line-clamp-2 font-mono text-[11px] text-muted-foreground">
                              {provider.models.map((model) => model.id).join(', ')}
                            </div>
                          )}
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          {isDefaultProvider && (
                            <Badge variant="secondary" className="h-5 text-[10px]">
                              {t.settings.model}
                            </Badge>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t.common.edit}
                            title={t.common.edit}
                            onClick={(event) => {
                              event.stopPropagation()
                              onToggleProviderDetails(provider.id)
                            }}
                          >
                            <PencilIcon aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={!canDeleteProvider}
                            aria-label={t.settings.deleteProvider}
                            title={
                              canDeleteProvider
                                ? t.settings.deleteProvider
                                : t.settings.keepOneProvider
                            }
                            onClick={(event) => {
                              event.stopPropagation()
                              onDeleteProvider(provider.id)
                            }}
                          >
                            <Trash2Icon aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="model">{t.settings.model}</FieldLabel>
                <Select
                  value={defaultModelValue}
                  onValueChange={(value) => {
                    const parsed = parseModelSelectionValue(value)
                    if (!parsed.model) return
                    void onApplyDefaultModel(value)
                  }}
                >
                  <SelectTrigger id="model" className="w-full">
                    <SelectValue placeholder={t.settings.selectModel} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>{t.settings.modelGroup}</SelectLabel>
                      {modelOptions.map((model) => (
                        <SelectItem
                          key={`${model.providerId}:${model.id}`}
                          value={buildModelSelectionValue(model.providerId, model.id)}
                        >
                          {model.name} · {model.providerName}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>{t.settings.modelHint}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="agent-style">{t.settings.agentStyle}</FieldLabel>
                <Select
                  value={normalizeAgentStyle(config.agentStyle)}
                  onValueChange={(value) => onAgentStyleChange(normalizeAgentStyle(value))}
                >
                  <SelectTrigger id="agent-style" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>{t.settings.agentStyle}</SelectLabel>
                      {agentStyleSelectOptions(t).map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          <span className="flex flex-col items-start gap-0.5">
                            <span>{option.title}</span>
                            <span className="text-xs font-normal text-muted-foreground">
                              {option.description}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>{t.settings.agentStyleHint}</FieldDescription>
              </Field>
              <Field>
                <label
                  htmlFor="show-agent-thinking"
                  className="app-list-row flex items-start justify-between gap-3"
                >
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">
                      {t.settings.showAgentThinking}
                    </span>
                    <FieldDescription>{t.settings.showAgentThinkingHint}</FieldDescription>
                  </span>
                  <Input
                    id="show-agent-thinking"
                    type="checkbox"
                    checked={resolveShowAgentThinking(
                      normalizeAgentStyle(config.agentStyle),
                      config.showAgentThinking
                    )}
                    onChange={(event) => {
                      const checked = event.target.checked
                      const styleDefault = normalizeAgentStyle(config.agentStyle) === 'teach'
                      onShowAgentThinkingChange(checked === styleDefault ? undefined : checked)
                    }}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                </label>
              </Field>
              <Field>
                <label
                  htmlFor="close-terminal-confirm"
                  className="app-list-row flex items-start justify-between gap-3"
                >
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">
                      {t.settings.closeTerminalConfirm}
                    </span>
                    <FieldDescription>{t.settings.closeTerminalConfirmHint}</FieldDescription>
                  </span>
                  <Input
                    id="close-terminal-confirm"
                    type="checkbox"
                    checked={closeTerminalConfirmEnabled}
                    onChange={(event) => onCloseTerminalConfirmChange(event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                </label>
              </Field>
              <Field>
                <FieldLabel htmlFor="workspace-cwd">{t.settings.workspaceCwd}</FieldLabel>
                <Input
                  id="workspace-cwd"
                  value={config.workspaceCwd ?? ''}
                  onChange={(event) => onWorkspaceCwdChange(event.target.value)}
                  placeholder="~/.crescent/workspace…"
                />
                <FieldDescription>{t.settings.workspaceCwdHint}</FieldDescription>
              </Field>
              <Separator />
              <Field>
                <FieldLabel>{t.settings.piToolsTitle}</FieldLabel>
                <FieldDescription>{t.settings.piToolsHint}</FieldDescription>
              </Field>
              <Separator />
              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel>{t.settings.instructionFiles}</FieldLabel>
                  <span className="text-xs text-muted-foreground">{instructionFiles.length}</span>
                </div>
                <FieldDescription>{t.settings.instructionFilesHint}</FieldDescription>
                {instructionFiles.length === 0 ? (
                  <div className="app-empty-state">
                    <FileTextIcon className="mr-2 inline size-3" aria-hidden="true" />
                    {t.settings.instructionFilePlaceholder}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {instructionFiles.map((file) => {
                      const selected =
                        instructionEditorOpen && file.name === selectedInstructionName
                      const contentLength = file.content.trim().length

                      return (
                        <div
                          key={file.name}
                          data-selected={selected ? 'true' : undefined}
                          className="app-list-row flex min-w-0 flex-col text-xs"
                        >
                          <button
                            type="button"
                            className="min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            onClick={() => onToggleInstructionDetails(file.name)}
                          >
                            <div className="flex min-w-0 items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                  <StatusDot state={file.exists ? 'ready' : 'pending'} />
                                  <span className="truncate text-[13px] font-medium">
                                    {file.name}
                                  </span>
                                </div>
                                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                                  {file.path}
                                </div>
                              </div>
                              <Badge variant="secondary" className="h-5 shrink-0 text-[10px]">
                                {file.exists
                                  ? t.settings.instructionFileExists
                                  : t.settings.instructionFileNew}
                              </Badge>
                            </div>
                            <div className="mt-1.5 tabular-nums text-[11px] text-muted-foreground">
                              {t.settings.instructionFileCharCount.replace(
                                '{n}',
                                String(contentLength)
                              )}
                            </div>
                            {file.content.trim() && (
                              <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                                {file.content.trim().replace(/\s+/g, ' ')}
                              </div>
                            )}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Field>
              <Separator />
              {validation && (
                <div className="rounded-md border bg-muted/40 p-3 text-xs">
                  {validation.ok ? (
                    <div className="space-y-2">
                      <p className="font-medium text-primary">
                        {t.settings.selectedTools}: {validation.toolCount}
                      </p>
                      <div className="space-y-1 text-muted-foreground">
                        {validation.tools?.map((tool) => (
                          <p key={tool.name}>
                            {tool.name}
                            {tool.method && tool.path
                              ? ` · ${tool.method.toUpperCase()} ${tool.path}`
                              : tool.description
                                ? ` · ${tool.description}`
                                : ''}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-destructive">{validation.error}</p>
                  )}
                </div>
              )}
            </FieldGroup>
          </div>
          {providerEditorOpen && settingsProviderId ? (
            <div
              id="provider-editor-panel"
              className="app-sheet-detail flex w-[560px] shrink-0 flex-col overflow-hidden rounded-md border bg-background"
            >
              <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {t.settings.providerList}:{' '}
                    {editingProvider.name.trim() || editingProvider.id || t.settings.newProvider}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {editingProvider.id || settingsProviderId}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={config.providers.length <= 1}
                    aria-label={t.settings.deleteProvider}
                    title={t.settings.deleteProvider}
                    onClick={() => onDeleteProvider(settingsProviderId)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t.common.close}
                    title={t.common.close}
                    onClick={() => onProviderEditorOpenChange(false)}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
                <FieldGroup className="gap-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <FieldLabel htmlFor="provider-id">{t.settings.providerId}</FieldLabel>
                      <Input
                        id="provider-id"
                        value={editingProvider.id}
                        onChange={(event) => onUpdateSettingsProvider('id', event.target.value)}
                        placeholder="provider-id…"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="provider-name">{t.settings.providerName}</FieldLabel>
                      <Input
                        id="provider-name"
                        value={editingProvider.name}
                        onChange={(event) => onUpdateSettingsProvider('name', event.target.value)}
                        placeholder={t.settings.providerName}
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="provider-base-url">{t.settings.baseUrl}</FieldLabel>
                    <Input
                      id="provider-base-url"
                      value={editingProvider.baseUrl}
                      onChange={(event) => onUpdateSettingsProvider('baseUrl', event.target.value)}
                      placeholder="https://api.deepseek.com…"
                    />
                    <FieldDescription>{t.settings.baseUrlHint}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="provider-api-key">{t.settings.apiKey}</FieldLabel>
                    <Input
                      id="provider-api-key"
                      type="password"
                      value={editingProvider.apiKey ?? ''}
                      onChange={(event) => onUpdateSettingsProvider('apiKey', event.target.value)}
                      placeholder="sk-… or leave blank when env key is available"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="provider-models">{t.settings.providerModels}</FieldLabel>
                    <Textarea
                      id="provider-models"
                      className="min-h-44 resize-y font-mono text-xs"
                      value={providerModelsText}
                      onChange={(event) => onUpdateSettingsProviderModels(event.target.value)}
                      placeholder={'deepseek-chat\ndeepseek-reasoner'}
                    />
                    <FieldDescription>{t.settings.modelListHint}</FieldDescription>
                  </Field>
                </FieldGroup>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2">
                <Button type="button" onClick={() => void onSaveProviderEditor()}>
                  {saved ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : (
                    <BotIcon data-icon="inline-start" />
                  )}
                  {saved ? t.settings.saved : t.settings.saveSettings}
                </Button>
              </div>
            </div>
          ) : openApiEditorOpen && settingsOpenApiProfile ? (
            <div className="app-sheet-detail flex w-[560px] shrink-0 flex-col overflow-hidden rounded-md border bg-background">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {t.settings.openApiProfiles}:{' '}
                    {settingsOpenApiProfile.name || settingsOpenApiProfile.id}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {settingsOpenApiProfile.id}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t.settings.deleteOpenApiProfile}
                    title={t.settings.deleteOpenApiProfile}
                    onClick={onDeleteOpenApiProfile}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t.common.close}
                    title={t.common.close}
                    onClick={() => onOpenApiEditorOpenChange(false)}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
                <OpenApiProfileEditorFields
                  profile={settingsOpenApiProfile}
                  openApiBaseUrl={config.openApiBaseUrl}
                  openApiDocument={config.openApiDocument}
                  openApiTimeoutMs={config.openApiTimeoutMs}
                  openApiMaxRetries={config.openApiMaxRetries}
                  openApiRetryBackoffMs={config.openApiRetryBackoffMs}
                  promptTemplate={settingsOpenApiProfile.promptTemplate ?? ''}
                  pinnedWorkflowsText={formatPinnedWorkflowsText(
                    settingsOpenApiProfile.pinnedWorkflows
                  )}
                  toolAllowListText={formatToolNameListText(settingsOpenApiProfile.toolAllowList)}
                  toolDenyListText={formatToolNameListText(settingsOpenApiProfile.toolDenyList)}
                  validation={validation}
                  importing={importingOpenApi}
                  t={t}
                  onProfileNameChange={(value) => onPatchActiveOpenApiProfile({ name: value })}
                  onBaseUrlChange={(value) => onPatchActiveOpenApiProfile({ baseUrl: value })}
                  onDocumentChange={(value) => onPatchActiveOpenApiProfile({ document: value })}
                  onTimeoutMsChange={(value) => onPatchActiveOpenApiProfile({ timeoutMs: value })}
                  onMaxRetriesChange={(value) => onPatchActiveOpenApiProfile({ maxRetries: value })}
                  onRetryBackoffMsChange={(value) =>
                    onPatchActiveOpenApiProfile({ retryBackoffMs: value })
                  }
                  onPromptTemplateChange={(value) =>
                    onPatchActiveOpenApiProfile({ promptTemplate: value })
                  }
                  onPinnedWorkflowsTextChange={(value) =>
                    onPatchActiveOpenApiProfile({
                      pinnedWorkflows: parsePinnedWorkflowsText(value)
                    })
                  }
                  onToolAllowListTextChange={(value) =>
                    onPatchActiveOpenApiProfile({
                      toolAllowList: parseToolNameListText(value)
                    })
                  }
                  onToolDenyListTextChange={(value) =>
                    onPatchActiveOpenApiProfile({
                      toolDenyList: parseToolNameListText(value)
                    })
                  }
                  onImportFile={() => void onImportOpenApiDocument()}
                  onClearDocument={() => onPatchActiveOpenApiProfile({ document: '' })}
                />
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2">
                <Button type="button" onClick={() => void onSaveOpenApiEditor()}>
                  {saved ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : (
                    <BotIcon data-icon="inline-start" />
                  )}
                  {saved ? t.settings.saved : t.settings.saveSettings}
                </Button>
              </div>
            </div>
          ) : instructionEditorOpen && selectedInstructionFile ? (
            <div className="app-sheet-detail flex w-[560px] shrink-0 flex-col overflow-hidden rounded-md border bg-background">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {t.settings.instructionFiles}: {selectedInstructionFile.name}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {selectedInstructionFile.path}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.common.close}
                  title={t.common.close}
                  onClick={() => onInstructionEditorOpenChange(false)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
                <FieldGroup className="gap-4">
                  <Field>
                    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/10 p-3">
                      <div className="min-w-0 space-y-1">
                        <div className="truncate text-sm font-medium">
                          {selectedInstructionFile.name}
                        </div>
                        <FieldDescription>
                          {selectedInstructionFile.exists
                            ? t.settings.instructionFileExists
                            : t.settings.instructionFileNew}
                        </FieldDescription>
                      </div>
                      <Badge variant="secondary" className="h-5 shrink-0 tabular-nums text-[10px]">
                        {t.settings.instructionFileCharCount.replace(
                          '{n}',
                          String(instructionContent.trim().length)
                        )}
                      </Badge>
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="instruction-content">
                      {t.settings.instructionFiles}
                    </FieldLabel>
                    <Textarea
                      id="instruction-content"
                      className="min-h-[420px] resize-y font-mono text-xs"
                      value={instructionContent}
                      onChange={(event) => onInstructionContentChange(event.target.value)}
                      placeholder={t.settings.instructionFilePlaceholder}
                    />
                    <FieldDescription>{selectedInstructionFile.path}</FieldDescription>
                  </Field>
                </FieldGroup>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2">
                <Button type="button" onClick={() => void onSaveInstructionFile()}>
                  {instructionSaved ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : (
                    <FileTextIcon data-icon="inline-start" />
                  )}
                  {instructionSaved
                    ? t.settings.instructionFileSaved
                    : t.settings.saveInstructionFile}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
