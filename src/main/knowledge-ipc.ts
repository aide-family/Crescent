import { realpath, stat } from 'node:fs/promises'
import { rendererIpc } from './ipc-security'
import { codeIntelligence } from './code-intelligence/service'
import { localDocumentReaderForOwner } from './local-document-ipc'
import { readAgentConfig } from './crescent-store'
import { resolveAgentWorkspaceCwd } from './agent/pi-cwd'
import { memoryService, knowledgeText } from './memory/service'
import { extractHistory } from './memory/extraction'
import { learningTarget, assertLearningAuthorized } from './memory/learning-target'
import { startAutoLearning, cancelAutoLearning, autoLearnError } from './memory/auto-learning'
import type {
  MemoryInput,
  MemorySettings,
  MemoryRelation,
  MemoryModelSelection,
  MemoryLearnOptions
} from '../shared/knowledge'
import type { WebContents } from 'electron'

const jobs = new Map<number, AbortController>()
const learning = new Map<number, AbortController>()
async function scopedRoot(owner: number, root?: string): Promise<string> {
  const path =
    root === undefined ? resolveAgentWorkspaceCwd(readAgentConfig()) : knowledgeText(root, 4096)
  const canonical = await (await localDocumentReaderForOwner(owner)).authorize(path)
  if (!(await stat(canonical)).isDirectory()) throw new Error('索引根目录必须是已授权目录')
  return realpath(canonical)
}
function ownedJob(owner: WebContents, map: Map<number, AbortController>): AbortController {
  if (map.has(owner.id)) throw new Error('任务仍在运行')
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  owner.once('destroyed', abort)
  owner.once('did-start-navigation', abort)
  controller.signal.addEventListener(
    'abort',
    () => {
      owner.removeListener('destroyed', abort)
      owner.removeListener('did-start-navigation', abort)
    },
    { once: true }
  )
  map.set(owner.id, controller)
  return controller
}
export function registerKnowledgeIpc(): void {
  startAutoLearning()
  rendererIpc.handle('knowledge:code-status', async (event, root?: string) =>
    codeIntelligence().status(await scopedRoot(event.sender.id, root))
  )
  rendererIpc.handle('knowledge:code-index', async (event, root?: string) => {
    const canonical = await scopedRoot(event.sender.id, root)
    const job = ownedJob(event.sender, jobs)
    try {
      return await codeIntelligence().index(canonical, job.signal)
    } finally {
      job.abort()
      jobs.delete(event.sender.id)
    }
  })
  rendererIpc.handle('knowledge:code-cancel', (event) => {
    jobs.get(event.sender.id)?.abort()
  })
  rendererIpc.handle('knowledge:code-clear', async (event, root?: string) =>
    codeIntelligence().clear(await scopedRoot(event.sender.id, root))
  )
  rendererIpc.handle(
    'knowledge:code-search',
    async (event, payload: { root?: string; query: string; mode: string }) => {
      const root = await scopedRoot(event.sender.id, payload?.root),
        query = knowledgeText(payload?.query, 200)
      switch (payload?.mode) {
        case 'search':
          return codeIntelligence().search(root, query)
        case 'symbol':
          return codeIntelligence().lookup(root, query)
        case 'dependency':
          return codeIntelligence().trace(root, query)
        case 'impact':
          return codeIntelligence().trace(root, query, true)
        default:
          throw new Error('Invalid code query mode')
      }
    }
  )
  rendererIpc.handle('knowledge:memory-snapshot', () => ({
    ...memoryService().snapshot(),
    autoLearnError: autoLearnError()
  }))
  rendererIpc.handle('knowledge:memory-save', (_event, input: MemoryInput) =>
    memoryService().save(input)
  )
  rendererIpc.handle('knowledge:memory-delete', (_event, id: string) => memoryService().remove(id))
  rendererIpc.handle('knowledge:memory-clear', () => {
    for (const job of learning.values()) job.abort()
    cancelAutoLearning()
    memoryService().clear()
  })
  rendererIpc.handle('knowledge:memory-settings', (_event, settings: MemorySettings) => {
    const previous = memoryService().settings()
    if (
      settings?.autoLearn &&
      (!previous.autoLearn ||
        JSON.stringify(previous.learningSelection) !== JSON.stringify(settings.learningSelection))
    )
      assertLearningAuthorized(learningTarget(settings.learningSelection))
    memoryService().configure(settings)
    if (!settings.autoLearn) cancelAutoLearning()
  })
  rendererIpc.handle('knowledge:memory-target', (_event, selection?: MemoryModelSelection) =>
    learningTarget(selection)
  )
  rendererIpc.handle(
    'knowledge:memory-consent',
    (_event, payload: { selection?: MemoryModelSelection; targetKey: string }) => {
      const target = learningTarget(payload?.selection)
      if (target.consentKey !== payload?.targetKey)
        throw new Error('整理模型已变化，请刷新并重新确认')
      memoryService().grantHistoryConsent(target.consentKey)
      cancelAutoLearning()
    }
  )
  rendererIpc.handle('knowledge:memory-revoke-consent', () => {
    for (const job of learning.values()) job.abort()
    cancelAutoLearning()
    memoryService().revokeHistoryConsent()
  })
  rendererIpc.handle('knowledge:memory-relate', (_event, relation: MemoryRelation) =>
    memoryService().relate(relation)
  )
  rendererIpc.handle('knowledge:memory-unrelate', (_event, relation: MemoryRelation) =>
    memoryService().unrelate(relation)
  )
  rendererIpc.handle(
    'knowledge:memory-learn',
    async (event, tabId: string, options?: MemoryLearnOptions) => {
      const id = knowledgeText(tabId, 200),
        job = ownedJob(event.sender, learning)
      try {
        return { count: await extractHistory(id, job.signal, options) }
      } finally {
        job.abort()
        learning.delete(event.sender.id)
      }
    }
  )
  rendererIpc.handle('knowledge:memory-cancel', (event) => learning.get(event.sender.id)?.abort())
}
