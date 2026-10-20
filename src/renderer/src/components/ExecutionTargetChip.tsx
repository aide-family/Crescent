import { useEffect, useState } from 'react'
import { agentClient } from '@renderer/clients'
import { Button } from './ui/button'
import type { TerminalExecutionTarget } from '../../../shared/agent-types'
export function ExecutionTargetChip({
  sessionKey,
  tabId
}: {
  sessionKey: string
  tabId: string
}): React.JSX.Element {
  const [target, setTarget] = useState<TerminalExecutionTarget>()
  const [message, setMessage] = useState('')
  useEffect(() => {
    let current = true
    let inFlight = false
    const refresh = (): void => {
      if (inFlight) return
      inFlight = true
      void agentClient
        .executionTarget(sessionKey, tabId)
        .then((value) => {
          if (current) setTarget(value)
        })
        .catch(() => {
          if (current) setTarget(undefined)
        })
        .finally(() => {
          inFlight = false
        })
    }
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [sessionKey, tabId])
  return (
    <details className="text-[11px] text-muted-foreground">
      <summary className="cursor-pointer text-primary focus-visible:outline-primary">
        执行目标：
        {target
          ? `${target.connectionName ?? (target.executionMode === 'ssh' ? 'SSH' : '本机')} · ${target.paneRole === 'main' ? '主终端' : '子终端'} · ${target.executionMode === 'ssh' ? (target.readiness?.ready ? 'SSH 已验证' : target.readiness?.restoring ? 'SSH 恢复中' : 'SSH 待确认') : target.readiness?.hasSession ? '本机已建链' : '本机待建链'}`
          : '待确认'}
      </summary>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap">
        {JSON.stringify(target, null, 2)}
      </pre>
      {target?.paneRole === 'subterminal' && (
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            void agentClient
              .returnToMain(sessionKey)
              .then((result) =>
                setMessage(result.ok ? '已恢复主终端' : (result.error ?? '恢复失败'))
              )
          }
        >
          回主终端
        </Button>
      )}
      <span role="status">{message}</span>
    </details>
  )
}
