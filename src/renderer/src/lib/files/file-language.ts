import { resolveCodeHighlightLang, type CodeHighlightLang } from '@renderer/lib/shiki/code-language'

/** Map a remote filename to a bundled Shiki language id. */
export function languageFromFilename(filePath: string): CodeHighlightLang {
  const base = filePath.split('/').pop() || filePath
  const lower = base.toLowerCase()
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) {
    return 'docker'
  }
  const dot = lower.lastIndexOf('.')
  if (dot <= 0 || dot === lower.length - 1) {
    return 'plaintext'
  }
  return resolveCodeHighlightLang(lower.slice(dot + 1))
}
