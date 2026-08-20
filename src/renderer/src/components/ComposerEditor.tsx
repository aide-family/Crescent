import {
  type ClipboardEvent,
  type KeyboardEvent,
  type RefObject,
  useLayoutEffect,
  useRef
} from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

import { ComposerRefChip } from '@renderer/components/AgentReferenceBadges'
import type { Dictionary } from '@renderer/i18n'
import {
  caretAfterProgrammaticValueChange,
  flattenComposerSegmentsForInline,
  removeComposerRefToken
} from '@renderer/lib/composer-ref-tokens'
import {
  createComposerPadBr,
  getComposerDomCaret,
  insertComposerNewline,
  serializeComposerDom,
  setComposerDomCaret
} from '@renderer/lib/composer-surface'
import type { AgentToolReference } from '@renderer/lib/terminal-tabs'
import type {
  AgentPathReference,
  AgentSkillOption,
  AgentWikiReference
} from '../../../shared/agent-types'

export interface ComposerInputHandle {
  focus: () => void
  blur: () => void
  readonly value: string
  setSelectionRange: (start: number, end?: number) => void
}

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
  agentInputRef?: RefObject<ComposerInputHandle | null>
  skillRefs: AgentSkillOption[]
  wikiRefs: AgentWikiReference[]
  toolRefs: AgentToolReference[]
  pathRefs: AgentPathReference[]
  onChange: (value: string) => void
  onCaretChange?: (cursor: number) => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onPaste: (event: ClipboardEvent<HTMLElement>) => void
}): React.JSX.Element {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const chipRootsRef = useRef<Root[]>([])
  const lastEmittedRef = useRef(value)
  const previousValueRef = useRef(value)
  const pendingCaretRef = useRef<number | null>(null)
  const composingRef = useRef(false)
  const mountedRef = useRef(false)
  const lookupsRef = useRef({ skillRefs, wikiRefs, toolRefs, pathRefs, t, onChange, value })

  useLayoutEffect(() => {
    lookupsRef.current = { skillRefs, wikiRefs, toolRefs, pathRefs, t, onChange, value }

    const surface = surfaceRef.current
    if (agentInputRef) {
      if (!surface) agentInputRef.current = null
      else {
        agentInputRef.current = {
          focus: () => surface.focus(),
          blur: () => surface.blur(),
          get value() {
            return serializeComposerDom(surface)
          },
          setSelectionRange(start: number, end = start) {
            setComposerDomCaret(surface, end)
          }
        }
      }
    }
    if (!surface || composingRef.current) return

    const isEcho = mountedRef.current && value === lastEmittedRef.current
    mountedRef.current = true
    // When empty, always rebuild so a leftover browser <br> cannot hide the
    // CSS placeholder (echo skip would leave non-pad BR in the DOM).
    if (isEcho && value.length > 0) {
      previousValueRef.current = value
      pendingCaretRef.current = null
      return
    }

    const insertedCaret = caretAfterProgrammaticValueChange(previousValueRef.current, value)
    previousValueRef.current = value
    pendingCaretRef.current = insertedCaret

    for (const root of chipRootsRef.current) root.unmount()
    chipRootsRef.current = []
    surface.replaceChildren()

    const skillById = new Map(skillRefs.map((item) => [item.id, item]))
    const wikiById = new Map(wikiRefs.map((item) => [item.id, item]))
    const toolById = new Map(toolRefs.map((item) => [item.id, item]))
    const pathById = new Map(pathRefs.map((item) => [item.id, item]))

    for (const part of flattenComposerSegmentsForInline(value)) {
      if (part.type === 'br') {
        surface.appendChild(document.createElement('br'))
        continue
      }
      if (part.type === 'text') {
        surface.appendChild(document.createTextNode(part.value))
        continue
      }

      const host = document.createElement('span')
      host.contentEditable = 'false'
      host.className = 'app-composer-chip-host'
      host.dataset.composerRefKind = part.kind
      host.dataset.composerRefId = part.id
      surface.appendChild(host)

      const label =
        part.kind === 'wiki'
          ? (wikiById.get(part.id)?.title ?? part.id)
          : part.kind === 'skill'
            ? (skillById.get(part.id)?.name ?? part.id)
            : part.kind === 'tool'
              ? (toolById.get(part.id)?.name ?? part.id)
              : (pathById.get(part.id)?.name ?? part.id)
      const tool = toolById.get(part.id)
      const path = pathById.get(part.id)
      const root = createRoot(host)
      chipRootsRef.current.push(root)
      flushSync(() => {
        root.render(
          <ComposerRefChip
            kind={part.kind}
            id={part.id}
            label={label}
            t={t}
            removable
            atomic
            isMcp={tool?.source === 'mcp'}
            pathKind={path?.kind}
            onRemove={() => {
              const latest = lookupsRef.current
              latest.onChange(removeComposerRefToken(latest.value, part.kind, part.id))
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Backspace' && event.key !== 'Delete') return
              event.preventDefault()
              const latest = lookupsRef.current
              latest.onChange(removeComposerRefToken(latest.value, part.kind, part.id))
            }}
          />
        )
      })
    }

    surface.appendChild(createComposerPadBr())

    lastEmittedRef.current = value
    const caret = pendingCaretRef.current
    if (caret == null) return
    setComposerDomCaret(surface, caret)
    onCaretChange?.(caret)
    pendingCaretRef.current = null
  }, [agentInputRef, onCaretChange, onChange, pathRefs, skillRefs, t, toolRefs, value, wikiRefs])

  useLayoutEffect(() => {
    return () => {
      for (const root of chipRootsRef.current) root.unmount()
      chipRootsRef.current = []
    }
  }, [])

  function emitFromDom(): void {
    const surface = surfaceRef.current
    if (!surface) return
    const next = serializeComposerDom(surface)
    lastEmittedRef.current = next
    onCaretChange?.(getComposerDomCaret(surface))
    if (next !== value) onChange(next)
  }

  return (
    <div
      ref={(node) => {
        surfaceRef.current = node
      }}
      className="app-composer-body"
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      data-empty={value.trim().length === 0 ? 'true' : undefined}
      onInput={() => {
        if (composingRef.current) return
        emitFromDom()
      }}
      onCompositionStart={() => {
        composingRef.current = true
      }}
      onCompositionEnd={() => {
        composingRef.current = false
        emitFromDom()
      }}
      onSelect={() => {
        const surface = surfaceRef.current
        if (!surface) return
        onCaretChange?.(getComposerDomCaret(surface))
      }}
      onPaste={(event) => {
        onPaste(event)
        if (event.defaultPrevented) return
        event.preventDefault()
        const text = event.clipboardData.getData('text/plain')
        if (!text) return
        document.execCommand('insertText', false, text)
        emitFromDom()
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          onKeyDown(event)
          return
        }

        onKeyDown(event)
        if (event.defaultPrevented) return

        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault()
          insertComposerNewline(event.currentTarget)
          emitFromDom()
        }
      }}
    />
  )
}
