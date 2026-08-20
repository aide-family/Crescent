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

function useImeSafeValue(
  external: string,
  onCommit: (value: string) => void
): {
  value: string
  onChange: (value: string) => void
  onCompositionStart: () => void
  onCompositionEnd: (event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => void
} {
  const composingRef = useRef(false)
  const [local, setLocal] = useState(external)

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
    },
    onCompositionEnd(event) {
      composingRef.current = false
      const next = event.currentTarget.value
      setLocal(next)
      onCommit(next)
    }
  }
}

export function ImeSafeInput({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, 'onChange' | 'value'> & {
  value: string
  onValueChange: (value: string) => void
}): JSX.Element {
  const ime = useImeSafeValue(value, onValueChange)
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
  ...props
}: Omit<ComponentProps<typeof Textarea>, 'onChange' | 'value'> & {
  value: string
  onValueChange: (value: string) => void
}): JSX.Element {
  const ime = useImeSafeValue(value, onValueChange)
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
