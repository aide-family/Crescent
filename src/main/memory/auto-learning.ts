import { memoryService } from './service'
import { extractHistory } from './extraction'
import { learningTarget, assertLearningAuthorized } from './learning-target'
import { listAgentRunsForTab, listSessionHistory } from '../crescent-sqlite'

let controller: AbortController | undefined
let lastError: string | undefined
const attempted = new Set<string>()
let started = false
export function autoLearnError(): string | undefined {
  return lastError
}
export function cancelAutoLearning(): void {
  controller?.abort()
  attempted.clear()
  lastError = undefined
}
export function startAutoLearning(): void {
  if (started) return
  started = true
  // Explicit opt-in only. Remote destinations also need operator consent.
  const timer = setInterval(
    () =>
      void tick().catch((error) => {
        lastError = error instanceof Error ? error.message : '自动整理失败'
      }),
    60000
  )
  timer.unref()
}
async function tick(): Promise<void> {
  if (controller || !memoryService().settings().autoLearn) return
  const selection = memoryService().settings().learningSelection
  let target: ReturnType<typeof learningTarget>
  try {
    target = learningTarget(selection)
    assertLearningAuthorized(target)
  } catch (error) {
    lastError = error instanceof Error ? error.message : '请选择用于整理的模型'
    return
  }
  const lastMessages = new Map(
    listSessionHistory(200).map((session) => [session.tabId, session.lastMessageAt])
  )
  const item = memoryService()
    .snapshot()
    .history.find((history) => {
      if (!['pending', 'changed'].includes(history.state)) return false
      const latest = listAgentRunsForTab(history.tabId, 1)[0]
      return (
        latest &&
        latest.status !== 'running' &&
        Date.now() - Date.parse(lastMessages.get(history.tabId) ?? '') > 60000 &&
        !attempted.has(
          `${history.tabId}:${memoryService().revision(history.tabId)}:${target.consentKey}`
        )
      )
    })
  if (!item) return
  const key = `${item.tabId}:${memoryService().revision(item.tabId)}:${target.consentKey}`
  if (attempted.size > 500) attempted.clear()
  attempted.add(key)
  controller = new AbortController()
  try {
    await extractHistory(item.tabId, controller.signal, { selection, targetKey: target.consentKey })
    lastError = undefined
  } catch (error) {
    if (!controller.signal.aborted)
      lastError = error instanceof Error ? error.message : '自动整理失败'
  } finally {
    controller = undefined
  }
}
