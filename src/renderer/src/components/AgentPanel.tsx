import { type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import {
  ArrowUpIcon,
  FileIcon,
  FolderOpenIcon,
  Loader2Icon,
  MicIcon,
  MicOffIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PlusIcon,
  TriangleAlertIcon
} from 'lucide-react'

import { AgentLogList } from '@renderer/components/AgentLogList'
import { AgentReferenceBadges } from '@renderer/components/AgentReferenceBadges'
import { ConnectionClarifyCard } from '@renderer/components/ConnectionClarifyCard'
import {
  PasswordPromptInlineCard,
  type PasswordPromptRequest
} from '@renderer/components/AppModals'
import { SlashCommandMenu } from '@renderer/components/SlashCommandMenu'
import { StatusDot, TerminalActivityDot } from '@renderer/components/StatusIndicators'
import { Button } from '@renderer/components/ui/button'
import type { ConnectionClarifyConfirmPayload } from '@renderer/lib/connection-route'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import type { Dictionary } from '@renderer/i18n'
import type { SlashCommandOption } from '@renderer/lib/slash-commands'
import {
  getSessionDisplayTitle,
  getSessionGroupId,
  getTerminalDisplayTitle,
  type AgentLogEntry,
  type AgentRunViewState,
  type AgentTerminalTab
} from '@renderer/lib/terminal-tabs'
import { buildModelSelectionValue } from '@renderer/lib/app-runtime'
import type { AgentModelOption, AgentPinnedWorkflow } from '../../../shared/agent-types'

export function AgentPanel({
  sessionChatTab,
  sessionChatTabs,
  sessionTerminals,
  activeTab,
  tabs,
  agentLogRef,
  agentInputRef,
  slashCommandListRef,
  slashMenuVisible,
  slashCommandOptions,
  selectedSlashCommandIndex,
  terminalPaneFirst,
  terminalHidden,
  activeModel,
  activeModelSelectionValue,
  activeTabModelId,
  visibleModels,
  aiState,
  aiStatusText,
  modelValidationError,
  configured,
  activeAgentPending,
  executionTerminalId,
  pinnedWorkflows,
  connectionRecovery,
  t,
  onCopyEntry,
  onCopyResult,
  onExportResult,
  onExportFull,
  onExportTrace,
  onOpsFeedback,
  feedbackByLogId,
  feedbackBusyLogId,
  liveRunByLogId,
  onResolveApproval,
  onAddCommandToWhitelist,
  onInjectSuggestions,
  onOpenModelSettings,
  onClarifyConfirm,
  onClarifyDismiss,
  onToggleTerminalPane,
  onSelectSession,
  onSelectTerminal,
  onModelChange,
  onSubmit,
  onInsertSlashCommand,
  onInsertPinnedWorkflow,
  onAgentInputChange,
  onAgentInputKeyDown,
  onAgentInputPaste,
  onRemoveSkill,
  onRemovePath,
  onRemoveTool,
  onRemoveWiki,
  onPickPathReference,
  onToggleVoiceInput,
  voiceInputState = 'idle',
  voiceInputSupported = true,
  voiceInputSupportChecking = false,
  voiceWhisperSupported = true,
  onStopAgent,
  onRetryConnection,
  onReinitTerminal,
  onOpenConnections,
  passwordPromptRequest = null,
  passwordPromptValue = '',
  passwordPromptError = '',
  passwordPromptInputRef,
  onPasswordPromptChange,
  onPasswordPromptCancel,
  onPasswordPromptSubmit,
  onSaveAsSop,
  hasEarlierLogs,
  loadingEarlier,
  onLoadEarlier
}: {
  sessionChatTab: AgentTerminalTab
  sessionChatTabs: AgentTerminalTab[]
  sessionTerminals: AgentTerminalTab[]
  activeTab: AgentTerminalTab
  tabs: AgentTerminalTab[]
  agentLogRef: RefObject<HTMLDivElement | null>
  agentInputRef?: RefObject<HTMLTextAreaElement | null>
  slashCommandListRef: RefObject<HTMLDivElement | null>
  slashMenuVisible: boolean
  slashCommandOptions: SlashCommandOption[]
  selectedSlashCommandIndex: number
  terminalPaneFirst: boolean
  terminalHidden: boolean
  activeModel?: AgentModelOption
  activeModelSelectionValue: string
  activeTabModelId: string
  visibleModels: AgentModelOption[]
  aiState: 'ready' | 'pending' | 'not-ready'
  aiStatusText: string
  modelValidationError?: string
  configured: boolean
  activeAgentPending: boolean
  executionTerminalId?: string
  pinnedWorkflows: AgentPinnedWorkflow[]
  connectionRecovery?: {
    visible: boolean
    canRetry: boolean
    connecting?: boolean
    pipeFallback?: boolean
    reason?: string
  }
  t: Dictionary
  onCopyEntry: (entry: AgentLogEntry) => void
  onCopyResult: (entry: AgentLogEntry) => void
  onExportResult: (entry: AgentLogEntry) => void
  onExportFull: (entry: AgentLogEntry) => void
  onExportTrace: (entry: AgentLogEntry) => void
  onOpsFeedback: (entry: AgentLogEntry, rating: 'like' | 'dislike') => void
  feedbackByLogId?: Record<number, 'like' | 'dislike'>
  feedbackBusyLogId?: number | null
  liveRunByLogId?: Record<number, AgentRunViewState>
  onResolveApproval?: (requestId: string, approved: boolean, note?: string) => void
  onAddCommandToWhitelist?: (command: string) => void
  onInjectSuggestions?: (texts: string[]) => void
  onOpenModelSettings?: () => void
  onClarifyConfirm?: (payload: ConnectionClarifyConfirmPayload) => void
  onClarifyDismiss?: () => void
  onToggleTerminalPane: () => void
  onSelectSession: (groupId: string) => void
  onSelectTerminal: (tabId: string) => void
  onModelChange: (selection: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onInsertSlashCommand: (option: SlashCommandOption) => void
  onInsertPinnedWorkflow: (workflow: AgentPinnedWorkflow) => void
  onAgentInputChange: (value: string) => void
  onAgentInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onAgentInputPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onRemoveSkill: (id: string) => void
  onRemovePath: (id: string) => void
  onRemoveTool: (id: string) => void
  onRemoveWiki: (id: string) => void
  onPickPathReference: (kind: 'file' | 'directory') => void
  onToggleVoiceInput?: () => void
  voiceInputState?: 'idle' | 'recording' | 'transcribing'
  voiceInputSupported?: boolean
  voiceInputSupportChecking?: boolean
  voiceWhisperSupported?: boolean
  onStopAgent: () => void
  onRetryConnection?: () => void
  onReinitTerminal?: () => void
  onOpenConnections?: () => void
  passwordPromptRequest?: PasswordPromptRequest | null
  passwordPromptValue?: string
  passwordPromptError?: string
  passwordPromptInputRef?: RefObject<HTMLInputElement | null>
  onPasswordPromptChange?: (value: string) => void
  onPasswordPromptCancel?: () => void
  onPasswordPromptSubmit?: (event: FormEvent<HTMLFormElement>) => void
  onSaveAsSop?: (entry: AgentLogEntry) => void
  hasEarlierLogs?: boolean
  loadingEarlier?: boolean
  onLoadEarlier?: () => void | Promise<void>
}): React.JSX.Element {
  const footerStatusText =
    voiceInputState === 'recording'
      ? t.input.voiceListening
      : voiceInputState === 'transcribing'
        ? t.input.voiceTranscribing
        : sessionChatTab.agentThinking
          ? sessionChatTab.thinkingMessage || t.input.thinking
          : sessionChatTab.agentBusy
            ? t.input.contextHint
            : sessionTerminals.length > 1
              ? `${t.input.currentTerminal}: ${getTerminalDisplayTitle(activeTab, tabs)}`
              : t.input.currentTerminal
  const showSendButton =
    activeAgentPending || sessionChatTab.agentBusy || Boolean(sessionChatTab.agentInput.trim())

  return (
    <aside className="app-agent-pane flex min-h-0 min-w-[360px] flex-1 flex-col">
      <AgentLogList
        logRef={agentLogRef}
        entries={sessionChatTab.agentLog}
        tabId={sessionChatTab.id}
        liveRunByLogId={liveRunByLogId}
        copiedLogId={sessionChatTab.copiedLogId}
        thinking={sessionChatTab.agentThinking}
        thinkingMessage={sessionChatTab.thinkingMessage}
        connectionRecovery={connectionRecovery}
        t={t}
        onCopyEntry={onCopyEntry}
        onCopyResult={onCopyResult}
        onExportResult={onExportResult}
        onExportFull={onExportFull}
        onExportTrace={onExportTrace}
        onOpsFeedback={onOpsFeedback}
        onResolveApproval={onResolveApproval}
        onAddCommandToWhitelist={onAddCommandToWhitelist}
        onInjectSuggestions={onInjectSuggestions}
        feedbackByLogId={feedbackByLogId}
        feedbackBusyLogId={feedbackBusyLogId}
        onRetryConnection={onRetryConnection}
        onReinitTerminal={onReinitTerminal}
        onOpenConnections={onOpenConnections}
        onOpenModelSettings={onOpenModelSettings}
        onSaveAsSop={onSaveAsSop}
        hasEarlierLogs={hasEarlierLogs}
        loadingEarlier={loadingEarlier}
        onLoadEarlier={onLoadEarlier}
      />
      {sessionChatTab.pendingClarification?.kind === 'connection-intent' &&
      onClarifyConfirm &&
      onClarifyDismiss ? (
        <ConnectionClarifyCard
          key={`${sessionChatTab.pendingClarification.originalInput}:${sessionChatTab.pendingClarification.defaultOptionId ?? ''}`}
          clarification={sessionChatTab.pendingClarification}
          t={t}
          onConfirm={onClarifyConfirm}
          onDismiss={onClarifyDismiss}
        />
      ) : null}
      {passwordPromptRequest &&
      passwordPromptInputRef &&
      onPasswordPromptChange &&
      onPasswordPromptCancel &&
      onPasswordPromptSubmit ? (
        <div className="shrink-0 border-t bg-background px-4 pt-3">
          <PasswordPromptInlineCard
            request={passwordPromptRequest}
            t={t}
            value={passwordPromptValue}
            error={passwordPromptError}
            inputRef={passwordPromptInputRef}
            onChange={onPasswordPromptChange}
            onCancel={onPasswordPromptCancel}
            onSubmit={onPasswordPromptSubmit}
          />
        </div>
      ) : null}
      <div className="app-input-dock space-y-3 bg-background p-4">
        <form onSubmit={onSubmit} className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={terminalHidden ? t.app.showTerminal : t.app.hideTerminal}
              title={terminalHidden ? t.app.showTerminal : t.app.hideTerminal}
              onClick={onToggleTerminalPane}
            >
              {terminalHidden ? (
                terminalPaneFirst ? (
                  <PanelLeftOpenIcon aria-hidden="true" />
                ) : (
                  <PanelRightOpenIcon aria-hidden="true" />
                )
              ) : terminalPaneFirst ? (
                <PanelLeftCloseIcon aria-hidden="true" />
              ) : (
                <PanelRightCloseIcon aria-hidden="true" />
              )}
            </Button>
            <Select
              key={getSessionGroupId(sessionChatTab)}
              value={getSessionGroupId(sessionChatTab)}
              onValueChange={onSelectSession}
              disabled={sessionChatTabs.length === 0}
            >
              <SelectTrigger className="h-8 min-w-0 flex-1 gap-1.5" title={t.input.sessionLabel}>
                <SelectValue aria-label={t.input.sessionLabel}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">
                      {getSessionDisplayTitle(sessionChatTab, tabs, activeTab.id)}
                    </span>
                    {sessionTerminals.length > 1 && (
                      <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 py-0 text-[10px] font-medium text-primary">
                        {t.input.sessionPeerCount.replace(
                          '{count}',
                          String(sessionTerminals.length)
                        )}
                      </span>
                    )}
                    {activeAgentPending && <StatusDot state="pending" title={t.app.running} />}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t.input.sessionLabel}</SelectLabel>
                  {sessionChatTabs.map((tab) => (
                    <SelectItem key={getSessionGroupId(tab)} value={getSessionGroupId(tab)}>
                      {getSessionDisplayTitle(tab, tabs)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {sessionTerminals.length > 1 && (
              <Select value={activeTab.id} onValueChange={onSelectTerminal}>
                <SelectTrigger
                  className="h-8 min-w-0 flex-1 gap-1.5"
                  title={t.input.sessionTerminalLabel}
                >
                  <SelectValue aria-label={t.input.sessionTerminalLabel}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <TerminalActivityDot
                        active={activeTab.terminalReady}
                        executing={
                          Boolean(executionTerminalId) &&
                          activeTab.id === executionTerminalId &&
                          activeAgentPending
                        }
                      />
                      <span className="truncate">{getTerminalDisplayTitle(activeTab, tabs)}</span>
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t.input.sessionTerminalLabel}</SelectLabel>
                    {sessionTerminals.map((tab) => {
                      const executing =
                        Boolean(executionTerminalId) &&
                        tab.id === executionTerminalId &&
                        activeAgentPending
                      return (
                        <SelectItem key={tab.id} value={tab.id}>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <TerminalActivityDot active={tab.terminalReady} executing={executing} />
                            <span className="truncate">{getTerminalDisplayTitle(tab, tabs)}</span>
                            {executing && (
                              <span className="shrink-0 text-[10px] text-primary">
                                {t.app.running}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
            <Select
              value={activeModelSelectionValue}
              onValueChange={onModelChange}
              disabled={visibleModels.length === 0}
            >
              <SelectTrigger className="h-8 min-w-0 flex-1" title={aiStatusText}>
                <span className="sr-only">
                  <SelectValue aria-label={t.app.model} />
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot state={aiState} title={aiStatusText} />
                  <span className="truncate">
                    {activeModel
                      ? `${activeModel.name} · ${activeModel.providerName}`
                      : activeTabModelId}
                  </span>
                  {modelValidationError && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="pointer-events-auto inline-flex shrink-0"
                            aria-label={`${t.app.aiNotReady}: ${modelValidationError}`}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <TriangleAlertIcon
                              className="size-3.5 text-destructive"
                              aria-hidden="true"
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs break-words">
                          {modelValidationError}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t.app.model}</SelectLabel>
                  {visibleModels.map((model) => (
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
          </div>
          <div className="relative rounded-lg border bg-background/95 p-2 shadow-sm">
            <SlashCommandMenu
              visible={slashMenuVisible}
              listRef={slashCommandListRef}
              options={slashCommandOptions}
              selectedIndex={selectedSlashCommandIndex}
              t={t}
              onSelect={onInsertSlashCommand}
            />
            <AgentReferenceBadges
              skillRefs={sessionChatTab.skillRefs}
              pathRefs={sessionChatTab.pathRefs}
              toolRefs={sessionChatTab.toolRefs}
              wikiRefs={sessionChatTab.wikiRefs}
              t={t}
              onRemoveSkill={onRemoveSkill}
              onRemovePath={onRemovePath}
              onRemoveTool={onRemoveTool}
              onRemoveWiki={onRemoveWiki}
            />
            {pinnedWorkflows.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1">
                <span className="text-[11px] text-muted-foreground">{t.input.pinnedWorkflows}</span>
                {pinnedWorkflows.map((workflow) => (
                  <Button
                    key={workflow.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 max-w-[180px] truncate px-2 text-[11px]"
                    title={workflow.prompt}
                    aria-label={`${t.input.insertPinnedWorkflow}: ${workflow.name}`}
                    onClick={() => onInsertPinnedWorkflow(workflow)}
                  >
                    {workflow.name}
                  </Button>
                ))}
              </div>
            ) : null}
            <Textarea
              ref={agentInputRef}
              value={sessionChatTab.agentInput}
              onChange={(event) => onAgentInputChange(event.target.value)}
              onKeyDown={onAgentInputKeyDown}
              onPaste={onAgentInputPaste}
              placeholder={t.input.askPlaceholder}
              className="max-h-40 min-h-20 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex items-center gap-2 px-1 pt-2 text-xs text-muted-foreground">
              <div className="flex min-h-5 min-w-0 flex-1 items-center">
                <span className="truncate">{footerStatusText || '\u00a0'}</span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.input.referenceFile}
                  title={t.input.referenceFile}
                  onClick={() => onPickPathReference('file')}
                >
                  <FileIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.input.referenceDirectory}
                  title={t.input.referenceDirectory}
                  onClick={() => onPickPathReference('directory')}
                >
                  <FolderOpenIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant={voiceInputState === 'recording' ? 'destructive' : 'ghost'}
                  size="icon-xs"
                  aria-label={
                    voiceInputSupportChecking
                      ? t.input.voiceSupportChecking
                      : !voiceInputSupported
                        ? t.input.voiceUnsupported
                        : voiceInputState === 'recording'
                          ? t.input.voiceStop
                          : voiceInputState === 'transcribing'
                            ? t.input.voiceTranscribing
                            : !voiceWhisperSupported
                              ? t.input.voiceStartSpeechOnly
                              : t.input.voiceStart
                  }
                  title={
                    voiceInputSupportChecking
                      ? t.input.voiceSupportChecking
                      : !voiceInputSupported
                        ? t.input.voiceUnsupported
                        : voiceInputState === 'recording'
                          ? t.input.voiceStop
                          : voiceInputState === 'transcribing'
                            ? t.input.voiceTranscribing
                            : !voiceWhisperSupported
                              ? t.input.voiceStartSpeechOnly
                              : t.input.voiceStart
                  }
                  disabled={
                    !onToggleVoiceInput ||
                    voiceInputSupportChecking ||
                    !voiceInputSupported ||
                    voiceInputState === 'transcribing' ||
                    sessionChatTab.agentThinking
                  }
                  onClick={() => onToggleVoiceInput?.()}
                >
                  {voiceInputSupportChecking || voiceInputState === 'transcribing' ? (
                    <Loader2Icon className="animate-spin" aria-hidden="true" />
                  ) : voiceInputState === 'recording' ? (
                    <MicOffIcon aria-hidden="true" />
                  ) : (
                    <MicIcon
                      aria-hidden="true"
                      className={!voiceInputSupported ? 'opacity-40' : undefined}
                    />
                  )}
                </Button>
                <span className="whitespace-nowrap">
                  {configured ? t.input.toolsConfigured : t.input.chatNoTools}
                </span>
                <div className="flex h-5 w-[3.75rem] shrink-0 items-center justify-end">
                  {sessionChatTab.agentBusy ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      className="h-5 px-2 text-[11px]"
                      onClick={onStopAgent}
                    >
                      {t.common.stop}
                    </Button>
                  ) : null}
                </div>
                <Button
                  type="submit"
                  size="icon"
                  className={`h-5 w-5 ${showSendButton ? undefined : 'invisible'}`}
                  tabIndex={showSendButton ? undefined : -1}
                  aria-hidden={showSendButton ? undefined : true}
                  aria-label={
                    sessionChatTab.agentThinking
                      ? t.input.thinking
                      : sessionChatTab.agentBusy
                        ? t.input.contextAdd
                        : t.common.send
                  }
                  disabled={!showSendButton || sessionChatTab.agentThinking}
                >
                  {sessionChatTab.agentThinking ||
                  (sessionChatTab.agentBusy && !sessionChatTab.agentInput.trim()) ? (
                    <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : sessionChatTab.agentBusy ? (
                    <PlusIcon className="size-3.5" aria-hidden="true" />
                  ) : (
                    <ArrowUpIcon className="size-3.5" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </aside>
  )
}
