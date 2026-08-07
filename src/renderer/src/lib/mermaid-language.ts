/** True when a fenced code block language should render as a Mermaid diagram. */
export function isMermaidCodeLanguage(language: string): boolean {
  return language.trim().toLowerCase() === 'mermaid'
}
