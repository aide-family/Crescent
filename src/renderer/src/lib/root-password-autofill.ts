import { isPrivilegePasswordPrompt } from '../../../shared/terminal-password-prompt'

/**
 * Decide whether a terminal password prompt can be answered with the
 * connection rootPassword without showing the operator UI.
 */
export interface RootPasswordAutofillInput {
  rootPassword: string | undefined
  alreadyAttempted: boolean
  isAutomatedLogin: boolean
  /** Live prompt line that triggered the password UI. */
  promptLine?: string
}

export type RootPasswordAutofillDecision =
  | { action: 'auto-submit'; password: string }
  | { action: 'prompt' }
  | { action: 'skip' }

export function decideRootPasswordAutofill(
  input: RootPasswordAutofillInput
): RootPasswordAutofillDecision {
  if (input.isAutomatedLogin) return { action: 'skip' }

  const password = input.rootPassword?.trim()
  if (!password || input.alreadyAttempted) return { action: 'prompt' }

  // Only auto-type rootPassword for privilege escalation prompts (sudo/su).
  // Generic SSH login / OTP prompts must open the operator modal.
  const promptLine = input.promptLine?.trim() ?? ''
  if (!promptLine || !isPrivilegePasswordPrompt(promptLine)) {
    return { action: 'prompt' }
  }

  return { action: 'auto-submit', password }
}
