import { useState } from 'react'
import { BrainIcon, PlusIcon } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet'
import { useMemoryCenter } from '../hooks/useMemoryCenter'
import {
  MEMORY_CATEGORIES,
  type MemoryInput,
  type MemoryItem,
  type MemoryModelSelection
} from '../../../shared/knowledge'

const categories = {
  environment: '环境',
  architecture: '架构',
  operation: '操作流程',
  troubleshooting: '故障经验',
  preference: '用户偏好'
}
const states = { candidate: '待审核', approved: '已确认', archived: '已归档' }
const historyStates = {
  pending: '待整理',
  changed: '有新内容',
  review: '待审核',
  learned: '已学习',
  archived: '已归档'
}
const emptyDraft: MemoryInput = {
  title: '',
  content: '',
  category: 'operation',
  scope: '',
  status: 'candidate'
}

export function MemoryCenter({
  open,
  onOpenChange,
  onOpenHistory,
  selection
}: {
  open: boolean
  selection: MemoryModelSelection
  onOpenChange: (value: boolean) => void
  onOpenHistory: (tabId: string) => Promise<void>
}): React.JSX.Element {
  const {
    snapshot,
    busy,
    error,
    message,
    perform,
    learn,
    cancel,
    learningTarget,
    pendingConsent,
    confirmConsent,
    revokeConsent,
    setAutoLearn,
    dismissConsent
  } = useMemoryCenter(open, selection)
  const [view, setView] = useState('knowledge')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [draft, setDraft] = useState<MemoryInput>()
  const [confirmation, setConfirmation] = useState<string>()
  const [target, setTarget] = useState('')
  const [relation, setRelation] = useState('关联')
  const items = snapshot?.items ?? []
  const filtered = items.filter(
    (item) =>
      (category === 'all' || item.category === category) &&
      (status === 'all' || item.status === status) &&
      `${item.title} ${item.content} ${item.scope}`.toLowerCase().includes(query.toLowerCase())
  )
  function edit(item: MemoryItem): void {
    setDraft({
      id: item.id,
      title: item.title,
      content: item.content,
      category: item.category,
      scope: item.scope,
      status: item.status
    })
  }
  async function save(approved = false): Promise<void> {
    if (!draft) return
    await perform(async () => {
      await window.api.knowledge.memorySave({
        ...draft,
        status: approved ? 'approved' : 'candidate'
      })
      setDraft(undefined)
    })
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(960px,95vw)] sm:max-w-[960px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BrainIcon className="size-4" />
            记忆中心
          </SheetTitle>
          <SheetDescription>
            从历史积累运维知识，审核后供 Agent
            召回。知识保存在本机。历史整理使用当前选择的模型，发送前脱敏；远程整理需先授权，结果仍需审核。回答时召回的已确认知识会随当前问题发送给所选模型。
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <span>知识 {items.length}</span>
            <span>已确认 {items.filter((item) => item.status === 'approved').length}</span>
            <span>待审核 {items.filter((item) => item.status === 'candidate').length}</span>
            <span>
              最近更新 {items[0]?.updatedAt ? new Date(items[0].updatedAt).toLocaleString() : '—'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={busy}
                checked={snapshot?.settings.recall ?? false}
                onChange={(e) =>
                  void perform(() =>
                    window.api.knowledge.memorySettings({
                      ...snapshot?.settings,
                      recall: e.target.checked,
                      autoLearn: snapshot?.settings.autoLearn ?? false
                    })
                  )
                }
              />
              自动召回已确认知识
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={busy}
                checked={snapshot?.settings.autoLearn ?? false}
                onChange={(e) => void setAutoLearn(e.target.checked)}
              />
              自动整理新历史（仍需审核）
            </label>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmation('clear')}
            >
              清空记忆
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span>
              整理模型：
              {learningTarget
                ? `${learningTarget.providerName} / ${learningTarget.model}`
                : '未选择模型'}
            </span>
            {learningTarget && (
              <span>
                {learningTarget.local
                  ? '本机服务'
                  : learningTarget.authorized
                    ? '远程整理已授权'
                    : '远程整理尚未授权'}
              </span>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void revokeConsent()}>
              撤销远程整理授权
            </Button>
          </div>
          {pendingConsent && (
            <div role="alert" className="space-y-2 rounded border p-3">
              <p className="font-medium">允许向此模型发送脱敏后的历史？</p>
              <p>
                {pendingConsent.target.providerName} / {pendingConsent.target.model}
              </p>
              <p className="break-all font-mono text-muted-foreground">
                {pendingConsent.target.endpoint}
              </p>
              <p>
                整理需要发送历史对话片段。密码、令牌等会先脱敏，但主机名、集群架构和操作内容仍可能包含内部信息。授权会记住此服务地址和模型，用于后续手动及自动整理；可随时撤销。整理结果保存在本机，审核后才启用。
              </p>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => void confirmConsent()}>
                  允许并{pendingConsent.auto ? '开启自动整理' : '开始整理'}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={dismissConsent}>
                  取消
                </Button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            {[
              ['knowledge', '知识库'],
              ['history', '历史学习']
            ].map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={view === value ? 'secondary' : 'ghost'}
                onClick={() => setView(value)}
              >
                {label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void perform(async () => {})}
            >
              刷新
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {snapshot?.autoLearnError && (
            <p role="alert" className="text-destructive">
              {snapshot.autoLearnError}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {confirmation && (
            <div role="alert" className="flex items-center gap-2 border p-2">
              <span>
                {confirmation === 'clear'
                  ? '清空所有知识和学习标记？历史对话会保留。'
                  : '删除这条知识？'}
              </span>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    if (confirmation === 'clear') await window.api.knowledge.memoryClear()
                    else await window.api.knowledge.memoryDelete(confirmation)
                    setConfirmation(undefined)
                    setDraft(undefined)
                  })
                }
              >
                确认删除
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmation(undefined)}>
                取消
              </Button>
            </div>
          )}
        </div>
        {view === 'history' ? (
          <>
            <div className="flex items-center gap-2 px-4">
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void learn(
                    (snapshot?.history ?? [])
                      .filter((item) => ['pending', 'changed'].includes(item.state))
                      .map((item) => item.tabId)
                  )
                }
              >
                整理未学习历史
              </Button>
              {busy && (
                <Button size="sm" variant="ghost" onClick={cancel}>
                  停止整理
                </Button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4">
              {snapshot?.history.map((item) => (
                <div
                  key={item.tabId}
                  className="app-list-row flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{item.title}</div>
                    <div className="text-muted-foreground">
                      {historyStates[item.state]} · {item.scope || '本地环境'}
                      {item.learnedAt && ` · ${new Date(item.learnedAt).toLocaleString()}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void perform(() => onOpenHistory(item.tabId))}
                    >
                      来源
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || !['pending', 'changed'].includes(item.state)}
                      onClick={() => void learn([item.tabId])}
                    >
                      整理
                    </Button>
                  </div>
                </div>
              ))}
              {snapshot?.history.length === 0 && (
                <p className="p-4 text-xs text-muted-foreground">暂无历史记录</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 px-4">
              <Input
                className="min-w-32 flex-1"
                aria-label="搜索知识"
                placeholder="搜索知识、环境"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                className="rounded border bg-background px-2 text-xs"
                aria-label="知识分类"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">所有分类</option>
                {MEMORY_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {categories[value]}
                  </option>
                ))}
              </select>
              <select
                className="rounded border bg-background px-2 text-xs"
                aria-label="审核状态"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">所有状态</option>
                {Object.entries(states).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={busy} onClick={() => setDraft({ ...emptyDraft })}>
                <PlusIcon className="size-3" />
                新增知识
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 gap-3 overflow-hidden px-4">
              <div className="min-w-0 flex-1 overflow-auto">
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    className="app-list-row block w-full text-left text-xs focus-visible:ring-2 focus-visible:ring-ring"
                    data-selected={draft?.id === item.id}
                    onClick={() => edit(item)}
                  >
                    <div className="font-medium">{item.title}</div>
                    <div className="mt-1 text-muted-foreground">
                      {categories[item.category]} · {states[item.status]} ·{' '}
                      {item.scope || '本地 / 通用偏好'} · 置信度 {Math.round(item.confidence * 100)}
                      %
                    </div>
                    <p className="mt-1 line-clamp-2">{item.content}</p>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="p-4 text-xs text-muted-foreground">
                    暂无匹配知识。新增知识或整理历史后，审核确认即可召回。
                  </p>
                )}
              </div>
              {draft && (
                <div className="w-[min(420px,50vw)] shrink-0 space-y-3 overflow-auto border-l pl-3 text-xs">
                  <label className="block">
                    标题
                    <Input
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      maxLength={200}
                    />
                  </label>
                  <label className="block">
                    分类
                    <select
                      className="ml-2 rounded border bg-background p-1"
                      value={draft.category}
                      onChange={(e) =>
                        setDraft({ ...draft, category: e.target.value as MemoryInput['category'] })
                      }
                    >
                      {MEMORY_CATEGORIES.map((value) => (
                        <option key={value} value={value}>
                          {categories[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    环境范围（连接 ID；留空为本地）
                    <Input
                      value={draft.scope}
                      onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                      maxLength={200}
                    />
                  </label>
                  <label className="block">
                    知识内容
                    <Textarea
                      className="min-h-52"
                      value={draft.content}
                      onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                      maxLength={12000}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy || !draft.title.trim() || !draft.content.trim()}
                      onClick={() => void save()}
                    >
                      保存待审核
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || !draft.title.trim() || !draft.content.trim()}
                      onClick={() => void save(true)}
                    >
                      确认并启用
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)}>
                      关闭编辑
                    </Button>
                  </div>
                  {draft.id && (
                    <>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void perform(() =>
                              window.api.knowledge.memorySave({ ...draft, status: 'archived' })
                            )
                          }
                        >
                          归档
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => setConfirmation(draft.id)}
                        >
                          删除
                        </Button>
                      </div>
                      {items.find((item) => item.id === draft.id)?.source && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void perform(() =>
                              onOpenHistory(items.find((item) => item.id === draft.id)!.source)
                            )
                          }
                        >
                          打开来源会话
                        </Button>
                      )}
                      <p className="text-muted-foreground">知识关联</p>
                      {(snapshot?.relations ?? [])
                        .filter((edge) => edge.source === draft.id || edge.target === draft.id)
                        .map((edge) => (
                          <div
                            key={`${edge.source}:${edge.target}:${edge.relation}`}
                            className="flex items-center gap-1"
                          >
                            <span>
                              {items.find((item) => item.id === edge.source)?.title} →{' '}
                              {edge.relation} →{' '}
                              {items.find((item) => item.id === edge.target)?.title}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                void perform(() => window.api.knowledge.memoryUnrelate(edge))
                              }
                            >
                              移除
                            </Button>
                          </div>
                        ))}
                      <select
                        className="w-full rounded border bg-background p-1"
                        aria-label="关联知识"
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                      >
                        <option value="">选择关联知识</option>
                        {items
                          .filter((item) => item.id !== draft.id)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                      </select>
                      <Input
                        aria-label="关系名称"
                        value={relation}
                        onChange={(e) => setRelation(e.target.value)}
                        maxLength={100}
                      />
                      <Button
                        size="sm"
                        disabled={busy || !target || !relation.trim()}
                        onClick={() =>
                          void perform(() =>
                            window.api.knowledge.memoryRelate({
                              source: draft.id!,
                              target,
                              relation
                            })
                          )
                        }
                      >
                        添加关联
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
