import type { Dictionary } from '@renderer/i18n'
import type { CaptureKind } from '../../../shared/agent-types'

export type CaptureDraftPhase = 'idle' | 'generating' | 'ready' | 'error'

export type CaptureDraftJob = {
  jobId: string
  kind: CaptureKind
  tabId: string | null
  phase: CaptureDraftPhase
  readyLogId: number | null
  title: string
  content: string
  skillName: string
  notes: string
  overwrite: boolean
  generating: boolean
  refining: boolean
  committing: boolean
  error: string | null
  conflict: boolean
  summary: string
}

export type CaptureDraftPinView = {
  kind: CaptureKind
  phase: CaptureDraftPhase
  hasContent: boolean
}

export type CaptureDraftFields = {
  title: string
  content: string
  skillName: string
  notes: string
}

export type CaptureDraftParentSync = 'full' | 'generated' | 'none'

export function resolveCaptureDraftParentSync(input: {
  open: boolean
  wasOpen: boolean
  busy: boolean
  wasBusy: boolean
}): CaptureDraftParentSync {
  if (input.open && !input.wasOpen) return 'full'
  if (input.open && input.wasBusy && !input.busy) return 'generated'
  return 'none'
}

const KIND_ORDER: CaptureKind[] = ['sop', 'skill']

export function captureReadyLogText(kind: CaptureKind, t: Dictionary): string {
  return kind === 'skill' ? t.capture.readySkill : t.capture.readySop
}

export function capturePinLabel(
  kind: CaptureKind,
  phase: CaptureDraftPhase,
  t: Dictionary
): string {
  if (phase === 'generating') {
    return kind === 'skill'
      ? t.capture.backgroundGeneratingSkill
      : t.capture.backgroundGeneratingSop
  }
  return kind === 'skill' ? t.capture.pinReadySkill : t.capture.pinReadySop
}

export function shouldShowCaptureDraftPin(input: {
  phase: CaptureDraftPhase
  draftTabId: string | null
  activeTabId: string
  agentBusy: boolean
  hasContent: boolean
}): boolean {
  if (input.draftTabId !== input.activeTabId) return false
  if (input.phase === 'generating') return true
  if (!input.agentBusy) return false
  if (input.phase === 'ready') return true
  return input.phase === 'error' && input.hasContent
}

export function capturePinIsActionable(phase: CaptureDraftPhase, hasContent: boolean): boolean {
  return (phase === 'ready' || phase === 'error') && hasContent
}

export function createCaptureDraftJob(input: {
  jobId: string
  kind: CaptureKind
  tabId: string | null
  summary?: string
}): CaptureDraftJob {
  return {
    jobId: input.jobId,
    kind: input.kind,
    tabId: input.tabId,
    phase: 'generating',
    readyLogId: null,
    title: '',
    content: '',
    skillName: '',
    notes: '',
    overwrite: false,
    generating: true,
    refining: false,
    committing: false,
    error: null,
    conflict: false,
    summary: input.summary ?? ''
  }
}

export function jobsForTab(jobs: CaptureDraftJob[], tabId: string): CaptureDraftJob[] {
  return KIND_ORDER.flatMap((kind) =>
    jobs.filter((job) => job.tabId === tabId && job.kind === kind)
  )
}

export function findCaptureJob(
  jobs: CaptureDraftJob[],
  input: { jobId?: string; kind?: CaptureKind; tabId?: string | null }
): CaptureDraftJob | undefined {
  if (input.jobId != null) {
    return jobs.find((job) => job.jobId === input.jobId)
  }
  return jobs.find((job) => job.kind === input.kind && job.tabId === input.tabId)
}

export function upsertCaptureJob(
  jobs: CaptureDraftJob[],
  next: CaptureDraftJob
): CaptureDraftJob[] {
  const withoutSlot = jobs.filter((job) => !(job.kind === next.kind && job.tabId === next.tabId))
  const otherKindSameTab = withoutSlot.filter(
    (job) => job.tabId === next.tabId && job.kind !== next.kind
  )
  const otherTabs = withoutSlot.filter((job) => job.tabId !== next.tabId)
  return [...otherTabs, ...otherKindSameTab.slice(-1), next]
}

export function patchCaptureJob(
  jobs: CaptureDraftJob[],
  jobId: string,
  patch: Partial<CaptureDraftJob>
): CaptureDraftJob[] {
  return jobs.map((job) => (job.jobId === jobId ? { ...job, ...patch } : job))
}

export function removeCaptureJob(jobs: CaptureDraftJob[], jobId: string): CaptureDraftJob[] {
  return jobs.filter((job) => job.jobId !== jobId)
}

export function jobHasContent(job: CaptureDraftJob): boolean {
  return Boolean(job.content.trim())
}

export function shouldHideCaptureReadyLog(input: {
  logId: number
  jobs: CaptureDraftJob[]
  activeTabId: string
  agentBusy: boolean
}): boolean {
  const job = input.jobs.find((item) => item.readyLogId === input.logId)
  if (!job) return false
  return shouldShowCaptureDraftPin({
    phase: job.phase,
    draftTabId: job.tabId,
    activeTabId: input.activeTabId,
    agentBusy: input.agentBusy,
    hasContent: jobHasContent(job)
  })
}

export function hiddenCaptureReadyLogIds(input: {
  jobs: CaptureDraftJob[]
  activeTabId: string
  agentBusy: boolean
}): number[] {
  return input.jobs.flatMap((job) => {
    if (job.readyLogId == null) return []
    return shouldHideCaptureReadyLog({
      logId: job.readyLogId,
      jobs: input.jobs,
      activeTabId: input.activeTabId,
      agentBusy: input.agentBusy
    })
      ? [job.readyLogId]
      : []
  })
}

export function captureReadyLogsForTab(
  jobs: CaptureDraftJob[],
  tabId: string
): Array<{ logId: number; kind: CaptureKind }> {
  return jobsForTab(jobs, tabId).flatMap((job) =>
    job.readyLogId == null ? [] : [{ logId: job.readyLogId, kind: job.kind }]
  )
}

export function visibleCaptureDraftPins(input: {
  jobs: CaptureDraftJob[]
  activeTabId: string
  agentBusy: boolean
}): CaptureDraftPinView[] {
  return jobsForTab(input.jobs, input.activeTabId)
    .filter((job) =>
      shouldShowCaptureDraftPin({
        phase: job.phase,
        draftTabId: job.tabId,
        activeTabId: input.activeTabId,
        agentBusy: input.agentBusy,
        hasContent: jobHasContent(job)
      })
    )
    .map((job) => ({
      kind: job.kind,
      phase: job.phase,
      hasContent: jobHasContent(job)
    }))
}

export function createCaptureGenerateQueue(): {
  enqueue: (task: () => Promise<void>) => Promise<void>
} {
  let chain = Promise.resolve()
  return {
    enqueue(task) {
      const next = chain.then(task, task)
      chain = next.then(
        () => undefined,
        () => undefined
      )
      return next
    }
  }
}
