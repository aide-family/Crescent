import { formatComposerRefToken, type ComposerRefKind } from './composer-ref-tokens'

const REF_KINDS = new Set<ComposerRefKind>(['wiki', 'skill', 'tool', 'path'])

export function readComposerRefFromElement(
  element: Element
): { kind: ComposerRefKind; id: string } | null {
  const kind = element.getAttribute('data-composer-ref-kind')
  const id = element.getAttribute('data-composer-ref-id')
  if (!kind || !id || !REF_KINDS.has(kind as ComposerRefKind)) return null
  return { kind: kind as ComposerRefKind, id }
}

export function serializeComposerDom(root: HTMLElement): string {
  let result = ''

  function walk(node: Node, isRoot = false): void {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement
    const ref = readComposerRefFromElement(element)
    if (ref) {
      result += formatComposerRefToken(ref.kind, ref.id)
      return
    }
    if (element.tagName === 'BR') {
      result += '\n'
      return
    }

    const block = isBlockElement(element) && !isRoot
    if (block && result.length > 0 && !result.endsWith('\n')) result += '\n'

    for (const child of Array.from(element.childNodes)) walk(child)

    if (block && result.length > 0 && !result.endsWith('\n')) result += '\n'
  }

  walk(root, true)
  if (result === '\n') return ''
  if (endsWithBlockNewline(root) && result.endsWith('\n')) result = result.slice(0, -1)
  return result
}

export function getComposerDomCaret(root: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return serializeComposerDom(root).length
  const caretRange = selection.getRangeAt(0)
  if (!root.contains(caretRange.startContainer) && caretRange.startContainer !== root) {
    return serializeComposerDom(root).length
  }

  const prefix = document.createRange()
  prefix.selectNodeContents(root)
  prefix.setEnd(caretRange.startContainer, caretRange.startOffset)
  const holder = document.createElement('div')
  holder.appendChild(prefix.cloneContents())
  return serializeComposerDom(holder).length
}

export function setComposerDomCaret(root: HTMLElement, offset: number): void {
  const clamped = Math.max(0, offset)
  let remaining = clamped

  const placeBefore = (node: Node): boolean => {
    const range = document.createRange()
    range.setStartBefore(node)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return true
  }

  const placeAfter = (node: Node): boolean => {
    const range = document.createRange()
    range.setStartAfter(node)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return true
  }

  const placeInText = (node: Text, local: number): boolean => {
    const range = document.createRange()
    range.setStart(node, local)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return true
  }

  function walk(node: Node, isRoot = false): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text
      const length = text.data.length
      if (remaining <= length) return placeInText(text, remaining)
      remaining -= length
      return false
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false
    const element = node as HTMLElement
    const ref = readComposerRefFromElement(element)
    if (ref) {
      const length = formatComposerRefToken(ref.kind, ref.id).length
      if (remaining === 0) return placeBefore(element)
      if (remaining < length) return placeAfter(element)
      remaining -= length
      return false
    }
    if (element.tagName === 'BR') {
      if (remaining === 0) return placeBefore(element)
      if (remaining <= 1) return placeAfter(element)
      remaining -= 1
      return false
    }

    const block = isBlockElement(element) && !isRoot
    if (block && remaining <= 0) return placeAfter(element.previousSibling ?? element)

    for (const child of Array.from(element.childNodes)) {
      if (walk(child)) return true
    }
    return false
  }

  if (!walk(root, true)) {
    const range = document.createRange()
    range.selectNodeContents(root)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
  root.focus()
}

function isBlockElement(element: HTMLElement): boolean {
  return element.tagName === 'DIV' || element.tagName === 'P'
}

function endsWithBlockNewline(root: HTMLElement): boolean {
  const last = lastElementChild(root)
  return Boolean(last && isBlockElement(last))
}

function lastElementChild(root: HTMLElement): HTMLElement | null {
  for (let index = root.childNodes.length - 1; index >= 0; index -= 1) {
    const node = root.childNodes[index]
    if (node?.nodeType === Node.ELEMENT_NODE) return node as HTMLElement
  }
  return null
}
