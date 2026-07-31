/**
 * Pure policy helpers for SSH connection automation failure handling.
 * Keep reconnect / chat-abort decisions out of App.tsx so they stay testable.
 */

export type ConnectionReconnectPolicy = 'suppress' | 'local-fallback' | 'default'

export function resolveConnectionReconnectPolicy(input: {
  suppressReconnect?: boolean
  automatedLoginInProgress?: boolean
}): ConnectionReconnectPolicy {
  if (input.suppressReconnect) return 'suppress'
  if (input.automatedLoginInProgress) return 'local-fallback'
  return 'default'
}

export function shouldDrainPostConnectionTasks(automationSucceeded: boolean): boolean {
  return automationSucceeded
}

export function formatConnectionAutomationFailure(input: {
  abortLabel: string
  detail?: string
  originalTaskLabel?: string
  originalTask?: string
}): string {
  return [
    input.abortLabel,
    input.detail?.trim() || '',
    input.originalTask?.trim()
      ? `${input.originalTaskLabel ?? 'Original user task'}: ${input.originalTask.trim()}`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}
