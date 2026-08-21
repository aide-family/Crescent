import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CompositionEvent,
  type JSX
} from 'react'

import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { applyExternalImeValue, shouldCommitImeChange } from '@renderer/lib/ime-safe-value'

type ImeCompositionHandler = () => void

function useImeSafeValue(
  external: string,
  onCommit: (value: string) => void,
  options?: {
    onCompositionStart?: ImeCompositionHandler
    onCompositionEnd?: ImeCompositionHandler
  }
): {
  value: string
  onChange: (value: string) => void
  onCompositionStart: (event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onCompositionEnd: (event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => void
} {
  const composingRef = useRef(false)
  const [local, setLocal] = useState(external)
  const onCompositionStartRef = useRef(options?.onCompositionStart)
  const onCompositionEndRef = useRef(options?.onCompositionEnd)

  useEffect(() => {
    onCompositionStartRef.current = options?.onCompositionStart
    onCompositionEndRef.current = options?.onCompositionEnd
  }, [options?.onCompositionStart, options?.onCompositionEnd])

  useEffect(() => {
    setLocal((current) =>
      applyExternalImeValue({
        composing: composingRef.current,
        local: current,
        external
      })
    )
  }, [external])

  return {
    value: local,
    onChange(value: string) {
      setLocal(value)
      if (shouldCommitImeChange(composingRef.current)) onCommit(value)
    },
    onCompositionStart() {
      composingRef.current = true
      onCompositionStartRef.current?.()
    },
    onCompositionEnd(event) {
      composingRef.current = false
      const next = event.currentTarget.value
      setLocal(next)
      onCommit(next)
      onCompositionEndRef.current?.()
    }
  }
}

export function ImeSafeInput({
  value,
  onValueChange,
  onCompositionStart,
  onCompositionEnd,
  ...props
}: Omit<
  ComponentProps<typeof Input>,
  'onChange' | 'value' | 'onCompositionStart' | 'onCompositionEnd'
> & {
  value: string
  onValueChange: (value: string) => void
  onCompositionStart?: ImeCompositionHandler
  onCompositionEnd?: ImeCompositionHandler
}): JSX.Element {
  const ime = useImeSafeValue(value, onValueChange, { onCompositionStart, onCompositionEnd })
  return (
    <Input
      {...props}
      value={ime.value}
      onChange={(event) => ime.onChange(event.target.value)}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
    />
  )
}

export function ImeSafeTextarea({
  value,
  onValueChange,
  onCompositionStart,
  onCompositionEnd,
  ...props
}: Omit<
  ComponentProps<typeof Textarea>,
  'onChange' | 'value' | 'onCompositionStart' | 'onCompositionEnd'
> & {
  value: string
  onValueChange: (value: string) => void
  onCompositionStart?: ImeCompositionHandler
  onCompositionEnd?: ImeCompositionHandler
}): JSX.Element {
  const ime = useImeSafeValue(value, onValueChange, { onCompositionStart, onCompositionEnd })
  return (
    <Textarea
      {...props}
      value={ime.value}
      onChange={(event) => ime.onChange(event.target.value)}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
    />
  )
}
