import {
  type ClipboardEvent,
  type FormEvent,
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
import { shouldSkipComposerDomRebuild } from '@renderer/lib/composer-rebuild-policy'
import {
  hasComposerNewlineModifier,
  isComposerNewlineEnter,
  shouldIgnoreComposerInputAfterNewline
} from '@renderer/lib/composer-newline'
import {
  createComposerPadBr,
  ensureComposerEmptySurface,
  getComposerDomCaret,
  insertComposerNewline,
  isCanonicalComposerEmptyDom,
  scrollComposerCaretIntoView,
  serializeComposerDom,
  setComposerDomCaret
} from '@renderer/lib/composer-surface'
import {
  clearImeEnterConfirmGuardUnlessEnter,
  isImeKeyEvent,
  markImeCompositionEnded,
  shouldIgnoreEnterAfterImeConfirm
} from '@renderer/lib/ime-safe-value'
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
  const compositionEndedAtRef = useRef(0)
  const newlineImeWarmupAtRef = useRef(0)
  const mountedRef = useRef(false)
  const lookupsRef = useRef({
    skillRefs,
    wikiRefs,
    toolRefs,
    pathRefs,
    t,
    onChange,
    onCaretChange,
    value
  })

  useLayoutEffect(() => {
    lookupsRef.current = {
      skillRefs,
      wikiRefs,
      toolRefs,
      pathRefs,
      t,
      onChange,
      onCaretChange,
      value
    }
  }, [onCaretChange, onChange, pathRefs, skillRefs, t, toolRefs, value, wikiRefs])

  useLayoutEffect(() => {
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
            if (
              composingRef.current ||
              shouldIgnoreComposerInputAfterNewline(
                newlineImeWarmupAtRef.current,
                performance.now(),
                composingRef.current
              )
            ) {
              return
            }
            setComposerDomCaret(surface, end)
          }
        }
      }
    }
    if (!surface) return

    const isEcho = mountedRef.current && value === lastEmittedRef.current
    mountedRef.current = true
    const newlineWarmup = shouldIgnoreComposerInputAfterNewline(
      newlineImeWarmupAtRef.current,
      performance.now(),
      composingRef.current
    )
    if (
      shouldSkipComposerDomRebuild({
        composing: composingRef.current,
        isEcho,
        valueLength: value.length,
        composerFocused: document.activeElement === surface,
        newlineWarmup,
        canonicalEmpty: isCanonicalComposerEmptyDom(surface)
      })
    ) {
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

    const latest = lookupsRef.current
    const skillById = new Map(latest.skillRefs.map((item) => [item.id, item]))
    const wikiById = new Map(latest.wikiRefs.map((item) => [item.id, item]))
    const toolById = new Map(latest.toolRefs.map((item) => [item.id, item]))
    const pathById = new Map(latest.pathRefs.map((item) => [item.id, item]))

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
            t={latest.t}
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
    if (
      composingRef.current ||
      shouldIgnoreComposerInputAfterNewline(
        newlineImeWarmupAtRef.current,
        performance.now(),
        composingRef.current
      )
    ) {
      pendingCaretRef.current = null
      return
    }
    setComposerDomCaret(surface, caret)
    lookupsRef.current.onCaretChange?.(caret)
    pendingCaretRef.current = null
  }, [agentInputRef, value])

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
    if (next === '') ensureComposerEmptySurface(surface)
    lastEmittedRef.current = next
    lookupsRef.current.onCaretChange?.(getComposerDomCaret(surface))
    scrollComposerCaretIntoView(surface)
    if (next !== lookupsRef.current.value) lookupsRef.current.onChange(next)
  }

  function isComposerInputComposing(event: FormEvent<HTMLElement>): boolean {
    if (composingRef.current) return true
    const native = event.nativeEvent
    return 'isComposing' in native && native.isComposing === true
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
      data-empty={value.length === 0 ? 'true' : undefined}
      onInput={(event) => {
        if (isComposerInputComposing(event)) return
        if (
          shouldIgnoreComposerInputAfterNewline(
            newlineImeWarmupAtRef.current,
            performance.now(),
            composingRef.current
          )
        ) {
          return
        }
        emitFromDom()
      }}
      onCompositionStart={() => {
        composingRef.current = true
        compositionEndedAtRef.current = 0
        newlineImeWarmupAtRef.current = 0
      }}
      onCompositionEnd={() => {
        composingRef.current = false
        compositionEndedAtRef.current = markImeCompositionEnded()
        emitFromDom()
      }}
      onSelect={() => {
        const surface = surfaceRef.current
        if (!surface) return
        lookupsRef.current.onCaretChange?.(getComposerDomCaret(surface))
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
        compositionEndedAtRef.current = clearImeEnterConfirmGuardUnlessEnter(
          compositionEndedAtRef.current,
          event.key
        )

        const imeActive = isImeKeyEvent(event) || composingRef.current
        const enterConfirmsIme =
          event.key === 'Enter' &&
          !hasComposerNewlineModifier(event) &&
          shouldIgnoreEnterAfterImeConfirm(compositionEndedAtRef.current)

        if (enterConfirmsIme) {
          // Confirming an IME candidate must not submit the composer.
          event.preventDefault()
          compositionEndedAtRef.current = 0
          return
        }

        if (imeActive) {
          onKeyDown(event)
          return
        }

        onKeyDown(event)
        if (event.defaultPrevented) return

        if (isComposerNewlineEnter(event)) {
          event.preventDefault()
          insertComposerNewline(event.currentTarget)
          newlineImeWarmupAtRef.current = performance.now()
          emitFromDom()
        }
      }}
    />
  )
}
