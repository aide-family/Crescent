import type { ToolCatalogEntry } from './agent-types'

export const BUILT_IN_TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    name: 'execute_terminal_command',
    method: 'post',
    path: 'terminal://current-session',
    description:
      'Execute one non-interactive shell command in the current visible terminal session, wait for completion, and return exit code plus output.',
    source: 'built-in',
    risk: 'high',
    requiresApproval: true,
    external: false,
    stateChanging: true
  },
  {
    name: 'execute_subterminal_command',
    method: 'post',
    path: 'terminal://temporary-subterminal',
    description:
      'Execute a non-interactive shell command in a named temporary local-shell sub-terminal displayed under the current terminal.',
    source: 'built-in',
    risk: 'high',
    requiresApproval: true,
    external: false,
    stateChanging: true
  },
  {
    name: 'write_local_file',
    method: 'post',
    path: 'file://local-artifact',
    description:
      'Write generated local artifacts such as Markdown reports directly to the Crescent user machine after the user supplies or confirms the destination.',
    source: 'built-in',
    risk: 'medium',
    requiresApproval: false,
    external: false,
    stateChanging: true
  },
  {
    name: 'save_wiki_document',
    method: 'post',
    path: 'wiki://local-markdown',
    description:
      'Save an SOP or best-practice Markdown document into the Crescent local knowledge base stored next to the Crescent config files.',
    source: 'built-in',
    risk: 'low',
    requiresApproval: false,
    external: false,
    stateChanging: true
  },
  {
    name: 'parse_pdf_file',
    method: 'post',
    path: 'file://local-parser/parse_pdf_file',
    description:
      'Parse a local PDF file on the Crescent machine and return extracted text plus metadata.',
    source: 'built-in',
    risk: 'low',
    requiresApproval: false,
    external: false,
    stateChanging: false
  },
  {
    name: 'parse_docx_file',
    method: 'post',
    path: 'file://local-parser/parse_docx_file',
    description:
      'Parse a local DOCX file on the Crescent machine and return extracted document text plus metadata.',
    source: 'built-in',
    risk: 'low',
    requiresApproval: false,
    external: false,
    stateChanging: false
  },
  {
    name: 'parse_markdown_file',
    method: 'post',
    path: 'file://local-parser/parse_markdown_file',
    description:
      'Read a local Markdown, plain-text, source-code, or configuration file on the Crescent machine, including YAML manifests.',
    source: 'built-in',
    risk: 'low',
    requiresApproval: false,
    external: false,
    stateChanging: false
  },
  {
    name: 'analyze_image_file',
    method: 'post',
    path: 'file://local-parser/analyze_image_file',
    description:
      'Analyze a local image file on the Crescent machine with the configured vision-capable model.',
    source: 'built-in',
    risk: 'medium',
    requiresApproval: false,
    external: true,
    stateChanging: false
  },
  {
    name: 'transcribe_audio_file',
    method: 'post',
    path: 'file://local-parser/transcribe_audio_file',
    description:
      'Transcribe a local audio file on the Crescent machine with the configured OpenAI-compatible audio transcription endpoint.',
    source: 'built-in',
    risk: 'medium',
    requiresApproval: false,
    external: true,
    stateChanging: false
  }
]

export function findBuiltInToolCatalogEntry(name: string): ToolCatalogEntry | undefined {
  return BUILT_IN_TOOL_CATALOG.find((tool) => tool.name === name)
}
