import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Button } from './ui/button'
import { redactSensitiveText } from '../../../shared/secret-redaction'
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
export function LocalPdfPreview({
  path,
  pageNumber,
  onInsert
}: {
  path: string
  pageNumber: number
  onInsert: (text: string) => void
}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    let current = true
    let loading: ReturnType<typeof pdfjs.getDocument> | undefined
    let rendering: ReturnType<pdfjs.PDFPageProxy['render']> | undefined
    const timeout = setTimeout(() => {
      if (current) {
        setMessage('PDF 解析超过 10 秒')
        void loading?.destroy()
      }
    }, 10000)
    void window.api.documents
      .pdf(path)
      .then(async (result) => {
        if (!current) return
        const data = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))
        loading = pdfjs.getDocument({
          data,
          disableFontFace: true,
          useSystemFonts: true,
          useWorkerFetch: false,
          stopAtErrors: true,
          maxImageSize: 4000000
        })
        const document = await loading.promise
        if (!current) return
        if (document.numPages > 200 || pageNumber < 1 || pageNumber > document.numPages)
          throw new Error('PDF 最多 200 页；请指定有效页码')
        const page = await document.getPage(pageNumber)
        const viewport = page.getViewport({
          scale: Math.min(1.2, 1000 / page.getViewport({ scale: 1 }).width)
        })
        if (viewport.width * viewport.height > 2000000) throw new Error('PDF 页尺寸超过预览限制')
        const target = canvas.current
        if (!target) return
        target.width = viewport.width
        target.height = viewport.height
        rendering = page.render({ canvas: target, viewport })
        const content = await page.getTextContent()
        if (!current) return
        setText(
          redactSensitiveText(
            content.items
              .map((item) => ('str' in item ? item.str : ''))
              .join(' ')
              .slice(0, 50000)
          )
        )
        setMessage(`第 ${pageNumber} / ${document.numPages} 页 · 本地解析`)
        await rendering.promise
        clearTimeout(timeout)
      })
      .catch((error) => {
        if (current) setMessage(error instanceof Error ? error.message : String(error))
      })
    return () => {
      current = false
      clearTimeout(timeout)
      rendering?.cancel()
      void loading?.destroy()
    }
  }, [path, pageNumber])
  return (
    <div className="space-y-2">
      <p role="status">{message}</p>
      <canvas ref={canvas} className="max-w-full" aria-label={`PDF 第 ${pageNumber} 页`} />
      <Button
        size="xs"
        disabled={!text}
        onClick={() => onInsert(`[本地 PDF ${path} · 第 ${pageNumber} 页]\n${text}`)}
      >
        插入本页引用
      </Button>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap">{text}</pre>
    </div>
  )
}
