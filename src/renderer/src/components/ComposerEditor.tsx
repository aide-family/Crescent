import {
  type ClipboardEvent,
  type KeyboardEvent,
  type RefObject,
  useLayoutEffect,
  useRef
} from 'react'

import { ComposerRefChip } from '@renderer/components/AgentReferenceBadges'
import { Textarea } from '@renderer/components/ui/textarea'
import type { Dictionary } from '@renderer/i18n'
import {
  caretAfterInsertedRef,
  deleteAdjacentComposerRef,
  formatComposerRefToken,
  parseComposerSegments,
  removeComposerRefToken,
  resolveComposerTextCaret,
  serializeComposerSegments,
  type ComposerRefKind
} from '@renderer/lib/composer-ref-tokens'
import { cn } from '@renderer/lib/utils'
import type { AgentToolReference } from '@renderer/lib/terminal-tabs'
import type {
  AgentPathReference,
  AgentSkillOption,
  AgentWikiReference
} from '../../../shared/agent-types'

export function ComposerEditor({
  value,
  placeholder,
  ariaLabel,
  t,
  agentInputRef,
  skillRefs,
  wikiRefs,
  toolRefs,
  pathRefs,
  onChange,
  onCaretChange,
  onKeyDown,
  onPaste
}: {
  value: string
  placeholder: string
  ariaLabel: string
  t: Dictionary
  agentInputRef?: RefObject<HTMLTextAreaElement | null>
  skillRefs: AgentSkillOption[]
  wikiRefs: AgentWikiReference[]
  toolRefs: AgentToolReference[]
  pathRefs: AgentPathReference[]
  onChange: (value: string) => void
  onCaretChange?: (cursor: number) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
}): React.JSX.Element {
  const segments = parseComposerSegments(value)
  const textareasRef = useRef<Array<HTMLTextAreaElement | null>>([])
  const pendingCaretRef = useRef<number | null>(null)
  const previousValueRef = useRef(value)

  useLayoutEffect(() => {
    const nodes = textareasRef.current
    const last = nodes.filter(Boolean).at(-1) ?? null
    if (agentInputRef) agentInputRef.current = last

    const insertedCaret = caretAfterInsertedRef(previousValueRef.current, value)
    previousValueRef.current = value
    if (insertedCaret != null) pendingCaretRef.current = insertedCaret

    const caret = pendingCaretRef.current
    if (caret == null) return

    const apply = (): boolean => focusSerializedCaret(value, textareasRef.current, caret)
    apply()
    onCaretChange?.(caret)
    pendingCaretRef.current = null

    const frame = window.requestAnimationFrame(() => {
      apply()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [agentInputRef, onCaretChange, value])

  const skillById = new Map(skillRefs.map((item) => [item.id, item]))
  const wikiById = new Map(wikiRefs.map((item) => [item.id, item]))
  const toolById = new Map(toolRefs.map((item) => [item.id, item]))
  const pathById = new Map(pathRefs.map((item) => [item.id, item]))

  function serializedOffset(textIndex: number, local = 0): number {
    let offset = 0
    let seen = 0
    for (const segment of segments) {
      if (segment.type === 'text') {
        if (seen === textIndex) return offset + local
        offset += segment.value.length
        seen += 1
        continue
      }
      offset += formatComposerRefToken(segment.kind, segment.id).length
    }
    return offset
  }

  function emitCaret(textIndex: number, local: number): void {
    onCaretChange?.(serializedOffset(textIndex, local))
  }

  function handleTextChange(textIndex: number, nextText: string): void {
    let seen = 0
    const next = segments.map((segment) => {
      if (segment.type !== 'text') return segment
      if (seen === textIndex) {
        seen += 1
        return { type: 'text' as const, value: nextText }
      }
      seen += 1
      return segment
    })
    onChange(serializeComposerSegments(next))
  }

  function removeRef(kind: ComposerRefKind, id: string): void {
    onChange(removeComposerRefToken(value, kind, id))
  }

  const textSegments = segments.filter((segment) => segment.type === 'text')
  const lastTextIndex = Math.max(0, textSegments.length - 1)

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'ref') {
          const label =
            segment.kind === 'wiki'
              ? (wikiById.get(segment.id)?.title ?? segment.id)
              : segment.kind === 'skill'
                ? (skillById.get(segment.id)?.name ?? segment.id)
                : segment.kind === 'tool'
                  ? (toolById.get(segment.id)?.name ?? segment.id)
                  : (pathById.get(segment.id)?.name ?? segment.id)
          const tool = toolById.get(segment.id)
          const path = pathById.get(segment.id)
          return (
            <ComposerRefChip
              key={`ref-${index}-${segment.kind}-${segment.id}`}
              kind={segment.kind}
              label={label}
              t={t}
              removable
              isMcp={tool?.source === 'mcp'}
              pathKind={path?.kind}
              onRemove={() => removeRef(segment.kind, segment.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Backspace' && event.key !== 'Delete') return
                event.preventDefault()
                removeRef(segment.kind, segment.id)
              }}
            />
          )
        }

        const textIndex = segments.slice(0, index).filter((item) => item.type === 'text').length
        const isLast = textIndex === lastTextIndex
        return (
          <Textarea
            key={`text-${textIndex}-${index}`}
            ref={(node) => {
              textareasRef.current[textIndex] = node
              if (isLast && agentInputRef) agentInputRef.current = node
            }}
            value={segment.value}
            rows={1}
            placeholder={isLast && !value.trim() ? placeholder : undefined}
            aria-label={ariaLabel}
            name={isLast ? 'agent-input' : undefined}
            autoComplete="off"
            onChange={(event) => {
              handleTextChange(textIndex, event.target.value)
              emitCaret(textIndex, event.target.selectionStart ?? event.target.value.length)
            }}
            onSelect={(event) => {
              const target = event.currentTarget
              emitCaret(textIndex, target.selectionStart ?? 0)
            }}
            onPaste={onPaste}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) {
                onKeyDown(event)
                return
              }
              const target = event.currentTarget
              const start = target.selectionStart ?? 0
              const end = target.selectionEnd ?? 0
              const atStart = start === 0 && end === 0
              const atEnd = start === target.value.length && end === target.value.length
              const offset = serializedOffset(textIndex, start)

              if (event.key === 'Backspace' && atStart) {
                const result = deleteAdjacentComposerRef(value, offset, 'backward')
                if (result) {
                  event.preventDefault()
                  pendingCaretRef.current = result.cursor
                  onChange(result.value)
                  onCaretChange?.(result.cursor)
                  return
                }
                if (textIndex > 0) {
                  event.preventDefault()
                  const previous = textareasRef.current[textIndex - 1]
                  previous?.focus()
                  const caret = previous?.value.length ?? 0
                  previous?.setSelectionRange(caret, caret)
                }
                return
              }

              if (event.key === 'Delete' && atEnd) {
                const result = deleteAdjacentComposerRef(value, offset, 'forward')
                if (result) {
                  event.preventDefault()
                  pendingCaretRef.current = result.cursor
                  onChange(result.value)
                  onCaretChange?.(result.cursor)
                  return
                }
              }

              if (event.key === 'ArrowLeft' && atStart && textIndex > 0) {
                event.preventDefault()
                const previous = textareasRef.current[textIndex - 1]
                previous?.focus()
                const caret = previous?.value.length ?? 0
                previous?.setSelectionRange(caret, caret)
                return
              }

              if (event.key === 'ArrowRight' && atEnd && textIndex < lastTextIndex) {
                event.preventDefault()
                const next = textareasRef.current[textIndex + 1]
                next?.focus()
                next?.setSelectionRange(0, 0)
                return
              }

              onKeyDown(event)
            }}
            className={cn(
              'app-composer-field block max-h-40 w-auto resize-none border-0 bg-transparent px-0 py-0 text-[13px] leading-[1.375rem] shadow-none hover:bg-transparent focus-visible:ring-0 md:text-[13px] dark:bg-transparent dark:hover:bg-transparent min-h-[1.375rem]',
              isLast ? 'app-composer-input' : 'app-composer-inline-input'
            )}
          />
        )
      })}
    </>
  )
}

function focusSerializedCaret(
  value: string,
  textareas: Array<HTMLTextAreaElement | null>,
  cursor: number
): boolean {
  const { textIndex, local } = resolveComposerTextCaret(value, cursor)
  const node = textareas[textIndex] ?? textareas.filter(Boolean).at(-1)
  if (!node) return false
  node.focus()
  const nextLocal = Math.max(0, Math.min(node.value.length, local))
  node.setSelectionRange(nextLocal, nextLocal)
  return true
}
