import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState
} from 'react'
import {
  ArrowUpIcon,
  FileIcon,
  FolderOpenIcon,
  Loader2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PaperclipIcon,
  PlusIcon,
  TriangleAlertIcon
} from 'lucide-react'

import { AgentLogList } from '@renderer/components/AgentLogList'
import { ComposerEditor, type ComposerInputHandle } from '@renderer/components/ComposerEditor'
import { ConnectionClarifyCard } from '@renderer/components/ConnectionClarifyCard'
import { SessionUsageBar } from '@renderer/components/SessionUsageBar'
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
import {
  agentStyleHint,
  agentStyleSelectOptions,
  agentStyleTitle
} from '@renderer/lib/agent-style-ui'
import { normalizeAgentStyle, type AgentStyle } from '../../../shared/agent-style'
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
  agentStyle,
  onAgentStyleChange,
  thinkingCollapsedByDefault,
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
  onExportSessionTrace,
  onOpsFeedback,
  feedbackByLogId,
  feedbackBusyLogId,
  savingSopLogId,
  liveRunByLogId,
  onResolveApproval,
  onAddCommandToWhitelist,
  onInjectSuggestions,
  onOpenModelSettings,
  onClarifyConfirm,
  onClarifyDismiss,
  onToggleTerminalPane,
  onHideChatPane,
  onSelectSession,
  onSelectTerminal,
  onModelChange,
  onSubmit,
  onInsertSlashCommand,
  onInsertPinnedWorkflow,
  onAgentInputChange,
  onComposerCaretChange,
  onAgentInputKeyDown,
  onAgentInputPaste,
  onPickPathReference,
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
  onLoadEarlier,
  sessionInputTokens,
  sessionOutputTokens
}: {
  sessionChatTab: AgentTerminalTab
  sessionChatTabs: AgentTerminalTab[]
  sessionTerminals: AgentTerminalTab[]
  activeTab: AgentTerminalTab
  tabs: AgentTerminalTab[]
  agentLogRef: RefObject<HTMLDivElement | null>
  agentInputRef?: RefObject<ComposerInputHandle | null>
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
  agentStyle: AgentStyle
  onAgentStyleChange: (style: AgentStyle) => void
  thinkingCollapsedByDefault: boolean
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
  onExportSessionTrace: () => void
  onOpsFeedback: (entry: AgentLogEntry, rating: 'like' | 'dislike') => void
  feedbackByLogId?: Record<number, 'like' | 'dislike'>
  feedbackBusyLogId?: number | null
  savingSopLogId?: number | null
  liveRunByLogId?: Record<number, AgentRunViewState>
  onResolveApproval?: (requestId: string, approved: boolean, note?: string) => void
  onAddCommandToWhitelist?: (command: string) => void
  onInjectSuggestions?: (texts: string[]) => void
  onOpenModelSettings?: () => void
  onClarifyConfirm?: (payload: ConnectionClarifyConfirmPayload) => void
  onClarifyDismiss?: () => void
  onToggleTerminalPane: () => void
  onHideChatPane: () => void
  onSelectSession: (groupId: string) => void
  onSelectTerminal: (tabId: string) => void
  onModelChange: (selection: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onInsertSlashCommand: (option: SlashCommandOption) => void
  onInsertPinnedWorkflow: (workflow: AgentPinnedWorkflow) => void
  onAgentInputChange: (value: string) => void
  onComposerCaretChange?: (cursor: number) => void
  onAgentInputKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onAgentInputPaste: (event: React.ClipboardEvent<HTMLElement>) => void
  onRemoveSkill: (id: string) => void
  onRemovePath: (id: string) => void
  onRemoveTool: (id: string) => void
  onRemoveWiki: (id: string) => void
  onPickPathReference: (kind: 'file' | 'directory') => void
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
  sessionInputTokens: number
  sessionOutputTokens: number
}): React.JSX.Element {
  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false)
  const referenceMenuRef = useRef<HTMLDivElement | null>(null)
  const showSendButton =
    activeAgentPending || sessionChatTab.agentBusy || Boolean(sessionChatTab.agentInput.trim())

  useEffect(() => {
    if (!referenceMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (referenceMenuRef.current?.contains(event.target as Node)) return
      setReferenceMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setReferenceMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [referenceMenuOpen])

  return (
    <aside className="app-agent-pane relative flex min-h-0 min-w-[360px] flex-1 flex-col">
      <button
        type="button"
        className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 opacity-70 transition-[background-color,color,opacity] hover:bg-muted/60 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={t.app.hideChat}
        title={t.app.hideChat}
        onClick={onHideChatPane}
      >
        {terminalPaneFirst ? (
          <PanelRightCloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <PanelLeftCloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      <AgentLogList
        logRef={agentLogRef}
        entries={sessionChatTab.agentLog}
        tabId={sessionChatTab.id}
        liveRunByLogId={liveRunByLogId}
        copiedLogId={sessionChatTab.copiedLogId}
        thinking={sessionChatTab.agentThinking}
        thinkingMessage={sessionChatTab.thinkingMessage}
        thinkingCollapsedByDefault={thinkingCollapsedByDefault}
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
        savingSopLogId={savingSopLogId}
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
      <div className="app-input-dock space-y-1.5 p-2.5">
        <SessionUsageBar
          inputTokens={sessionInputTokens}
          outputTokens={sessionOutputTokens}
          t={t}
          onExportSessionTrace={onExportSessionTrace}
        />
        <form onSubmit={onSubmit} className="space-y-1.5">
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
          </div>
          <div className="app-composer relative rounded-lg p-1.5">
            <SlashCommandMenu
              visible={slashMenuVisible}
              listRef={slashCommandListRef}
              options={slashCommandOptions}
              selectedIndex={selectedSlashCommandIndex}
              t={t}
              onSelect={onInsertSlashCommand}
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
            <ComposerEditor
              value={sessionChatTab.agentInput}
              placeholder={t.input.askPlaceholder}
              ariaLabel={t.input.askPlaceholder}
              t={t}
              agentInputRef={agentInputRef}
              skillRefs={sessionChatTab.skillRefs}
              wikiRefs={sessionChatTab.wikiRefs}
              toolRefs={sessionChatTab.toolRefs}
              pathRefs={sessionChatTab.pathRefs}
              onChange={onAgentInputChange}
              onCaretChange={onComposerCaretChange}
              onKeyDown={onAgentInputKeyDown}
              onPaste={onAgentInputPaste}
            />
            <div className="app-composer-toolbar flex items-center gap-1.5 text-xs text-muted-foreground">
              <div className="flex min-w-0 flex-1 items-center">
                <Select
                  value={activeModelSelectionValue}
                  onValueChange={onModelChange}
                  disabled={visibleModels.length === 0}
                >
                  <SelectTrigger
                    size="sm"
                    className="app-model-trigger min-w-0 overflow-hidden"
                    aria-label={t.app.model}
                    aria-haspopup="listbox"
                    title={
                      activeModel
                        ? `${activeModel.name} · ${activeModel.providerName} · ${aiStatusText}`
                        : aiStatusText
                    }
                  >
                    <span className="sr-only">
                      <SelectValue aria-label={t.app.model} />
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <StatusDot state={aiState} title={aiStatusText} />
                      <span className="truncate">
                        {activeModel ? activeModel.name : activeTabModelId}
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
                  <SelectContent align="start" position="popper" side="top">
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
                <Select
                  value={normalizeAgentStyle(agentStyle)}
                  onValueChange={(value) => onAgentStyleChange(normalizeAgentStyle(value))}
                >
                  <SelectTrigger
                    size="sm"
                    className="app-model-trigger app-style-trigger relative z-10 shrink-0"
                    aria-label={t.settings.agentStyle}
                    aria-haspopup="listbox"
                    title={agentStyleHint(normalizeAgentStyle(agentStyle), t)}
                  >
                    <span className="truncate">
                      {agentStyleTitle(normalizeAgentStyle(agentStyle), t)}
                    </span>
                  </SelectTrigger>
                  <SelectContent align="start" position="popper" side="top">
                    <SelectGroup>
                      <SelectLabel>{t.settings.agentStyle}</SelectLabel>
                      {agentStyleSelectOptions(t).map((option) => (
                        <SelectItem key={option.id} value={option.id} title={option.description}>
                          {option.title}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="ml-auto flex h-6 shrink-0 items-center gap-1">
                <div className="relative" ref={referenceMenuRef}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="app-composer-icon"
                    aria-label={t.input.reference}
                    title={t.input.reference}
                    aria-haspopup="menu"
                    aria-expanded={referenceMenuOpen}
                    onClick={() => setReferenceMenuOpen((open) => !open)}
                  >
                    <PaperclipIcon aria-hidden="true" />
                  </Button>
                  {referenceMenuOpen ? (
                    <div
                      className="app-reference-menu absolute bottom-full right-0 z-20 mb-1.5"
                      role="menu"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setReferenceMenuOpen(false)
                          onPickPathReference('file')
                        }}
                      >
                        <FileIcon aria-hidden="true" />
                        {t.input.referenceFile}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setReferenceMenuOpen(false)
                          onPickPathReference('directory')
                        }}
                      >
                        <FolderOpenIcon aria-hidden="true" />
                        {t.input.referenceDirectory}
                      </button>
                    </div>
                  ) : null}
                </div>
                {sessionChatTab.agentBusy ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="xs"
                    className="h-6 px-2 text-[11px]"
                    onClick={onStopAgent}
                  >
                    {t.common.stop}
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  size="icon-xs"
                  className={`rounded-full ${showSendButton ? undefined : 'invisible'}`}
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
