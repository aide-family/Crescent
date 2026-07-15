export interface ShellCommandValidationResult {
  ok: boolean
  error?: string
}

export function validateGeneratedShellCommand(command: string): ShellCommandValidationResult {
  const normalized = command.trim().replace(/\s+/g, ' ')

  if (!normalized) {
    return { ok: false, error: 'Command is empty.' }
  }

  if (isIncompleteShellSyntax(normalized)) {
    return {
      ok: false,
      error:
        'Command is incomplete shell syntax. Generate a concrete, reviewable command with its target and action.'
    }
  }

  return { ok: true }
}

function isIncompleteShellSyntax(command: string): boolean {
  return /^(?:&&|\|\||;|\||do|done|then|fi|else|\{|\})$/.test(command)
}
