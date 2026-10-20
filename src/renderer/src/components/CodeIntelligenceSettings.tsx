import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import type { CodeIndexStatus } from '../../../shared/knowledge'

export function CodeIntelligenceSettings(): React.JSX.Element {
  const [root, setRoot] = useState<string>()
  const [status, setStatus] = useState<CodeIndexStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('search')
  const [result, setResult] = useState('')
  const [clear, setClear] = useState(false)
  useEffect(() => {
    void window.api.knowledge
      .codeStatus(root)
      .then(setStatus)
      .catch((e) => setError(String(e)))
    return () => {
      void window.api.knowledge.codeCancel()
    }
  }, [root])
  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-2 border-b pb-3 text-xs">
      <h3 className="font-medium">Code Intelligence · 本地代码索引</h3>
      <p className="break-all font-mono text-muted-foreground">
        {status?.root || root || '当前 Agent 工作目录'}
      </p>
      <p>
        文件 {status?.files ?? 0} · 符号 {status?.symbols ?? 0} · 跳过 {status?.skipped ?? 0} ·
        解析异常 {status?.errors ?? 0}
        {status?.limited && ' · 达到索引上限'} ·{' '}
        {busy
          ? '处理中…'
          : status?.updatedAt
            ? new Date(status.updatedAt).toLocaleString()
            : '未索引'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              const selected = await window.api.documents.chooseRoot()
              if (selected) {
                setRoot(selected)
                setResult('')
              }
            })
          }
        >
          选择授权目录
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void perform(async () => setStatus(await window.api.knowledge.codeIndex(root)))
          }
        >
          重新索引
        </Button>
        {busy && (
          <Button size="sm" variant="ghost" onClick={() => void window.api.knowledge.codeCancel()}>
            取消
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setClear(true)}>
          删除索引
        </Button>
      </div>
      {clear && (
        <div className="flex items-center gap-2">
          <span>删除当前目录的缓存索引？</span>
          <Button
            size="sm"
            variant="destructive"
            onClick={() =>
              void perform(async () => {
                await window.api.knowledge.codeClear(root)
                setStatus(await window.api.knowledge.codeStatus(root))
                setResult('')
                setClear(false)
              })
            }
          >
            确认
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setClear(false)}>
            取消
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        <Input
          aria-label="代码查询"
          placeholder="符号名、文件路径或关键词"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={200}
        />
        <select
          className="rounded border bg-background px-2"
          aria-label="查询方式"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          {[
            ['search', '代码搜索'],
            ['symbol', '符号定义/引用'],
            ['dependency', '依赖追踪'],
            ['impact', '影响分析']
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={busy || !query.trim() || !status?.files}
          onClick={() =>
            void perform(async () =>
              setResult(
                JSON.stringify(
                  await window.api.knowledge.codeSearch(status!.root, query, mode),
                  null,
                  2
                )
              )
            )
          }
        >
          查询
        </Button>
      </div>
      <p className="text-muted-foreground">
        TypeScript / JavaScript / Python / Shell / YAML /
        JSON；忽略依赖、构建产物、敏感文件和符号链接。依赖图描述静态导入，IPC
        和动态调用需读取源码验证。Agent 工具使用当前工作目录。
      </p>
      {error && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}
      {result && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border p-2 text-[11px]">
          {result}
        </pre>
      )}
    </section>
  )
}
