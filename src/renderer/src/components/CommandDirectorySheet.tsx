import { useEffect, useState } from 'react'
import { BookMarkedIcon, PlusIcon, StarIcon, Trash2Icon } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet'
import {
  renderCommandTemplate,
  validateCommandDirectory,
  type CommandDirectory,
  type CommandEntry
} from '../../../shared/command-directory'
import type { CommandApprovalRequest } from '../../../shared/agent-types'
import type { CommandPreview } from '../../../preload/modules/commands'

const client = window.api.commands
export function CommandDirectorySheet({
  open,
  onOpenChange,
  tabId,
  chatTabId,
  connectionId,
  executionMode,
  mutationPolicy,
  onInsert
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  tabId: string
  chatTabId: string
  connectionId?: string
  executionMode: 'planned' | 'immediate'
  mutationPolicy: 'confirm' | 'manual-execution'
  onInsert: (text: string) => void
}): React.JSX.Element {
  const [directory, setDirectory] = useState<CommandDirectory>()
  const [entry, setEntry] = useState<CommandEntry>()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [scope, setScope] = useState('applicable')
  const [values, setValues] = useState<Record<string, string>>({})
  const [parameterText, setParameterText] = useState('[]')
  const [previewState, setPreviewState] = useState<{ value: CommandPreview; key: string }>()
  const previewKey = JSON.stringify([tabId, entry, values, parameterText])
  const preview = previewState?.key === previewKey ? previewState.value : undefined
  const setPreview = (value: CommandPreview | undefined): void =>
    setPreviewState(value ? { value, key: previewKey } : undefined)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [approval, setApproval] = useState<CommandApprovalRequest>()
  const [approvalNote, setApprovalNote] = useState('')
  const [dragId, setDragId] = useState('')
  const report = (error: unknown): void =>
    setMessage(error instanceof Error ? error.message : String(error))
  useEffect(() => {
    let current = true
    if (open)
      void client
        .list()
        .then((value) => {
          if (current) setDirectory(value)
        })
        .catch((error) => {
          if (current) report(error)
        })
    return () => {
      current = false
    }
  }, [open])
  useEffect(() => {
    const off = window.api.agent.onCommandApprovalRequest((request) => {
      if (request.runId.startsWith('catalog-') && request.tabId === tabId) setApproval(request)
    })
    const dismiss = window.api.agent.onCommandApprovalDismiss((payload) =>
      setApproval((value) => (value?.id === payload.requestId ? undefined : value))
    )
    return () => {
      off()
      dismiss()
      void client.cancel(tabId)
    }
  }, [tabId])
  function select(next: CommandEntry): void {
    setEntry(next)
    setParameterText(JSON.stringify(next.parameters, null, 2))
    setValues({})
    setPreview(undefined)
  }
  async function persist(next: CommandDirectory): Promise<void> {
    setDirectory(await client.save(next))
    setPreview(undefined)
  }
  async function save(): Promise<void> {
    if (!directory || !entry) return
    try {
      const next = {
        ...entry,
        parameters: JSON.parse(parameterText),
        updatedAt: new Date().toISOString()
      }
      await persist({
        ...directory,
        entries: directory.entries.some((item) => item.id === next.id)
          ? directory.entries.map((item) => (item.id === next.id ? next : item))
          : [...directory.entries, next]
      })
      select(next)
      setMessage('已保存。风险标签仅展示，执行时重新审核。')
    } catch (error) {
      report(error)
    }
  }
  function newEntry(): void {
    select({
      id: crypto.randomUUID(),
      name: '',
      category: directory?.categories[0] ?? 'Linux',
      description: '',
      command: '',
      tags: [],
      environment: '',
      risk: 'unknown',
      expectedOutput: '',
      parameters: [],
      scope: 'global',
      favorite: false,
      updatedAt: new Date().toISOString(),
      source: '',
      notes: ''
    })
  }
  async function check(): Promise<void> {
    if (!entry || !directory) return
    const saved = directory.entries.find((item) => item.id === entry.id)
    if (
      !saved ||
      JSON.stringify(saved) !== JSON.stringify(entry) ||
      JSON.stringify(JSON.parse(parameterText)) !== JSON.stringify(saved.parameters)
    ) {
      setMessage('先保存模板，再生成执行预览。')
      return
    }
    try {
      setPreview(await client.preview({ entryId: entry.id, values, tabId }))
      setMessage('请核对完整命令和最终目标。')
    } catch (error) {
      report(error)
    }
  }
  function rendered(): string {
    if (!entry) throw new Error('选择命令')
    return renderCommandTemplate({ ...entry, parameters: JSON.parse(parameterText) }, values)
  }
  function exportDirectory(markdown = false): void {
    if (!directory) return
    const json = JSON.stringify(directory, null, 2)
    const text = markdown
      ? `# Crescent 命令手册\n\n${directory.entries.map((item) => `## ${item.name}\n${item.description}\n\n\`\`\`sh\n${item.command}\n\`\`\``).join('\n\n')}\n\n## 可导入数据\n\`\`\`json\n${json}\n\`\`\`\n`
      : json
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `crescent-commands.${markdown ? 'md' : 'json'}`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const list =
    directory?.entries.filter(
      (item) =>
        (!category || item.category === category) &&
        (scope === 'all' ||
          (scope === 'favorite'
            ? item.favorite
            : item.scope === 'global' || item.scopeId === connectionId)) &&
        `${item.name} ${item.description} ${item.command} ${item.tags.join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase())
    ) ?? []
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            <BookMarkedIcon className="inline size-4" /> 命令手册
          </SheetTitle>
          <SheetDescription>按稳定连接 ID 管理；模板标签不能代替主进程审批。</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-4 text-xs">
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="搜索命令"
              placeholder="搜索名称、命令、标签"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="分类"
              className="bg-background"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">全部分类</option>
              {directory?.categories.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <select
              aria-label="范围筛选"
              className="bg-background"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="applicable">当前连接 / 全局</option>
              <option value="all">全部范围</option>
              <option value="favorite">收藏</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="xs" onClick={newEntry}>
              <PlusIcon />
              新增
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void client.undo().then(setDirectory).catch(report)}
            >
              撤销上次修改
            </Button>
            <Button size="xs" variant="outline" onClick={() => exportDirectory()}>
              导出 JSON
            </Button>
            <Button size="xs" variant="outline" onClick={() => exportDirectory(true)}>
              导出 Markdown
            </Button>
            <label className="cursor-pointer underline">
              导入
              <input
                type="file"
                accept=".json,.md"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file || !directory) return
                  if (file.size > 2 * 1024 * 1024) {
                    setMessage('导入最多 2 MiB')
                    return
                  }
                  void file
                    .text()
                    .then(async (text) => {
                      const imported = validateCommandDirectory(
                        JSON.parse(text.match(/```json\s*\n([\s\S]*?)\n```/)?.[1] ?? text)
                      )
                      if (!window.confirm('合并导入的命令与分类？同 ID 条目会覆盖。')) return
                      const entries = new Map(directory.entries.map((item) => [item.id, item]))
                      imported.entries.forEach((item) => entries.set(item.id, item))
                      await persist({
                        ...directory,
                        categories: [...new Set([...directory.categories, ...imported.categories])],
                        entries: [...entries.values()]
                      })
                    })
                    .catch(report)
                }}
              />
            </label>
          </div>
          {directory && (
            <label className="block">
              可编辑分类（逗号分隔）
              <Input
                value={directory.categories.join(', ')}
                onChange={(event) =>
                  setDirectory({
                    ...directory,
                    categories: event.target.value
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean)
                  })
                }
                onBlur={() => void persist(directory).catch(report)}
              />
            </label>
          )}
          <div className="max-h-48 overflow-auto divide-y divide-border">
            {list.map((item) => (
              <div
                key={item.id}
                draggable
                onDragStart={() => setDragId(item.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  if (!directory || dragId === item.id) return
                  const moved = directory.entries.find((e) => e.id === dragId)
                  if (!moved) return
                  const entries = directory.entries.filter((e) => e.id !== dragId)
                  entries.splice(
                    entries.findIndex((e) => e.id === item.id),
                    0,
                    moved
                  )
                  void persist({ ...directory, entries }).catch(report)
                }}
                className="flex items-center gap-2 py-2"
              >
                <button
                  className="min-w-0 flex-1 truncate text-left focus-visible:outline-primary"
                  onClick={() => select(item)}
                >
                  {item.name} · {item.category} · {item.scope}
                </button>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label="收藏"
                  onClick={() =>
                    directory &&
                    void persist({
                      ...directory,
                      entries: directory.entries.map((e) =>
                        e.id === item.id ? { ...e, favorite: !e.favorite } : e
                      )
                    }).catch(report)
                  }
                >
                  <StarIcon className={item.favorite ? 'fill-primary text-primary' : ''} />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    directory &&
                    void persist({
                      ...directory,
                      entries: [item, ...directory.entries.filter((e) => e.id !== item.id)]
                    }).catch(report)
                  }
                >
                  置顶
                </Button>
              </div>
            ))}
          </div>
          {entry && (
            <div className="space-y-2 border-t border-border pt-3">
              {(
                ['name', 'description', 'environment', 'expectedOutput', 'source', 'notes'] as const
              ).map((key) => (
                <label key={key} className="block">
                  {
                    {
                      name: '名称',
                      description: '说明',
                      environment: '适用环境',
                      expectedOutput: '预期输出',
                      source: '来源',
                      notes: '备注'
                    }[key]
                  }
                  <Input
                    value={entry[key]}
                    onChange={(event) => setEntry({ ...entry, [key]: event.target.value })}
                  />
                </label>
              ))}
              <label className="block">
                分类
                <Input
                  list="command-categories"
                  value={entry.category}
                  onChange={(event) => setEntry({ ...entry, category: event.target.value })}
                />
                <datalist id="command-categories">
                  {directory?.categories.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </datalist>
              </label>
              <label className="block">
                标签
                <Input
                  value={entry.tags.join(', ')}
                  onChange={(event) =>
                    setEntry({ ...entry, tags: event.target.value.split(',').map((s) => s.trim()) })
                  }
                />
              </label>
              <label className="block">
                范围
                <select
                  className="ml-2 bg-background"
                  value={entry.scope}
                  onChange={(event) =>
                    setEntry({
                      ...entry,
                      scope: event.target.value as CommandEntry['scope'],
                      scopeId: event.target.value === 'global' ? undefined : connectionId
                    })
                  }
                >
                  <option value="global">全局</option>
                  <option value="connection">连接</option>
                  <option value="cluster">集群</option>
                </select>
              </label>
              {entry.scope !== 'global' && (
                <label className="block">
                  稳定连接 / 集群范围 ID
                  <Input
                    value={entry.scopeId ?? ''}
                    onChange={(event) => setEntry({ ...entry, scopeId: event.target.value })}
                  />
                </label>
              )}
              <label className="block">
                风险标签（仅展示）
                <select
                  className="ml-2 bg-background"
                  value={entry.risk}
                  onChange={(event) =>
                    setEntry({ ...entry, risk: event.target.value as CommandEntry['risk'] })
                  }
                >
                  <option value="unknown">未知</option>
                  <option value="low">低</option>
                  <option value="high">高</option>
                </select>
              </label>
              <label className="block">
                命令模板
                <Textarea
                  className="font-mono"
                  value={entry.command}
                  onChange={(event) => setEntry({ ...entry, command: event.target.value })}
                />
              </label>
              <label className="block">
                参数定义 JSON（name / type: text、integer、enum / values）
                <Textarea
                  className="font-mono"
                  value={parameterText}
                  onChange={(event) => setParameterText(event.target.value)}
                />
              </label>
              <p className="text-muted-foreground">维护时间：{entry.updatedAt}</p>
              <div className="flex gap-2">
                <Button size="xs" onClick={() => void save()}>
                  保存
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    if (directory && window.confirm(`删除 ${entry.name}？`))
                      void persist({
                        ...directory,
                        entries: directory.entries.filter((e) => e.id !== entry.id)
                      })
                        .then(() => setEntry(undefined))
                        .catch(report)
                  }}
                >
                  <Trash2Icon />
                  删除
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    select({
                      ...entry,
                      id: crypto.randomUUID(),
                      scope: 'connection',
                      scopeId: connectionId,
                      name: `${entry.name}（副本）`
                    })
                  }
                >
                  复制到当前连接
                </Button>
              </div>
              {entry.parameters.map((parameter) => (
                <label key={parameter.name} className="block">
                  {parameter.name} ({parameter.type})
                  <Input
                    value={values[parameter.name] ?? ''}
                    onChange={(event) =>
                      setValues({ ...values, [parameter.name]: event.target.value })
                    }
                  />
                </label>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    try {
                      void navigator.clipboard.writeText(rendered()).catch(report)
                    } catch (error) {
                      report(error)
                    }
                  }}
                >
                  复制
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    try {
                      onInsert(rendered())
                    } catch (error) {
                      report(error)
                    }
                  }}
                >
                  插入输入框
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    try {
                      onInsert(`解释此命令的作用、目标和风险，暂不执行：\n${rendered()}`)
                    } catch (error) {
                      report(error)
                    }
                  }}
                >
                  发送 Agent 解释
                </Button>
                <Button size="xs" disabled={busy} onClick={() => void check()}>
                  审查后执行：预览
                </Button>
              </div>
              {preview && (
                <div className="space-y-2 border-t border-border pt-2">
                  <p>
                    目标：{preview.target.connectionName ?? preview.target.executionMode} ·{' '}
                    {preview.target.paneRole} ·{' '}
                    {preview.target.expectedTarget ?? preview.target.paneId} · 代次{' '}
                    {preview.target.sessionGeneration}
                  </p>
                  <p>主机静态审查：{preview.risk}；变更仍需人工审批。</p>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
                    {preview.command}
                  </pre>
                  <Button
                    size="xs"
                    disabled={busy}
                    onClick={() => {
                      if (!entry) return
                      setBusy(true)
                      void client
                        .execute({
                          entryId: entry.id,
                          values,
                          tabId,
                          chatTabId,
                          command: preview.command,
                          binding: preview.binding,
                          executionMode,
                          mutationPolicy
                        })
                        .then((result) =>
                          setMessage(
                            [
                              result.ok ? '完成' : (result.error ?? '失败 / 结果未知'),
                              result.output
                            ].join('\n')
                          )
                        )
                        .catch(report)
                        .finally(() => {
                          setBusy(false)
                          setPreview(undefined)
                        })
                    }}
                  >
                    按此完整目标审查并执行
                  </Button>
                </div>
              )}
            </div>
          )}
          {approval && (
            <div className="space-y-2 border border-amber-600 p-3">
              <p>人工审批：{approval.audit.summary}</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
                {approval.command}
              </pre>
              <Input
                aria-label="审批备注"
                value={approvalNote}
                onChange={(event) => setApprovalNote(event.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="xs"
                  onClick={() =>
                    void window.api.agent
                      .resolveCommandApproval({
                        requestId: approval.id,
                        approved: true,
                        note: approvalNote
                      })
                      .then(() => setApproval(undefined))
                  }
                >
                  确认此命令和目标
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void window.api.agent
                      .resolveCommandApproval({
                        requestId: approval.id,
                        approved: false,
                        rejectionReason: approvalNote
                      })
                      .then(() => setApproval(undefined))
                  }
                >
                  拒绝
                </Button>
              </div>
            </div>
          )}
          <pre
            role="status"
            className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted-foreground"
          >
            {message}
          </pre>
        </div>
      </SheetContent>
    </Sheet>
  )
}
