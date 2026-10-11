import { isSshCommandLine } from '../../shared/ssh-destination'
import { hasUnterminatedSecretPrompt } from '../../shared/terminal-password-prompt'

export type TerminalWriteSource = 'user' | 'automation'

/** Only an explicit automation write skips manual-SSH origin detection. */
export function resolveTerminalWriteSource(source: unknown): TerminalWriteSource {
  return source === 'automation' ? 'automation' : 'user'
}

/**
 * User-typed `ssh` reclassifies the pane as a manual hop.
 * Login actions and password autofill are automation and must keep the saved connection.
 */
export function shouldMarkManualSshOrigin(input: {
  source: unknown
  line: string
  output: string
}): boolean {
  if (resolveTerminalWriteSource(input.source) !== 'user') return false
  return isSshCommandLine(input.line.trim()) && !hasUnterminatedSecretPrompt(input.output)
}
