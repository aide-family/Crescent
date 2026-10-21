import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  MemorySnapshot,
  MemoryModelSelection,
  MemoryLearningTarget
} from '../../../shared/knowledge'

export function memoryError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/, '')
    .replace(/^Error:\s*/, '')
}
interface PendingConsent {
  target: MemoryLearningTarget
  ids?: string[]
  auto?: boolean
}
export function useMemoryCenter(open: boolean, selection: MemoryModelSelection) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot>()
  const [learningTarget, setLearningTarget] = useState<MemoryLearningTarget>()
  const [pendingConsent, setPendingConsent] = useState<PendingConsent>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const stopped = useRef(false)
  const { providerId, model } = selection
  const reload = useCallback(async (): Promise<void> => {
    setSnapshot(await window.api.knowledge.memorySnapshot())
    try {
      setLearningTarget(await window.api.knowledge.memoryTarget({ providerId, model }))
    } catch (e) {
      setLearningTarget(undefined)
      setError(memoryError(e))
    }
  }, [providerId, model])
  useEffect(() => {
    let active = true
    if (open) {
      void window.api.knowledge
        .memorySnapshot()
        .then((value) => {
          if (active) setSnapshot(value)
        })
        .catch((e) => {
          if (active) setError(memoryError(e))
        })
      void window.api.knowledge
        .memoryTarget({ providerId, model })
        .then((value) => {
          if (active) {
            setLearningTarget(value)
            setPendingConsent(undefined)
          }
        })
        .catch((e) => {
          if (active) {
            setLearningTarget(undefined)
            setError(memoryError(e))
          }
        })
    }
    return () => {
      active = false
      stopped.current = true
      void window.api.knowledge.memoryCancel()
    }
  }, [open, providerId, model])
  async function perform(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      await reload()
    } catch (e) {
      setError(memoryError(e))
    } finally {
      setBusy(false)
    }
  }
  async function runLearning(ids: string[], target: MemoryLearningTarget): Promise<void> {
    stopped.current = false
    let count = 0,
      done = 0
    for (const id of ids) {
      if (stopped.current) break
      const result = await window.api.knowledge.memoryLearn(id, {
        selection: { providerId: target.providerId, model: target.model },
        targetKey: target.consentKey
      })
      count += result.count
      done++
      setMessage(`已整理 ${done}/${ids.length} 次会话，生成 ${count} 条待审核知识`)
      await reload()
    }
  }
  async function learn(ids: string[]): Promise<void> {
    await perform(async () => {
      const target = await window.api.knowledge.memoryTarget({ providerId, model })
      setLearningTarget(target)
      if (!target.authorized) {
        setPendingConsent({ target, ids })
        return
      }
      await runLearning(ids, target)
    })
  }
  async function setAutoLearn(enabled: boolean): Promise<void> {
    await perform(async () => {
      if (!enabled) {
        await window.api.knowledge.memorySettings({
          ...snapshot?.settings,
          recall: snapshot?.settings.recall ?? true,
          autoLearn: false
        })
        return
      }
      const target = await window.api.knowledge.memoryTarget({ providerId, model })
      if (enabled && !target.authorized) {
        setPendingConsent({ target, auto: true })
        return
      }
      await window.api.knowledge.memorySettings({
        recall: snapshot?.settings.recall ?? true,
        autoLearn: enabled,
        learningSelection: { providerId, model }
      })
    })
  }
  async function confirmConsent(): Promise<void> {
    const pending = pendingConsent
    if (!pending) return
    await perform(async () => {
      const chosen = { providerId: pending.target.providerId, model: pending.target.model }
      await window.api.knowledge.memoryConsent(chosen, pending.target.consentKey)
      setPendingConsent(undefined)
      if (pending.auto || snapshot?.settings.autoLearn)
        await window.api.knowledge.memorySettings({
          recall: snapshot?.settings.recall ?? true,
          autoLearn: true,
          learningSelection: chosen
        })
      if (!pending.auto) await runLearning(pending.ids ?? [], pending.target)
    })
  }
  async function revokeConsent(): Promise<void> {
    stopped.current = true
    await perform(async () => {
      await window.api.knowledge.memoryRevokeConsent()
      setPendingConsent(undefined)
    })
  }
  function cancel(): void {
    stopped.current = true
    void window.api.knowledge.memoryCancel()
  }
  return {
    snapshot,
    error,
    busy,
    message,
    perform,
    learn,
    cancel,
    reload,
    learningTarget,
    pendingConsent,
    confirmConsent,
    revokeConsent,
    setAutoLearn,
    dismissConsent: () => setPendingConsent(undefined)
  }
}
