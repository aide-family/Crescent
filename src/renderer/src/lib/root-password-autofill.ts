/**
 * Decide whether a terminal password prompt can be answered with the
 * connection rootPassword without showing the operator UI.
 */
export interface RootPasswordAutofillInput {
  rootPassword: string | undefined
  alreadyAttempted: boolean
  isAutomatedLogin: boolean
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
  if (password && !input.alreadyAttempted) {
    return { action: 'auto-submit', password }
  }

  return { action: 'prompt' }
}
