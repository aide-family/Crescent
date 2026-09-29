import { writeSystemLog } from '../logging'
import { redactSensitiveText } from '../../shared/secret-redaction'
import { Type } from 'typebox'
import type { PiSdkFacade } from './pi-sdk'
import { getPtyBashExecContext, executeReviewedPtyCommand } from './pi-terminal-bash'
import { readTerminalPlanIdentity } from '../terminal/ipc'
import { safeWebContentsSend } from '../safe-ipc-send'
import { submitAndExecutePlan } from './change-plan'

const text = Type.String({ maxLength: 8000 })
const check = Type.Object({ command: text, expectedOutput: text })
const step = Type.Object({
  id: text,
  kind: Type.Union(
    ['precheck', 'backup', 'backup-verify', 'change', 'verify'].map((kind) => Type.Literal(kind))
  ),
  title: text,
  command: text,
  timeoutMs: Type.Integer({ minimum: 1000, maximum: 120000 }),
  expectedOutput: text,
  precondition: check,
  dependsOn: Type.Array(text)
})
export function createChangePlanTool(
  pi: PiSdkFacade,
  sessionKey: string
): ReturnType<PiSdkFacade['defineTool']> {
  return pi.defineTool({
    name: 'submit_change_plan',
    label: 'Review and execute change plan',
    executionMode: 'sequential',
    description:
      'Submit an exact change plan for operator approval, then let the host execute it once in order. Planned execution only. Inspect first with bash. Use exact trimmed expectedOutput (empty for silent commands), read-only metadata preconditions, explicit target and exclusions, backup creation and independent verification. Supported mutations: cp -- SOURCE DEST or install -m 600 -- SOURCE DEST with absolute file paths; systemctl restart/reload/start/stop UNIT.service; kubectl --context=CONTEXT --namespace=NAMESPACE scale deployment/NAME --replicas=N --current-replicas=N (or statefulset/NAME). All changed resources must match target.resources. Identity must be hostname with expectedOutput equal to target.host. For file backups, protects is the absolute source path, permissions is 0600, creation must be exactly install -m 600 -- SOURCE DEST, verification exactly test -f DEST && test -r DEST && cmp -s -- SOURCE DEST (empty expected output). Backup precondition must be exactly test -f SOURCE && test ! -L SOURCE && test ! -e DEST && test ! -L DEST. Each backup also needs integrity {command: shasum -a 256 -- DEST (or sha256sum -- DEST), expectedOutput: exact SHA-256 plus two spaces plus DEST}, obtained from source before approval. File changes require a backup of the destination and destination in target.resources. No shell scripts, SSH wrappers, delete, reboot or arbitrary programs. Run on the selected pane. Never print backup contents. Recovery is optional and needs separate explicit approval. Each failure stops changes; do not retry unchanged commands.',
    parameters: Type.Object({
      version: Type.Literal(1),
      title: text,
      target: Type.Object({
        host: text,
        cluster: text,
        namespace: text,
        resources: Type.Array(text),
        excluded: Type.Array(text)
      }),
      identity: check,
      backups: Type.Array(
        Type.Object({
          integrity: check,
          stepId: text,
          verificationStepId: text,
          location: text,
          protects: text,
          permissions: text,
          retention: text,
          cleanup: text,
          sensitivity: text
        })
      ),
      alternativeProtection: text,
      impact: text,
      stopConditions: text,
      recoveryRisk: text,
      steps: Type.Array(step),
      recovery: Type.Array(Type.Object({ triggerStepId: text, steps: Type.Array(step) }))
    }),
    async execute(_id, params, signal) {
      const context = getPtyBashExecContext(sessionKey)
      if (
        !context ||
        context.executionMode !== 'planned' ||
        context.fromSubagent ||
        context.subterminalName
      )
        throw new Error('A selected terminal in planned execution mode is required.')
      const tabId = context.executionTabId
      const ownerId = context.webContents.id
      const identity = (): string | undefined =>
        context.webContents.isDestroyed() || context.executionTabId !== tabId
          ? undefined
          : readTerminalPlanIdentity(ownerId, tabId)
      const initialIdentity = identity()
      const windowAbort = new AbortController()
      const onWindowLost = (): void => windowAbort.abort()
      context.webContents.once('destroyed', onWindowLost)
      context.webContents.once('render-process-gone', onWindowLost)
      context.webContents.once('did-start-navigation', onWindowLost)
      const result = await submitAndExecutePlan(params, {
        runId: context.runId,
        sessionKey,
        tabId,
        chatTabId: context.chatTabId,
        ownerId,
        signal: AbortSignal.any(
          [signal, context.signal, windowAbort.signal].filter((item): item is AbortSignal =>
            Boolean(item)
          )
        ),
        targetIdentity: identity,
        execute: (command, timeoutMs, planSignal) =>
          executeReviewedPtyCommand({
            context,
            sessionKey,
            command,
            timeoutMs,
            signal: planSignal,
            planGuard: () => {
              if (!initialIdentity || identity() !== initialIdentity || planSignal.aborted)
                throw new Error('Plan target changed or execution was canceled.')
            }
          }),
        request: (request) => {
          writeSystemLog(
            'info',
            redactSensitiveText(`Change plan submitted: ${JSON.stringify(request)}`)
          )
          safeWebContentsSend(context.webContents, 'agent:plan-approval-request', request)
        },
        progress: (progress) => {
          writeSystemLog(
            'info',
            redactSensitiveText(`Change plan progress: ${JSON.stringify(progress)}`)
          )
          safeWebContentsSend(context.webContents, 'agent:plan-progress', progress)
          context.emit({
            type: 'status',
            runId: context.runId,
            tabId: context.chatTabId,
            message: `[Plan ${progress.phase}${progress.stepId ? ` / ${progress.stepId}` : ''}] ${progress.message}`
          })
        }
      }).finally(() => {
        context.webContents.removeListener('destroyed', onWindowLost)
        context.webContents.removeListener('render-process-gone', onWindowLost)
        context.webContents.removeListener('did-start-navigation', onWindowLost)
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
    }
  })
}
