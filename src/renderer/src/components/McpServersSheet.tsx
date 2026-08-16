import { type KeyboardEvent, useMemo, useState } from 'react'
import { CheckIcon, PlugIcon, PlusIcon, PowerIcon, Trash2Icon, XIcon } from 'lucide-react'

import { StatusDot } from '@renderer/components/StatusIndicators'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import { Textarea } from '@renderer/components/ui/textarea'
import type { Dictionary } from '@renderer/i18n'
import { getMcpServerStatus, mcpJsonErrorMessage } from '@renderer/lib/mcp-status'
import type {
  AgentMcpServerConfig,
  AgentValidationResult,
  ToolCatalogEntry
} from '../../../shared/agent-types'
import {
  applyCursorServerPatch,
  deleteMcpServer,
  mergeMcpServers,
  parseCursorServerEntry,
  parseMcpServersJson,
  summarizeMcpServerEndpoint,
  toCursorServerEntry
} from '../../../shared/mcp-servers'
import { formatToolNameListText, parseToolNameListText } from '../../../shared/tool-policy'

const JSON_EDITOR_CLASS = 'min-h-24 resize-y font-mono text-xs leading-relaxed'

interface McpServersSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  t: Dictionary
  servers: AgentMcpServerConfig[]
  selectedServerId: string
  validation: AgentValidationResult | undefined
  validating: boolean
  saved: boolean
  onServersChange: (servers: AgentMcpServerConfig[]) => void
  onSelectedServerIdChange: (id: string) => void
  onSave: (servers: AgentMcpServerConfig[]) => void | Promise<void>
}

export function McpServersSheet({
  open,
  onOpenChange,
  t,
  servers,
  selectedServerId,
  validation,
  validating,
  saved,
  onServersChange,
  onSelectedServerIdChange,
  onSave
}: McpServersSheetProps): React.JSX.Element {
  const [editorOpen, setEditorOpen] = useState(false)
  const [pasteJson, setPasteJson] = useState('')
  const [pasteError, setPasteError] = useState('')
  const [detailDrafts, setDetailDrafts] = useState<Record<string, string>>({})
  const [detailError, setDetailError] = useState('')

  const selectedServer =
    servers.find((server) => server.id === selectedServerId) ?? servers[0] ?? undefined
  const selectedId = selectedServer?.id ?? ''
  const toolsByServer = useMemo(() => groupMcpValidationTools(validation?.tools), [validation])
  const selectedTools = selectedId ? (toolsByServer.get(selectedId) ?? []) : []
  const detailJson = selectedServer
    ? (detailDrafts[selectedServer.id] ?? formatCursorServerJson(selectedServer))
    : ''
  const detailVisible = editorOpen && Boolean(selectedServer)

  function setDetailJson(value: string): void {
    if (!selectedServer) return
    setDetailDrafts((current) => ({ ...current, [selectedServer.id]: value }))
  }

  function toggleDetails(serverId: string): void {
    if (editorOpen && selectedServerId === serverId) {
      setEditorOpen(false)
      return
    }
    onSelectedServerIdChange(serverId)
    setEditorOpen(true)
  }

  function addFromJson(): void {
    const parsed = parseMcpServersJson(pasteJson)
    if (!parsed.ok) {
      setPasteError(mcpJsonErrorMessage(parsed.error, t))
      return
    }
    const merged = mergeMcpServers(servers, parsed.servers)
    onServersChange(merged)
    const last = parsed.servers[parsed.servers.length - 1]
    if (last) {
      onSelectedServerIdChange(last.id)
      setEditorOpen(true)
      setDetailDrafts((current) => ({
        ...current,
        [last.id]: formatCursorServerJson(last)
      }))
      setDetailError('')
    }
    setPasteJson('')
    setPasteError('')
  }

  function applyDetailJson(): boolean {
    if (!selectedServer) return false
    const parsed = parseCursorServerEntry(detailJson)
    if (!parsed.ok) {
      setDetailError(mcpJsonErrorMessage(parsed.error, t))
      return false
    }
    onServersChange(
      servers.map((server) =>
        server.id === selectedServer.id ? applyCursorServerPatch(server, parsed.patch) : server
      )
    )
    setDetailError('')
    return true
  }

  function updateSelected<K extends keyof AgentMcpServerConfig>(
    key: K,
    value: AgentMcpServerConfig[K]
  ): void {
    if (!selectedServer) return
    onServersChange(
      servers.map((server) =>
        server.id === selectedServer.id ? { ...server, [key]: value } : server
      )
    )
  }

  function toggleEnabled(serverId: string, enabled: boolean): void {
    onServersChange(
      servers.map((server) => (server.id === serverId ? { ...server, enabled } : server))
    )
  }

  function removeServer(serverId: string): void {
    const target = servers.find((server) => server.id === serverId)
    const label = target?.name || target?.id || serverId
    if (!window.confirm(`${t.confirm.deleteMcpServer}\n\n${label}`)) return
    const remaining = deleteMcpServer(servers, serverId)
    onServersChange(remaining)
    if (selectedServerId === serverId) {
      onSelectedServerIdChange(remaining[0]?.id ?? '')
      setEditorOpen(false)
    }
    setDetailDrafts((current) => {
      const next = { ...current }
      delete next[serverId]
      return next
    })
  }

  async function save(): Promise<void> {
    let nextServers = servers
    if (editorOpen && selectedServer) {
      const parsed = parseCursorServerEntry(detailJson)
      if (!parsed.ok) {
        setDetailError(mcpJsonErrorMessage(parsed.error, t))
        return
      }
      nextServers = servers.map((server) =>
        server.id === selectedServer.id ? applyCursorServerPatch(server, parsed.patch) : server
      )
      onServersChange(nextServers)
      setDetailError('')
    }
    await onSave(nextServers)
  }

  function handleSheetKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
      return
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === 'Enter' &&
      (event.target as HTMLElement | null)?.id === 'mcp-paste-json'
    ) {
      event.preventDefault()
      addFromJson()
    }
  }

  const saveButton = (
    <Button type="button" size="sm" onClick={() => void save()}>
      {saved ? <CheckIcon data-icon="inline-start" /> : <PlugIcon data-icon="inline-start" />}
      {saved ? t.settings.saved : t.settings.saveSettings}
    </Button>
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) setEditorOpen(false)
      }}
    >
      <SheetContent
        side="right"
        className={`w-full ${detailVisible ? 'sm:max-w-5xl' : 'sm:max-w-2xl'}`}
        onKeyDown={handleSheetKeyDown}
      >
        <SheetHeader>
          <SheetTitle>{t.settings.mcpServers}</SheetTitle>
          <SheetDescription>{t.settings.mcpServersHint}</SheetDescription>
        </SheetHeader>
        <div className="app-sheet-split flex min-h-0 flex-1 flex-row-reverse gap-3 overflow-hidden px-4">
          <div className="app-sheet-main min-w-0 flex-1 space-y-3 overflow-auto overscroll-contain">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-muted-foreground">
                {t.settings.mcpServerList} · {servers.length}
              </div>
              {detailVisible ? null : saveButton}
            </div>
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="mcp-paste-json">{t.settings.mcpPasteJson}</FieldLabel>
                <Button type="button" variant="outline" size="xs" onClick={addFromJson}>
                  <PlusIcon data-icon="inline-start" />
                  {t.settings.mcpAddFromJson}
                </Button>
              </div>
              <Textarea
                id="mcp-paste-json"
                className={JSON_EDITOR_CLASS}
                value={pasteJson}
                onChange={(event) => {
                  setPasteJson(event.target.value)
                  if (pasteError) setPasteError('')
                }}
                placeholder={t.settings.mcpPasteJsonPlaceholder}
                spellCheck={false}
              />
              <FieldDescription>{t.settings.mcpPasteJsonHint}</FieldDescription>
              {pasteError ? (
                <div className="text-xs text-destructive" role="alert">
                  {pasteError}
                </div>
              ) : null}
            </Field>
            {servers.length === 0 ? (
              <div className="rounded-md border bg-muted/10 p-3 text-xs text-muted-foreground">
                <PlugIcon className="mr-2 inline size-3" aria-hidden="true" />
                {t.settings.noMcpServers}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {servers.map((server) => {
                  const toolCount = toolsByServer.get(server.id)?.length ?? 0
                  const status = getMcpServerStatus(server, validation, validating, toolCount, t)
                  const selected = editorOpen && selectedServerId === server.id
                  const enableLabel = server.enabled
                    ? t.settings.disableMcpServer
                    : t.settings.enableMcpServer

                  return (
                    <div
                      key={server.id}
                      className={`flex min-w-0 flex-col rounded-lg border bg-card/70 px-2.5 py-2 text-xs transition-[border-color,background-color] hover:bg-muted/25 ${
                        selected ? 'border-primary/50 bg-primary/8' : 'border-border/70'
                      }`}
                    >
                      <div className="flex min-w-0 items-start gap-1">
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          onClick={() => toggleDetails(server.id)}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <StatusDot state={status.state} title={status.label} />
                            <span className="truncate text-[13px] font-medium">
                              {server.name || server.id}
                            </span>
                            <Badge
                              variant="secondary"
                              className="h-4 shrink-0 px-1.5 font-mono text-[10px]"
                            >
                              {server.transport}
                            </Badge>
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                            {summarizeMcpServerEndpoint(server)}
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="tabular-nums">
                              {t.settings.mcpToolCount}: {toolCount}
                            </span>
                            <span>·</span>
                            <span
                              className={
                                status.state === 'not-ready' ? 'text-destructive' : undefined
                              }
                              title={status.label}
                            >
                              {status.label}
                            </span>
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={enableLabel}
                            title={enableLabel}
                            onClick={(event) => {
                              event.stopPropagation()
                              onSelectedServerIdChange(server.id)
                              toggleEnabled(server.id, !server.enabled)
                            }}
                          >
                            <PowerIcon
                              className={server.enabled ? 'text-primary' : 'text-muted-foreground'}
                              aria-hidden="true"
                            />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={t.settings.deleteMcpServer}
                            title={t.settings.deleteMcpServer}
                            onClick={(event) => {
                              event.stopPropagation()
                              removeServer(server.id)
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
          </div>
          {detailVisible && selectedServer ? (
            <div className="app-sheet-detail flex w-[560px] shrink-0 flex-col overflow-hidden rounded-md border bg-background">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {selectedServer.name || selectedServer.id}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {selectedServer.id}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.common.close}
                  title={t.common.close}
                  onClick={() => setEditorOpen(false)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
                <FieldGroup className="gap-3">
                  <label
                    htmlFor="mcp-enabled"
                    className="flex items-center justify-between gap-3 px-0.5 py-0.5"
                  >
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium">{t.settings.mcpEnabled}</span>
                      <FieldDescription>{t.settings.mcpEnabledHint}</FieldDescription>
                    </span>
                    <Input
                      id="mcp-enabled"
                      type="checkbox"
                      checked={selectedServer.enabled}
                      onChange={(event) => updateSelected('enabled', event.target.checked)}
                      className="size-4 shrink-0 accent-primary"
                    />
                  </label>
                  <Field>
                    <FieldLabel htmlFor="mcp-config-json">{t.settings.mcpConfigJson}</FieldLabel>
                    <Textarea
                      id="mcp-config-json"
                      className={`${JSON_EDITOR_CLASS} min-h-36`}
                      value={detailJson}
                      onChange={(event) => {
                        setDetailJson(event.target.value)
                        if (detailError) setDetailError('')
                      }}
                      onBlur={() => {
                        applyDetailJson()
                      }}
                      spellCheck={false}
                    />
                    <FieldDescription>{t.settings.mcpConfigJsonHint}</FieldDescription>
                    {detailError ? (
                      <div className="text-xs text-destructive" role="alert">
                        {detailError}
                      </div>
                    ) : null}
                  </Field>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="mcp-tool-allow">
                        {t.settings.mcpToolAllowList}
                      </FieldLabel>
                      <Textarea
                        id="mcp-tool-allow"
                        className={`${JSON_EDITOR_CLASS} min-h-16`}
                        value={formatToolNameListText(selectedServer.toolAllowList)}
                        onChange={(event) =>
                          updateSelected('toolAllowList', parseToolNameListText(event.target.value))
                        }
                        placeholder={t.settings.toolNameListPlaceholder}
                      />
                      <FieldDescription>{t.settings.mcpToolAllowListHint}</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="mcp-tool-deny">{t.settings.mcpToolDenyList}</FieldLabel>
                      <Textarea
                        id="mcp-tool-deny"
                        className={`${JSON_EDITOR_CLASS} min-h-16`}
                        value={formatToolNameListText(selectedServer.toolDenyList)}
                        onChange={(event) =>
                          updateSelected('toolDenyList', parseToolNameListText(event.target.value))
                        }
                        placeholder={t.settings.toolNameListPlaceholder}
                      />
                      <FieldDescription>{t.settings.mcpToolDenyListHint}</FieldDescription>
                    </Field>
                  </div>
                  <Field>
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel>{t.settings.mcpTools}</FieldLabel>
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {selectedTools.length}
                      </span>
                    </div>
                    {selectedTools.length === 0 ? (
                      <div className="rounded-md border bg-muted/10 p-2.5 text-xs text-muted-foreground">
                        {t.settings.noMcpTools}
                      </div>
                    ) : (
                      <div className="max-h-56 overflow-auto rounded-md border">
                        {selectedTools.map((tool) => (
                          <div
                            key={`${tool.method}:${tool.path}:${tool.name}`}
                            className="min-w-0 border-b px-2.5 py-1.5 text-xs last:border-b-0"
                          >
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <span className="min-w-0 truncate font-medium">{tool.name}</span>
                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                {tool.method.toUpperCase()}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                              {tool.path}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Field>
                </FieldGroup>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => removeServer(selectedServer.id)}
                >
                  <Trash2Icon data-icon="inline-start" />
                  {t.settings.deleteMcpServer}
                </Button>
                {saveButton}
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function formatCursorServerJson(server: AgentMcpServerConfig): string {
  return `${JSON.stringify(toCursorServerEntry(server), null, 2)}\n`
}

function groupMcpValidationTools(
  tools: ToolCatalogEntry[] | undefined
): Map<string, ToolCatalogEntry[]> {
  const grouped = new Map<string, ToolCatalogEntry[]>()
  for (const tool of tools ?? []) {
    const match = /^mcp:\/\/([^/]+)\//.exec(tool.path)
    if (!match) continue
    const serverTools = grouped.get(match[1]) ?? []
    serverTools.push(tool)
    grouped.set(match[1], serverTools)
  }
  return grouped
}
