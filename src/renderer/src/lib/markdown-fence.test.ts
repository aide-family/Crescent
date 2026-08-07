import { describe, expect, it } from 'vitest'

import {
  resolveMermaidBlockUiState,
  scanMarkdownFence
} from './markdown-fence'

describe('scanMarkdownFence', () => {
  it('detects an unclosed mermaid fence (streaming mid-diagram)', () => {
    const lines = ['```mermaid', 'flowchart TD', '  A --> B']
    const result = scanMarkdownFence(lines, 0)
    expect(result).toEqual({
      closed: false,
      language: 'mermaid',
      code: 'flowchart TD\n  A --> B',
      nextIndex: 3,
      fenceMarker: '```'
    })
  })

  it('detects a closed mermaid fence', () => {
    const lines = ['```mermaid', 'flowchart TD', '  A --> B', '```', 'after']
    const result = scanMarkdownFence(lines, 0)
    expect(result).toEqual({
      closed: true,
      language: 'mermaid',
      code: 'flowchart TD\n  A --> B',
      nextIndex: 4,
      fenceMarker: '```'
    })
  })
})

describe('resolveMermaidBlockUiState', () => {
  it('uses generating for unclosed or streaming failures', () => {
    expect(
      resolveMermaidBlockUiState({
        closed: false,
        streaming: true,
        hasSvg: false,
        hasError: false
      })
    ).toBe('generating')

    expect(
      resolveMermaidBlockUiState({
        closed: true,
        streaming: true,
        hasSvg: false,
        hasError: true
      })
    ).toBe('generating')
  })

  it('uses ready when svg is present', () => {
    expect(
      resolveMermaidBlockUiState({
        closed: true,
        streaming: false,
        hasSvg: true,
        hasError: false
      })
    ).toBe('ready')
  })

  it('uses muted failure when done and render failed', () => {
    expect(
      resolveMermaidBlockUiState({
        closed: true,
        streaming: false,
        hasSvg: false,
        hasError: true
      })
    ).toBe('failed-muted')
  })

  it('uses muted failure when stream ends with unclosed fence', () => {
    expect(
      resolveMermaidBlockUiState({
        closed: false,
        streaming: false,
        hasSvg: false,
        hasError: false
      })
    ).toBe('failed-muted')
  })
})
