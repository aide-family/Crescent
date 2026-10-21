import { useEffect, useState } from 'react'
import { agentClient, terminalClient } from '@renderer/clients'
import { Button } from './ui/button'
import type { TerminalExecutionTarget } from '../../../shared/agent-types'
const activityLabels = {
  'shell-ready': 'Shell 就绪',
  'command-running': '命令执行中',
  'interactive-application': '交互程序（人工接管）',
  'awaiting-input': '等待输入',
  interrupted: '已中断，等待 Shell 确认',
  'completion-unknown': '结果未确认',
  'session-exited': '会话已退出'
}
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
      <p role="status">{target?.activity ? activityLabels[target.activity] : '等待终端确认'}</p>
      <p className="break-all">
        {target?.expectedTarget ?? '本机'} · {target?.cwd ?? '目录待确认'}
      </p>
      {target?.sshHops && target.sshHops.length > 1 && (
        <p>SSH 路径：{target.sshHops.map((hop) => hop.host).join(' → ')}</p>
      )}
      {target?.activity &&
        ['command-running', 'completion-unknown', 'interrupted', 'awaiting-input'].includes(
          target.activity
        ) && (
          <div className="flex gap-1">
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                if (!target) return
                void terminalClient
                  .continueWaiting(target.paneId)
                  .then((result) =>
                    setMessage(
                      result.ok
                        ? '已延长等待时间'
                        : '等待终端返回 Shell；必要时中断或使用终端重连入口'
                    )
                  )
              }}
            >
              继续等待
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                if (!target) return
                void terminalClient
                  .interrupt(target.paneId)
                  .then(() => setMessage('已发送 Ctrl+C；等待新的 Shell 提示符后再执行'))
              }}
            >
              中断并等待 Shell
            </Button>
          </div>
        )}
      {target?.activity === 'interactive-application' && (
        <p>请在终端中操作并退出交互程序；Shell 就绪后 Agent 才能继续执行。</p>
      )}
      {target?.activity === 'session-exited' && (
        <p>请使用终端的重连入口，重新确认目标后继续；原任务不会自动重放。</p>
      )}
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
