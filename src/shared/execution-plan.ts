/** Independent of communication style; approvals are never persisted. */
export type ExecutionMode = 'immediate' | 'planned'
export function normalizeExecutionMode(value: unknown): ExecutionMode {
  return value === 'planned' ? 'planned' : 'immediate'
}

export interface PlanCheck {
  command: string
  /** Exact, trimmed output. Use metadata/checksums, never secret contents. */
  expectedOutput: string
}
export interface ChangePlanStep {
  id: string
  kind: 'precheck' | 'backup' | 'backup-verify' | 'change' | 'verify'
  title: string
  command: string
  timeoutMs: number
  expectedOutput: string
  /** Read-only condition checked immediately before this step. */
  precondition: PlanCheck
  dependsOn: string[]
}
export interface PlanBackup {
  integrity: PlanCheck
  stepId: string
  verificationStepId: string
  location: string
  protects: string
  permissions: string
  retention: string
  cleanup: string
  sensitivity: string
}
export interface ChangePlan {
  version: 1
  title: string
  target: {
    host: string
    cluster: string
    namespace: string
    resources: string[]
    excluded: string[]
  }
  identity: PlanCheck
  backups: PlanBackup[]
  /** Required if backup is not applicable. Operator reviews the concrete alternative. */
  alternativeProtection: string
  impact: string
  stopConditions: string
  recoveryRisk: string
  steps: ChangePlanStep[]
  /** Only these explicitly approved actions may run on a normal step failure. */
  recovery: Array<{ triggerStepId: string; steps: ChangePlanStep[] }>
}
export interface PlanBinding {
  runId: string
  sessionKey: string
  tabId: string
  targetIdentity: string
  digest: string
  expiresAt: number
}
export interface PlanApprovalRequest {
  id: string
  chatTabId?: string
  binding: PlanBinding
  plan: ChangePlan
}
export interface PlanApprovalDecision {
  requestId: string
  digest: string
  approved: boolean
  approveRecovery: boolean
  note?: string
}
export interface PlanProgress {
  requestId: string
  runId: string
  chatTabId?: string
  stepId?: string
  phase:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'started'
    | 'succeeded'
    | 'stopped'
    | 'recovering'
    | 'recovered'
    | 'completed'
  message: string
  at: number
}
