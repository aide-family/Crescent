import { type FormEvent, useEffect, useRef, useState } from 'react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import type { Dictionary } from '@renderer/i18n'
import type { ExtensionUiRequest } from '../../../shared/agent-types'

export function ExtensionUiDialog({
  request,
  t,
  onResolve
}: {
  request: ExtensionUiRequest | null
  t: Dictionary
  onResolve: (input: { cancelled?: boolean; confirmed?: boolean; value?: string }) => void
}): React.JSX.Element | null {
  const [value, setValue] = useState(request?.method === 'editor' ? (request.prefill ?? '') : '')
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!request || request.method === 'notify' || request.method === 'confirm') return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [request])

  useEffect(() => {
    if (!request || request.method === 'notify') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onResolve({ cancelled: true })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onResolve, request])

  if (!request || request.method === 'notify') return null

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (request?.method === 'confirm') {
      onResolve({ confirmed: true })
      return
    }
    if (request?.method === 'select') return
    onResolve({ value })
  }

  return (
    <div
      className="app-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 overscroll-contain"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extension-ui-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onResolve({ cancelled: true })
      }}
    >
      <form
        className="app-modal-panel w-full max-w-md overflow-hidden rounded-xl border bg-background"
        onSubmit={submit}
      >
        <div className="app-modal-header border-b px-4 py-3">
          <h2 id="extension-ui-title" className="text-sm font-semibold">
            {request.method === 'confirm'
              ? request.title
              : request.method === 'select'
                ? request.title
                : request.title}
          </h2>
          {request.method === 'confirm' ? (
            <p className="mt-1 text-sm text-muted-foreground">{request.message}</p>
          ) : null}
        </div>
        <div className="space-y-3 px-4 py-3">
          {request.method === 'select' ? (
            <div className="flex max-h-64 flex-col gap-1 overflow-auto">
              {request.options.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant="outline"
                  className="h-auto justify-start whitespace-normal py-2 text-left text-xs"
                  onClick={() => onResolve({ value: option })}
                >
                  {option}
                </Button>
              ))}
            </div>
          ) : null}
          {request.method === 'input' ? (
            <Input
              ref={inputRef as React.Ref<HTMLInputElement>}
              value={value}
              placeholder={request.placeholder}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          ) : null}
          {request.method === 'editor' ? (
            <Textarea
              ref={inputRef as React.Ref<HTMLTextAreaElement>}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="min-h-40 font-mono text-xs"
              spellCheck={false}
            />
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="outline" onClick={() => onResolve({ cancelled: true })}>
            {t.common.cancel}
          </Button>
          {request.method === 'confirm' ? (
            <Button type="submit">{t.common.confirm}</Button>
          ) : request.method === 'select' ? null : (
            <Button type="submit">{t.common.save}</Button>
          )}
        </div>
      </form>
    </div>
  )
}
