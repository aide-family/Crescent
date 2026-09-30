import { createHash } from 'node:crypto'
import type { ChangePlan, ChangePlanStep, PlanCheck } from '../../shared/execution-plan'
import { isStaticallyReadonly } from '../../shared/command-guard'
import { collectSimpleCommands } from '../../shared/shell-command'
import { redactSensitiveText } from '../../shared/secret-redaction'

function requireText(value: unknown, name: string, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > 8000 || (!allowEmpty && !value.trim())) {
    throw new Error(`Invalid ${name}`)
  }
  if (redactSensitiveText(value) !== value) throw new Error(`Secrets are not allowed in ${name}`)
}
function textList(value: unknown, name: string, allowEmpty = false): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 40 || (!allowEmpty && !value.length))
    throw new Error(`Invalid ${name}`)
  value.forEach((item) => requireText(item, name))
}
function validateCheck(check: PlanCheck): void {
  if (!check || typeof check !== 'object') throw new Error('Missing read-only check')
  requireText(check.command, 'check command')
  if (/[\r\n]/.test(check.command)) throw new Error('Plan commands must use a single physical line')
  requireText(check.expectedOutput, 'expected output', true)
  if (!isStaticallyReadonly(check.command))
    throw new Error(`Check is not statically read-only: ${check.command}`)
}

/** Bounded initial release. Shell scripts/remote wrappers and irreversible operations need manual review. */
export function isSupportedPlanMutation(command: string): boolean {
  if (/[\n\r;&|`$<>*?{}()]/.test(command)) return false
  const parsed = collectSimpleCommands(command)
  if (!parsed || parsed.length !== 1 || parsed[0].redirects.length) return false
  let argv = parsed[0].argv
  if (argv[0] === 'sudo') {
    argv = argv.slice(1)
    if (argv[0] === '-n') argv = argv.slice(1)
  }
  const [name, ...args] = argv
  if (
    !name ||
    name.includes('/') ||
    args.some((arg) => /^(--preserve-env|--reference|--target-directory|-t)$/.test(arg))
  )
    return false
  const path = /^\/[\w./-]+$/
  if (name === 'cp')
    return args.length === 3 && args[0] === '--' && args.slice(1).every((arg) => path.test(arg))
  if (name === 'install')
    return (
      args.length === 5 &&
      args[0] === '-m' &&
      args[1] === '600' &&
      args[2] === '--' &&
      args.slice(3).every((arg) => path.test(arg))
    )
  if (name === 'systemctl')
    return (
      ['restart', 'reload', 'start', 'stop'].includes(args[0]) &&
      args.length === 2 &&
      /^[\w@-]+\.service$/.test(args[1])
    )
  if (name === 'kubectl') {
    // Atomic replica precondition and exactly one resource; manifests/scripts need manual review.
    return (
      args.length === 6 &&
      /^--context=[\w.-]+$/.test(args[0]) &&
      /^--namespace=[\w.-]+$/.test(args[1]) &&
      args[2] === 'scale' &&
      /^(deployment|statefulset)\/[\w.-]+$/.test(args[3]) &&
      /^--replicas=\d+$/.test(args[4]) &&
      /^--current-replicas=\d+$/.test(args[5])
    )
  }
  return false
}

function validateSteps(steps: ChangePlanStep[], recovery = false): void {
  if (!Array.isArray(steps) || !steps.length || steps.length > 30)
    throw new Error('Plan needs 1–30 steps')
  const seen = new Set<string>()
  for (const step of steps) {
    if (!step || typeof step !== 'object') throw new Error('Invalid step')
    for (const key of ['id', 'title', 'command'] as const) requireText(step[key], key)
    if (/[\r\n]/.test(step.command))
      throw new Error('Plan commands must use a single physical line')
    if (!/^[\w-]{1,80}$/.test(step.id) || seen.has(step.id))
      throw new Error('Duplicate/invalid step id')
    if (!['precheck', 'backup', 'backup-verify', 'change', 'verify'].includes(step.kind))
      throw new Error('Invalid step kind')
    if (!Number.isInteger(step.timeoutMs) || step.timeoutMs < 1000 || step.timeoutMs > 120000)
      throw new Error('Step timeout must be 1–120 seconds')
    requireText(step.expectedOutput, 'step expected output', true)
    validateCheck(step.precondition)
    textList(step.dependsOn, 'dependencies', true)
    if (step.dependsOn.some((id) => !seen.has(id)))
      throw new Error('Dependencies must precede a step')
    if (step.kind === 'change' || step.kind === 'backup') {
      if (!isSupportedPlanMutation(step.command))
        throw new Error('Unsupported plan mutation; use individually reviewed immediate execution')
    } else if (!isStaticallyReadonly(step.command))
      throw new Error('Verification/precheck must be read-only')
    if (recovery && !['change', 'verify'].includes(step.kind))
      throw new Error('Recovery supports change and verify only')
    seen.add(step.id)
  }
  if (steps.at(-1)?.kind !== 'verify') throw new Error('Final step must verify success')
  if (!recovery && steps[0].kind !== 'precheck') throw new Error('First step must be a precheck')
}

export function validateChangePlan(value: unknown): ChangePlan {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 64000)
    throw new Error('Invalid/oversized plan')
  const plan = JSON.parse(JSON.stringify(value)) as ChangePlan
  if (plan.version !== 1) throw new Error('Unsupported plan version')
  for (const key of ['title', 'impact', 'stopConditions', 'recoveryRisk'] as const)
    requireText(plan[key], key)
  requireText(plan.alternativeProtection, 'alternative protection', true)
  if (!plan.target || typeof plan.target !== 'object') throw new Error('Missing target')
  for (const key of ['host', 'cluster', 'namespace'] as const) requireText(plan.target[key], key)
  textList(plan.target.resources, 'resources')
  textList(plan.target.excluded, 'excluded scope')
  validateCheck(plan.identity)
  if (
    plan.identity.command !== 'hostname' ||
    plan.identity.expectedOutput.trim() !== plan.target.host
  )
    throw new Error('Identity must check hostname against the declared target host')
  validateSteps(plan.steps)
  if (!plan.steps.some((step) => step.kind === 'change'))
    throw new Error('Plan must contain a change')
  if (!Array.isArray(plan.backups) || plan.backups.length > 20) throw new Error('Invalid backups')
  if (!Array.isArray(plan.recovery)) throw new Error('Invalid recovery')
  const protectedVerifications = new Set<string>()
  for (const backup of plan.backups) {
    for (const key of [
      'stepId',
      'verificationStepId',
      'location',
      'protects',
      'permissions',
      'retention',
      'cleanup',
      'sensitivity'
    ] as const)
      requireText(backup[key], key)
    const create = plan.steps.find((step) => step.id === backup.stepId)
    const verify = plan.steps.find((step) => step.id === backup.verificationStepId)
    if (
      create?.kind !== 'backup' ||
      verify?.kind !== 'backup-verify' ||
      !verify.dependsOn.includes(create.id)
    )
      throw new Error('Backup must have a dependent verification step')
    if (plan.steps.indexOf(create) >= plan.steps.indexOf(verify))
      throw new Error('Backup verification order invalid')
    validateCheck(backup.integrity)
    if (
      ![`sha256sum -- ${backup.location}`, `shasum -a 256 -- ${backup.location}`].includes(
        backup.integrity.command
      ) ||
      backup.integrity.expectedOutput.match(/^([a-f0-9]{64}) {2}(.+)$/)?.[2] !== backup.location
    )
      throw new Error('Backup integrity needs an exact SHA-256 checksum and artifact path')
    if (
      create.precondition.command !==
        `test -f ${backup.protects} && test ! -L ${backup.protects} && test ! -e ${backup.location} && test ! -L ${backup.location}` ||
      create.precondition.expectedOutput !== ''
    )
      throw new Error(
        'Backup must protect a regular source and cannot overwrite an existing artifact or symlink'
      )
    // Initial support is a private, regular-file backup with byte-for-byte verification.
    if (
      ![backup.location, backup.protects].every((path) => /^\/[\w./-]+$/.test(path)) ||
      backup.location === backup.protects ||
      [backup.location, backup.protects].some((path) => path.split('/').includes('..'))
    )
      throw new Error('Backup source and destination must be distinct absolute file paths')
    if (
      backup.permissions !== '0600' ||
      create.command !== `install -m 600 -- ${backup.protects} ${backup.location}`
    )
      throw new Error('File backup must use install -m 600 with explicit source and destination')
    if (
      verify.command !==
        `test -f ${backup.location} && test -r ${backup.location} && cmp -s -- ${backup.protects} ${backup.location}` ||
      verify.expectedOutput !== ''
    )
      throw new Error('Backup must be a readable regular file identical to the source')
    // Verification must name the artifact and verify metadata/readability without reading contents.
    if (!verify.command.includes(backup.location) || !/\b(stat|test|\[)\b/.test(verify.command))
      throw new Error('Backup verification must check the named artifact metadata/readability')
    if (!create.command.includes(backup.location))
      throw new Error('Backup command must name its artifact')
    protectedVerifications.add(verify.id)
  }
  if (!plan.backups.length && !plan.alternativeProtection.trim())
    throw new Error('Missing backup or alternative protection')
  for (const step of [
    ...plan.steps,
    ...(plan.recovery ?? []).flatMap((item) => item.steps ?? [])
  ]) {
    if (step.kind === 'change' && /^(?:sudo (?:-n )?)?(?:cp|install)\b/.test(step.command)) {
      const args = collectSimpleCommands(step.command)?.[0].argv ?? []
      const destination = args.at(-1)
      if (!destination || !plan.target.resources.includes(destination))
        throw new Error('File changes must name an exact approved resource')
      if (!plan.backups.some((backup) => backup.protects === destination))
        throw new Error('File changes need a verified backup of the destination')
    }
    if (/^(?:sudo (?:-n )?)?systemctl/.test(step.command) && step.kind === 'change') {
      const args = collectSimpleCommands(step.command)?.[0].argv ?? []
      if (!plan.target.resources.includes(args.at(-1) ?? ''))
        throw new Error('Service differs from declared scope')
    }
    if (/^(?:sudo (?:-n )?)?kubectl\b/.test(step.command)) {
      const args = collectSimpleCommands(step.command)?.[0].argv ?? []
      if (step.kind === 'change' && !args.some((arg) => plan.target.resources.includes(arg)))
        throw new Error('Resource differs from declared scope')
      if (
        !args.includes(`--context=${plan.target.cluster}`) ||
        !args.includes(`--namespace=${plan.target.namespace}`)
      )
        throw new Error('Kubectl target differs from declared scope')
    }
  }
  for (const step of plan.steps) {
    if (step.kind === 'backup' && !plan.backups.some((backup) => backup.stepId === step.id))
      throw new Error('Undocumented backup')
    if (
      step.kind === 'change' &&
      plan.backups.length &&
      !step.dependsOn.some((id) => protectedVerifications.has(id))
    )
      throw new Error('Changes must depend on a verified backup')
  }
  if (!Array.isArray(plan.recovery) || plan.recovery.length > 10)
    throw new Error('Invalid recovery')
  const triggers = new Set<string>()
  for (const recovery of plan.recovery) {
    if (
      !plan.steps.some(
        (step) => step.id === recovery.triggerStepId && ['change', 'verify'].includes(step.kind)
      ) ||
      triggers.has(recovery.triggerStepId)
    )
      throw new Error('Recovery needs a unique change/verification trigger')
    validateSteps(recovery.steps, true)
    triggers.add(recovery.triggerStepId)
  }
  for (const backup of plan.backups) {
    const checks = [
      plan.identity.command,
      ...plan.steps.flatMap((step) => [
        step.precondition.command,
        ...(['change', 'backup'].includes(step.kind) ? [] : [step.command])
      ]),
      ...plan.recovery.flatMap((item) =>
        item.steps.flatMap((step) => [
          step.precondition.command,
          ...(step.kind === 'verify' ? [step.command] : [])
        ])
      )
    ]
    if (
      checks.some(
        (command) =>
          command.includes(backup.location) &&
          !collectSimpleCommands(command)?.every((item) =>
            ['test', '[', 'stat', 'cmp', 'sha256sum', 'shasum'].includes(item.argv[0])
          )
      )
    )
      throw new Error('Backup checks must use metadata or silent byte comparison, never contents')
  }
  return plan
}

export function planDigest(plan: ChangePlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}
