import { useEffect, useRef, type MutableRefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'

import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import type { Dictionary } from '@renderer/i18n'
import { appTerminalTheme } from '@renderer/lib/design-system'
import { createCrescentBootstrapFilter, filterCrescentBootstrapOutput, getSubterminalWidths } from '@renderer/lib/terminal-text'
import type { AgentTerminalTab, TemporarySubterminal } from '@renderer/lib/terminal-tabs'

export interface SubterminalResizeState {
  tabId: string
  leftId: string
  rightId: string
  startX: number
  leftStart: number
  rightStart: number
}

export interface SubterminalHeightResizeState {
  startY: number
  startHeight: number
}

function SubterminalXtermPane({
  subterminal,
  shellExitedText
}: {
  subterminal: TemporarySubterminal
  shellExitedText: string
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 11,
      lineHeight: 1.2,
      theme: appTerminalTheme
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    fitAddon.fit()
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    if (subterminal.rawOutput) {
      terminal.write(filterCrescentBootstrapOutput(subterminal.rawOutput))
    }

    const bootstrapFilter = createCrescentBootstrapFilter()
    const inputDisposable = terminal.onData((data) => {
      window.api.terminal.write(data, subterminal.id)
    })

    const stopData = window.api.terminal.onData((event) => {
      if (event.tabId !== subterminal.id) return
      const filtered = bootstrapFilter.push(event.data)
      if (filtered) terminal.write(filtered)
    })

    const stopExit = window.api.terminal.onExit((event) => {
      if (event.tabId !== subterminal.id) return
      terminal.writeln(`\r\n\x1b[31m${shellExitedText} ${event.exitCode}.\x1b[0m`)
    })

    const resizeObserver = new ResizeObserver(() => {
      const addon = fitAddonRef.current
      const term = terminalRef.current
      if (!addon || !term) return
      addon.fit()
      const dimensions = addon.proposeDimensions()
      if (!dimensions) return
      window.api.terminal.resize({
        cols: dimensions.cols,
        rows: dimensions.rows,
        tabId: subterminal.id
      })
    })
    resizeObserver.observe(host)

    return () => {
      inputDisposable.dispose()
      stopData()
      stopExit()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
    // Mount once per subterminal id; live output streams via listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subterminal.id, shellExitedText])

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden bg-black/40" />
}

export function SubterminalPanel({
  activeTab,
  collapsed,
  panelHeight,
  resizeRef,
  heightResizeRef,
  t,
  onCollapsedChange,
  onCloseSubterminal,
  onCloseAllSubterminals,
  onOpenLocalSubterminal
}: {
  activeTab: AgentTerminalTab
  collapsed: boolean
  panelHeight: number
  resizeRef: MutableRefObject<SubterminalResizeState | null>
  heightResizeRef: MutableRefObject<SubterminalHeightResizeState | null>
  t: Dictionary
  onCollapsedChange: (collapsed: boolean) => void
  onCloseSubterminal: (tabId: string, subterminalId: string) => void
  onCloseAllSubterminals: (tabId: string) => void
  onOpenLocalSubterminal?: () => void
}): React.JSX.Element | null {
  if (activeTab.subTerminals.length === 0) {
    if (!onOpenLocalSubterminal) return null
    return (
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-t border-white/10 bg-background/95 px-2">
        <div className="min-w-0 truncate text-xs font-medium text-muted-foreground">
          {t.terminal.temporarySubterminal}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t.terminal.openLocalSubterminal}
          title={t.terminal.openLocalSubterminal}
          onClick={onOpenLocalSubterminal}
        >
          <PlusIcon aria-hidden="true" />
        </Button>
      </div>
    )
  }

  const canOpenMore = activeTab.subTerminals.length < 3

  return (
    <div
      className="shrink-0 border-t border-white/10 bg-background/95"
      style={{
        height: collapsed ? undefined : panelHeight
      }}
    >
      {!collapsed && (
        <div
          className="h-1.5 cursor-row-resize bg-border/60 hover:bg-primary/60"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t.terminal.resizeSubterminalHeight}
          title={t.terminal.resizeSubterminalHeight}
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            heightResizeRef.current = {
              startY: event.clientY,
              startHeight: panelHeight
            }
            document.body.style.cursor = 'row-resize'
            document.body.style.userSelect = 'none'
          }}
        />
      )}
      <div className="flex h-8 items-center justify-between gap-2 border-b px-2">
        <div className="min-w-0 truncate text-xs font-medium">
          {t.terminal.temporarySubterminal} · {activeTab.subTerminals.length}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onOpenLocalSubterminal && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!canOpenMore}
              aria-label={t.terminal.openLocalSubterminal}
              title={
                canOpenMore ? t.terminal.openLocalSubterminal : t.terminal.subterminalLimitReached
              }
              onClick={onOpenLocalSubterminal}
            >
              <PlusIcon aria-hidden="true" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={collapsed ? t.terminal.expandSubterminals : t.terminal.collapseSubterminals}
            title={collapsed ? t.terminal.expandSubterminals : t.terminal.collapseSubterminals}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? (
              <ChevronUpIcon aria-hidden="true" />
            ) : (
              <ChevronDownIcon aria-hidden="true" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label={t.terminal.closeAllSubterminals}
            title={t.terminal.closeAllSubterminals}
            onClick={() => onCloseAllSubterminals(activeTab.id)}
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        </div>
      </div>
      {!collapsed && (
        <div className="h-[calc(100%-2.375rem)] overflow-auto p-2">
          <div className="flex h-full min-w-full gap-0">
            {activeTab.subTerminals.map((subterminal, index) => {
              const widths = getSubterminalWidths(activeTab.subTerminals)
              const width = widths[index]
              const nextSubterminal = activeTab.subTerminals[index + 1]

              return (
                <div
                  key={subterminal.id}
                  className="flex min-w-0"
                  style={{ flexBasis: `${width}%`, flexGrow: 0, flexShrink: 0 }}
                >
                  <section className="flex min-w-0 flex-1 flex-col rounded-md border bg-card text-xs">
                    <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b px-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {t.terminal.subterminal}: {subterminal.name}
                          {subterminal.connectionName ? ` · ${subterminal.connectionName}` : ''}
                        </p>
                        {subterminal.cwd && (
                          <p className="truncate text-[10px] text-muted-foreground">
                            {subterminal.cwd}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge variant={subterminal.status === 'active' ? 'secondary' : 'outline'}>
                          {subterminal.status === 'active'
                            ? t.terminal.subterminalActive
                            : t.terminal.subterminalExited}
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={t.terminal.closeSubterminal}
                          title={t.terminal.closeSubterminal}
                          onClick={() => onCloseSubterminal(activeTab.id, subterminal.id)}
                        >
                          <XIcon aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <SubterminalXtermPane
                      subterminal={subterminal}
                      shellExitedText={t.terminal.shellExited}
                    />
                  </section>
                  {nextSubterminal && (
                    <div
                      className="mx-1 w-1.5 shrink-0 cursor-col-resize rounded bg-border hover:bg-primary/60"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={t.terminal.resizeSubterminals}
                      title={t.terminal.resizeSubterminals}
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.currentTarget.setPointerCapture(event.pointerId)
                        resizeRef.current = {
                          tabId: activeTab.id,
                          leftId: subterminal.id,
                          rightId: nextSubterminal.id,
                          startX: event.clientX,
                          leftStart: width,
                          rightStart: widths[index + 1]
                        }
                        document.body.style.cursor = 'col-resize'
                        document.body.style.userSelect = 'none'
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
