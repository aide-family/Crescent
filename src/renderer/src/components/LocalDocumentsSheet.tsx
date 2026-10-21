import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { FolderOpenIcon } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet'
import { MarkdownContent } from './MarkdownContent'
import type { Dictionary } from '@renderer/i18n'
import type { LocalDocumentNode, LocalDocumentPage } from '../../../shared/local-documents'
const LocalPdfPreview = lazy(() =>
  import('./LocalPdfPreview').then((module) => ({ default: module.LocalPdfPreview }))
)
const client = window.api.documents
export function LocalDocumentsSheet({
  open,
  onOpenChange,
  onInsert,
  t
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (text: string) => void
  t: Dictionary
}): React.JSX.Element {
  const [root, setRoot] = useState('')
  const [directory, setDirectory] = useState('')
  const [nodes, setNodes] = useState<LocalDocumentNode[]>([])
  const [path, setPath] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(1)
  const [page, setPage] = useState<LocalDocumentPage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [markdown, setMarkdown] = useState(false)
  const active = useRef<string | undefined>(undefined)
  const report = (value: unknown): void =>
    setError(value instanceof Error ? value.message : String(value))
  const pdf = /\.pdf$/i.test(path)
  useEffect(
    () => () => {
      if (active.current) void client.cancel(active.current)
    },
    []
  )
  useEffect(() => {
    if (!open && active.current) {
      void client.cancel(active.current)
      active.current = undefined
    }
  }, [open])
  async function list(next: string): Promise<void> {
    try {
      const result = await client.list(next)
      setDirectory(next)
      setNodes(result)
      setError('')
    } catch (error) {
      report(error)
    }
  }
  async function read(nextOffset = offset, nextPath = path): Promise<void> {
    if (active.current) void client.cancel(active.current)
    const requestId = crypto.randomUUID()
    active.current = requestId
    setBusy(true)
    setError('')
    setPage(undefined)
    try {
      const result = await client.read({
        path: nextPath,
        offset: nextOffset,
        limit: 200,
        query: query || undefined,
        requestId
      })
      if (active.current === requestId) setPage(result)
    } catch (error) {
      if (active.current === requestId) report(error)
    } finally {
      if (active.current === requestId) {
        setBusy(false)
        active.current = undefined
      }
    }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>本地资料</SheetTitle>
          <SheetDescription>
            仅在客户端读取授权目录；分片预览不会自动发给模型。点击插入引用后，发送对话会包含所选内容。
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-4 text-xs">
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              void client
                .chooseRoot()
                .then((selected) => {
                  if (selected) {
                    setRoot(selected)
                    void list(selected)
                  }
                })
                .catch(report)
            }
          >
            <FolderOpenIcon />
            选择并授权目录
          </Button>
          <p className="break-all text-muted-foreground">{directory || '尚未选择目录'}</p>
          {directory !== root && (
            <Button size="xs" variant="ghost" onClick={() => void list(root)}>
              回授权根目录
            </Button>
          )}
          <div className="max-h-40 overflow-auto divide-y divide-border">
            {nodes.map((node) => (
              <button
                key={node.path}
                className="block w-full py-1 text-left focus-visible:outline-primary"
                onClick={() => {
                  if (node.directory) void list(node.path)
                  else {
                    setPath(node.path)
                    setOffset(1)
                    setPage(undefined)
                    if (!/\.pdf$/i.test(node.path)) void read(1, node.path)
                  }
                }}
              >
                {node.directory ? '▸ ' : ''}
                {node.name}
              </button>
            ))}
          </div>
          <label className="block">
            授权范围内的文件路径
            <Input
              value={path}
              onChange={(event) => {
                setPath(event.target.value)
                setPage(undefined)
              }}
            />
          </label>
          <div className="flex gap-2">
            <label className="flex-1">
              关键词
              <Input value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label className="w-24">
              {pdf ? '页码' : '起始行'}
              <Input
                type="number"
                min={1}
                value={offset}
                onChange={(event) => setOffset(Number(event.target.value))}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button size="xs" disabled={!path || pdf} onClick={() => void read()}>
              读取 / 搜索
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={!busy}
              onClick={() => {
                if (active.current) void client.cancel(active.current)
              }}
            >
              取消
            </Button>
            <label>
              <input
                type="checkbox"
                checked={markdown}
                onChange={(event) => setMarkdown(event.target.checked)}
              />{' '}
              Markdown 预览
            </label>
          </div>
          {pdf && (
            <Suspense fallback={<p>加载本地 PDF 阅读器…</p>}>
              <LocalPdfPreview
                key={`${path}:${offset}`}
                path={path}
                pageNumber={offset}
                onInsert={onInsert}
              />
            </Suspense>
          )}
          {page && (
            <>
              <p>
                {page.encoding} · {page.lines.length} 行 ·{' '}
                {page.hasMore ? '有更多内容' : '本片结束'}
              </p>
              {markdown && /\.(?:md|markdown)$/i.test(path) ? (
                <MarkdownContent value={page.lines.map((line) => line.text).join('\n')} t={t} />
              ) : (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">
                  {page.lines.map((line) => `${line.line}: ${line.text}`).join('\n')}
                </pre>
              )}
              <div className="flex gap-2">
                <Button
                  size="xs"
                  disabled={!page.lines.length}
                  onClick={() =>
                    onInsert(
                      `[本地资料 ${page.path} · 行 ${page.lines[0]?.line}–${page.lines.at(-1)?.line}]\n${page.lines.map((line) => `${line.line}: ${line.text}`).join('\n')}`
                    )
                  }
                >
                  插入本片引用
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!page.hasMore}
                  onClick={() => {
                    const next = (page.lines.at(-1)?.line ?? offset) + 1
                    setOffset(next)
                    void read(next)
                  }}
                >
                  下一片
                </Button>
              </div>
            </>
          )}
          <p role="status">{busy ? '读取中…' : error}</p>
          <p className="text-muted-foreground">
            DOCX/XLSX/PPTX 转换器与 Filesystem MCP 可在现有 MCP
            管理器显式配置；不自动安装，不授予家目录，不调用云转码。OCR 需要另行确认。
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
