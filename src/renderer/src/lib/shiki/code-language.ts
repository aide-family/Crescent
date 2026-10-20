/** Supported highlight language ids (bundled in highlight-code). */
export type CodeHighlightLang =
  | 'yaml'
  | 'json'
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'go'
  | 'bash'
  | 'docker'
  | 'xml'
  | 'markdown'
  | 'toml'
  | 'ini'
  | 'css'
  | 'sql'
  | 'plaintext'

const ALIAS_TO_LANG: Record<string, CodeHighlightLang> = {
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  javascript: 'javascript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'typescript',
  python: 'python',
  py: 'python',
  go: 'go',
  golang: 'go',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  docker: 'docker',
  dockerfile: 'docker',
  xml: 'xml',
  html: 'xml',
  htm: 'xml',
  markdown: 'markdown',
  md: 'markdown',
  toml: 'toml',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  css: 'css',
  sql: 'sql',
  text: 'plaintext',
  txt: 'plaintext',
  plain: 'plaintext',
  plaintext: 'plaintext',
  log: 'plaintext'
}

/** Map a markdown fence / skill language label to a bundled Shiki lang. */
export function resolveCodeHighlightLang(language: string): CodeHighlightLang {
  const key = language.trim().toLowerCase()
  if (!key) return 'plaintext'
  return ALIAS_TO_LANG[key] ?? 'plaintext'
}
