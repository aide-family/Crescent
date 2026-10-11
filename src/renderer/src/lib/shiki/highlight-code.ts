import { createBundledHighlighter, createSingletonShorthands } from '@shikijs/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { resolveCodeHighlightLang } from './code-language'

export type { CodeHighlightLang } from './code-language'
export { resolveCodeHighlightLang } from './code-language'

const createHighlighter = createBundledHighlighter({
  langs: {
    yaml: () => import('@shikijs/langs/yaml'),
    json: () => import('@shikijs/langs/json'),
    javascript: () => import('@shikijs/langs/javascript'),
    typescript: () => import('@shikijs/langs/typescript'),
    python: () => import('@shikijs/langs/python'),
    go: () => import('@shikijs/langs/go'),
    bash: () => import('@shikijs/langs/bash'),
    docker: () => import('@shikijs/langs/docker'),
    xml: () => import('@shikijs/langs/xml'),
    markdown: () => import('@shikijs/langs/markdown'),
    toml: () => import('@shikijs/langs/toml'),
    ini: () => import('@shikijs/langs/ini'),
    css: () => import('@shikijs/langs/css'),
    sql: () => import('@shikijs/langs/sql')
  },
  themes: {
    'github-dark': () => import('@shikijs/themes/github-dark')
  },
  engine: createJavaScriptRegexEngine
})

const { codeToHtml } = createSingletonShorthands(createHighlighter)

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Highlight source as HTML using github-dark (Crescent is dark-only). */
export async function highlightCode(code: string, language: string): Promise<string> {
  const lang = resolveCodeHighlightLang(language)
  if (lang === 'plaintext') {
    return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`
  }
  return codeToHtml(code, {
    lang,
    theme: 'github-dark'
  })
}
