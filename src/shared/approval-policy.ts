import { isStaticallyReadonly } from './command-guard'
export type ApprovalPolicy = 'manual' | 'safe-auto'
export type MutationPolicy = 'confirm' | 'manual-execution'
export function normalizeApprovalPolicy(value: unknown): ApprovalPolicy {
  return value === 'safe-auto' ? 'safe-auto' : 'manual'
}
export function normalizeMutationPolicy(value: unknown): MutationPolicy {
  return value === 'manual-execution' ? 'manual-execution' : 'confirm'
}
/** Static rules are necessary, never sufficient for sensitive data access. */
export function containsSensitiveInspection(command: string): boolean {
  return /(?:\b(?:env|printenv)\b|\bsecrets?\b|(?:^|[\s/'"])(?:\.ssh|\.aws|\.kube|\.env|shadow|id_rsa|id_ed25519|credentials)(?:[\s/'".]|$)|(?:password|token|private.?key|authorization)|\/proc\/\d+\/environ)/i.test(
    command
  )
}
export function requiresElevatedReadonlyAuthorization(command: string): boolean {
  return /\bsudo\b|\bkubectl\b.*\b(?:exec|logs)\b|\bdocker\b.*\b(?:exec|logs)\b/.test(command)
}
export function canAutomaticallyApprove(
  command: string,
  input: { policy: ApprovalPolicy; grantValid: boolean }
): boolean {
  return (
    !/\b(?:ssh|scp|sftp|curl|wget|nc)\b/.test(command) &&
    isStaticallyReadonly(command) &&
    !containsSensitiveInspection(command) &&
    (!requiresElevatedReadonlyAuthorization(command) ||
      (input.policy === 'safe-auto' && input.grantValid))
  )
}
