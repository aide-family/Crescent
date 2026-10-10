import { agentClient, storageClient } from '@renderer/clients'
import type { WikiDocument } from '../../../shared/agent-types'
import type { Dictionary } from '@renderer/i18n'
import type { AgentLogEntryInput } from '@renderer/lib/terminal-tabs'
import { type ComposerInputHandle } from '@renderer/components/ComposerEditor'
import { type SkillManageMessage } from '@renderer/components/StatusIndicators'
import { addUniqueSkillRef } from '@renderer/lib/agent-input'
import { getDefaultWikiPreviewWidth } from '@renderer/lib/app-runtime'
import {
  capturePinIsActionable,
  captureReadyLogText,
  createCaptureDraftJob,
  createCaptureGenerateQueue,
  findCaptureJob,
  jobHasContent,
  patchCaptureJob,
  removeCaptureJob,
  upsertCaptureJob,
  type CaptureDraftFields,
  type CaptureDraftJob
} from '@renderer/lib/capture-draft-ui'
import {
  buildCaptureSummary,
  buildSessionCaptureSummary,
  collectLiveCaptureTraces,
  hasCaptureableContent,
  historyLogsToCaptureEntries,
  type CaptureLogEntry
} from '@renderer/lib/sop-summary'
import {
  getSessionDisplayTitle,
  resolveSessionChatTabId,
  type AgentLogEntry,
  type AgentRunViewState,
  type AgentTerminalTab
} from '@renderer/lib/terminal-tabs'
import { TOAST_INTERVENTION_DURATION_MS } from '@renderer/lib/toast-policy'
import { upsertWikiSummary } from '@renderer/lib/wiki'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { buildAgentSessionTrace } from '../../../shared/agent-session-trace'
import {
  CAPTURE_BACKGROUND_TIMEOUT_MS,
  type AgentSkillOption,
  type CaptureKind,
  type StoredAgentRun,
  type StoredSessionHistoryItem,
  type WikiDocumentSummary
} from '../../../shared/agent-types'
import { mergeCaptureTraces } from '../../../shared/capture-transcript'

interface Parameters {
  tabsRef: RefObject<AgentTerminalTab[]>
  activeTabIdRef: RefObject<string>
  locale: 'en' | 'zh-CN'
  t: Dictionary
  appendLog: (entry: AgentLogEntryInput, tabId?: string) => number
  liveRunByLogId: Record<number, AgentRunViewState>
  sessionChatTab: AgentTerminalTab
  setWikiDocuments: Dispatch<SetStateAction<WikiDocumentSummary[]>>
  setSelectedWikiDocument: Dispatch<SetStateAction<WikiDocument | null>>
  setWikiEditContent: Dispatch<SetStateAction<string>>
  setWikiEditing: Dispatch<SetStateAction<boolean>>
  setWikiPreviewWidth: Dispatch<SetStateAction<number>>
  setWikiMessage: Dispatch<SetStateAction<SkillManageMessage | null>>
  setSkills: Dispatch<SetStateAction<AgentSkillOption[]>>
  updateTab: (tabId: string, updater: (tab: AgentTerminalTab) => AgentTerminalTab) => void
  agentInputRef: RefObject<ComposerInputHandle | null>
}

export function useCaptureController({
  tabsRef,
  activeTabIdRef,
  locale,
  t,
  appendLog,
  liveRunByLogId,
  sessionChatTab,
  setWikiDocuments,
  setSelectedWikiDocument,
  setWikiEditContent,
  setWikiEditing,
  setWikiPreviewWidth,
  setWikiMessage,
  setSkills,
  updateTab,
  agentInputRef
}: Parameters) {
  const [savingSopLogId, setSavingSopLogId] = useState<number | null>(null)

  const [savingHistorySkillTabId, setSavingHistorySkillTabId] = useState<string | null>(null)

  const [captureJobs, setCaptureJobs] = useState<CaptureDraftJob[]>([])

  const [captureDialogKind, setCaptureDialogKind] = useState<CaptureKind | null>(null)

  const captureJobsRef = useRef<CaptureDraftJob[]>([])

  const captureJobIdRef = useRef(0)

  const captureGenerateQueueRef = useRef(createCaptureGenerateQueue())

  const startCaptureFromCurrentSessionRef = useRef<
    (
      kind: CaptureKind,
      scope: 'turn' | 'session',
      seedText?: string,
      tabId?: string
    ) => Promise<void>
  >(async () => undefined)

  function setCaptureJobsSync(
    updater: CaptureDraftJob[] | ((current: CaptureDraftJob[]) => CaptureDraftJob[])
  ): void {
    setCaptureJobs((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      captureJobsRef.current = next
      return next
    })
  }

  const [savingHistoryWikiTabId, setSavingHistoryWikiTabId] = useState<string | null>(null)

  useEffect(() => {
    return agentClient.onCaptureRequested((payload) => {
      void startCaptureFromCurrentSessionRef.current(
        payload.kind === 'skill' ? 'skill' : 'sop',
        payload.scope === 'turn' ? 'turn' : 'session',
        payload.seedText ?? '',
        payload.chatTabId
      )
    })
  }, [])

  async function generateCaptureDraftFromSummary(input: {
    kind: CaptureKind
    summary: string
    draft?: string
    notes?: string
    refining?: boolean
  }): Promise<void> {
    const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    const refining = Boolean(input.refining)
    const existing = findCaptureJob(captureJobsRef.current, {
      kind: input.kind,
      tabId: chatTabId
    })
    if (refining) {
      if (!existing || !existing.content.trim()) return
    }

    const jobId = refining && existing ? existing.jobId : String(++captureJobIdRef.current)
    if (refining) {
      setCaptureJobsSync((current) =>
        patchCaptureJob(current, jobId, {
          generating: false,
          refining: true,
          error: null,
          conflict: false,
          summary: input.summary
        })
      )
    } else {
      setCaptureJobsSync((current) =>
        upsertCaptureJob(
          current,
          createCaptureDraftJob({
            jobId,
            kind: input.kind,
            tabId: chatTabId,
            summary: input.summary
          })
        )
      )
    }

    await captureGenerateQueueRef.current.enqueue(async () => {
      if (!findCaptureJob(captureJobsRef.current, { jobId })) return
      try {
        const generated = await agentClient.generateCaptureDraft({
          kind: input.kind,
          summary: input.summary,
          locale,
          draft: input.draft,
          notes: input.notes,
          timeoutMs: CAPTURE_BACKGROUND_TIMEOUT_MS
        })
        if (!findCaptureJob(captureJobsRef.current, { jobId })) return
        if (!generated.ok || !generated.content?.trim()) {
          throw new Error(generated.error || t.capture.failed)
        }
        const readyLogId = refining
          ? (existing?.readyLogId ?? null)
          : appendLog({ kind: 'status', text: captureReadyLogText(input.kind, t) }, chatTabId)
        setCaptureJobsSync((current) => {
          const live = findCaptureJob(current, { jobId })
          return patchCaptureJob(current, jobId, {
            title: generated.title ?? live?.title ?? '',
            content: generated.content ?? '',
            skillName: generated.skillName ?? live?.skillName ?? '',
            generating: false,
            refining: false,
            phase: 'ready',
            readyLogId,
            error: null
          })
        })
        if (!refining) toast.success(t.capture.generated)
      } catch (error) {
        if (!findCaptureJob(captureJobsRef.current, { jobId })) return
        const message = error instanceof Error ? error.message : String(error)
        setCaptureJobsSync((current) => {
          const live = findCaptureJob(current, { jobId })
          if (!live) return current
          const keepContent = jobHasContent(live)
          return patchCaptureJob(current, jobId, {
            generating: false,
            refining: false,
            phase: keepContent ? 'ready' : 'error',
            error: `${t.capture.failed}: ${message}`
          })
        })
        toast.error(`${t.capture.failed}: ${message}`, { duration: TOAST_INTERVENTION_DURATION_MS })
      }
    })
  }

  async function startCaptureFromCurrentSession(
    kind: CaptureKind,
    scope: 'turn' | 'session',
    seedText = '',
    tabId?: string
  ): Promise<void> {
    const chatTabId =
      tabId?.trim() || resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    const memoryLog = tabsRef.current.find((tab) => tab.id === chatTabId)?.agentLog ?? []
    let log: CaptureLogEntry[] = memoryLog.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      text: entry.text
    }))
    let runs: StoredAgentRun[] = []
    try {
      const [history, storedRuns] = await Promise.all([
        storageClient.getSessionHistory(chatTabId),
        storageClient.listAllAgentRuns(chatTabId)
      ])
      runs = storedRuns
      if ((history?.logs.length ?? 0) > memoryLog.length) {
        log = historyLogsToCaptureEntries(history!.logs)
      }
    } catch {
      // Use the in-memory log when SQLite is unavailable.
    }

    const liveTraces = collectLiveCaptureTraces({
      log,
      tabId: chatTabId,
      liveRunByLogId
    })
    const traces = mergeCaptureTraces(
      buildAgentSessionTrace({
        tabId: chatTabId,
        title: getSessionDisplayTitle(sessionChatTab, tabsRef.current, activeTabIdRef.current),
        runs
      }).runs,
      liveTraces
    )
    const entry = [...log].reverse().find((item) => item.kind === 'assistant')
    const summary = buildSessionCaptureSummary({
      traces,
      log,
      entry,
      liveRun: entry ? liveRunByLogId[entry.id] : undefined,
      scope,
      seedText,
      t
    })
    if (!hasCaptureableContent({ log, seedText }) && !summary.trim()) {
      toast.error(t.capture.empty, { duration: TOAST_INTERVENTION_DURATION_MS })
      return
    }
    void generateCaptureDraftFromSummary({ kind, summary })
  }

  async function saveAgentTurnAsWikiSop(entry: AgentLogEntry): Promise<void> {
    if (savingSopLogId === entry.id) return
    const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    const log = tabsRef.current.find((tab) => tab.id === chatTabId)?.agentLog ?? []
    if (!hasCaptureableContent({ log })) {
      toast.error(t.capture.empty, { duration: TOAST_INTERVENTION_DURATION_MS })
      return
    }
    setSavingSopLogId(entry.id)
    try {
      const summary = buildCaptureSummary({
        log,
        entry,
        liveRun: liveRunByLogId[entry.id],
        scope: 'turn',
        t
      })
      void generateCaptureDraftFromSummary({ kind: 'sop', summary })
    } finally {
      setSavingSopLogId(null)
    }
  }

  async function saveHistorySessionToCapture(
    item: StoredSessionHistoryItem,
    kind: CaptureKind
  ): Promise<void> {
    if (kind === 'skill') setSavingHistorySkillTabId(item.tabId)
    else setSavingHistoryWikiTabId(item.tabId)
    try {
      const [detail, runs] = await Promise.all([
        storageClient.getSessionHistory(item.tabId),
        storageClient.listAllAgentRuns(item.tabId)
      ])
      if (!detail) return
      const log = historyLogsToCaptureEntries(detail.logs)
      const traces = buildAgentSessionTrace({
        tabId: item.tabId,
        title: detail.title,
        runs
      }).runs
      const summary = buildSessionCaptureSummary({
        traces,
        log,
        scope: 'session',
        seedText: detail.title,
        t
      })
      if (!hasCaptureableContent({ log, seedText: detail.title }) && !summary.trim()) {
        toast.error(t.capture.empty, { duration: TOAST_INTERVENTION_DURATION_MS })
        return
      }
      void generateCaptureDraftFromSummary({ kind, summary })
    } catch (error) {
      toast.error(
        `${t.capture.failed}: ${error instanceof Error ? error.message : String(error)}`,
        { duration: TOAST_INTERVENTION_DURATION_MS }
      )
    } finally {
      setSavingHistoryWikiTabId(null)
      setSavingHistorySkillTabId(null)
    }
  }

  async function saveHistorySessionToWiki(item: StoredSessionHistoryItem): Promise<void> {
    await saveHistorySessionToCapture(item, 'sop')
  }

  async function saveHistorySessionToSkill(item: StoredSessionHistoryItem): Promise<void> {
    await saveHistorySessionToCapture(item, 'skill')
  }

  function dialogCaptureJob(): CaptureDraftJob | undefined {
    if (captureDialogKind == null) return undefined
    const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    return findCaptureJob(captureJobsRef.current, {
      kind: captureDialogKind,
      tabId: chatTabId
    })
  }

  function patchDialogCaptureJob(patch: Partial<CaptureDraftJob>): void {
    const job = dialogCaptureJob()
    if (!job) return
    setCaptureJobsSync((current) => patchCaptureJob(current, job.jobId, patch))
  }

  async function refineCaptureDraft(fields: CaptureDraftFields): Promise<void> {
    const job = dialogCaptureJob()
    if (!job || !job.summary.trim() || !fields.content.trim()) return
    patchDialogCaptureJob(fields)
    await generateCaptureDraftFromSummary({
      kind: job.kind,
      summary: job.summary,
      draft: fields.content,
      notes: fields.notes,
      refining: true
    })
  }

  async function commitCaptureDraft(fields: CaptureDraftFields): Promise<void> {
    const job = dialogCaptureJob()
    if (!job || !fields.content.trim() || job.committing) return
    patchDialogCaptureJob(fields)
    setCaptureJobsSync((current) =>
      patchCaptureJob(current, job.jobId, { committing: true, error: null })
    )
    try {
      const result = await agentClient.commitCaptureDraft({
        kind: job.kind,
        title: fields.title,
        content: fields.content,
        skillName: fields.skillName,
        overwrite: job.overwrite
      })
      if (result.conflict) {
        setCaptureJobsSync((current) =>
          patchCaptureJob(current, job.jobId, {
            committing: false,
            conflict: true,
            error: t.capture.conflict
          })
        )
        return
      }
      if (!result.ok) {
        throw new Error(result.error || t.wiki.saveFailed)
      }
      if (result.document) {
        setWikiDocuments((current) => upsertWikiSummary(current, result.document!))
        setSelectedWikiDocument(result.document)
        setWikiEditContent(result.document.content)
        setWikiEditing(true)
        setWikiPreviewWidth(getDefaultWikiPreviewWidth())
        setWikiMessage({ type: 'success', text: `${t.capture.savedSop}: ${result.document.title}` })
        toast.success(`${t.capture.savedSop}: ${result.document.title}`)
      }
      if (result.skill) {
        setSkills(await agentClient.listSkills())
        updateTab(sessionChatTab.id, (tab) => ({
          ...tab,
          skillRefs: addUniqueSkillRef(tab.skillRefs, result.skill!)
        }))
        toast.success(`${t.capture.savedSkill}: ${result.skill.name}`)
      }
      setCaptureJobsSync((current) => removeCaptureJob(current, job.jobId))
      setCaptureDialogKind(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setCaptureJobsSync((current) =>
        patchCaptureJob(current, job.jobId, { committing: false, error: message })
      )
      toast.error(message, { duration: TOAST_INTERVENTION_DURATION_MS })
    }
  }

  function openCaptureDraft(kind: CaptureKind): void {
    const chatTabId = resolveSessionChatTabId(tabsRef.current, activeTabIdRef.current)
    const job = findCaptureJob(captureJobsRef.current, { kind, tabId: chatTabId })
    if (!job || !capturePinIsActionable(job.phase, jobHasContent(job))) return
    agentInputRef.current?.blur()
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.closest('.app-composer-body')) {
      focused.blur()
    }
    setCaptureDialogKind(kind)
  }
  useEffect(() => {
    startCaptureFromCurrentSessionRef.current = startCaptureFromCurrentSession
  })
  return {
    savingSopLogId,
    setSavingSopLogId,
    savingHistorySkillTabId,
    setSavingHistorySkillTabId,
    captureJobs,
    setCaptureJobs,
    captureDialogKind,
    setCaptureDialogKind,
    captureJobsRef,
    captureJobIdRef,
    captureGenerateQueueRef,
    startCaptureFromCurrentSessionRef,
    setCaptureJobsSync,
    savingHistoryWikiTabId,
    setSavingHistoryWikiTabId,
    generateCaptureDraftFromSummary,
    startCaptureFromCurrentSession,
    saveAgentTurnAsWikiSop,
    saveHistorySessionToCapture,
    saveHistorySessionToWiki,
    saveHistorySessionToSkill,
    dialogCaptureJob,
    patchDialogCaptureJob,
    refineCaptureDraft,
    commitCaptureDraft,
    openCaptureDraft
  }
}
