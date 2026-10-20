import { createHash } from 'node:crypto'
import { readAgentConfig } from '../crescent-store'
import { getAgentProviders } from '../agent/model-provider-config'
import { normalizeProviderBaseUrl, isDeepSeekProvider } from '../agent/deepseek-compat'
import type { AgentConfig } from '../../shared/agent-types'
import type { MemoryModelSelection, MemoryLearningTarget } from '../../shared/knowledge'
import { memoryService, knowledgeText } from './service'

export function loopbackEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}
/** Select exactly the displayed model; never silently fall back to a different destination. */
export function resolveLearningTarget(
  config: AgentConfig,
  selection?: MemoryModelSelection
): Omit<MemoryLearningTarget, 'authorized'> {
  const providers = getAgentProviders(config)
  const providerId = selection ? knowledgeText(selection.providerId, 200) : config.providerId
  const model = selection ? knowledgeText(selection.model, 200) : config.model?.trim()
  const provider = providers.find((item) => item.id === providerId)
  if (!provider || !model || !provider.models.some((item) => item.id === model))
    throw new Error('请在聊天栏或设置中选择已启用的模型后重试')
  const url = new URL(normalizeProviderBaseUrl(provider.baseUrl, isDeepSeekProvider(provider)))
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('模型服务地址无效，请在设置中检查')
  const endpoint = url.href.replace(/\/+$/, '')
  const consentKey = createHash('sha256')
    .update(JSON.stringify([provider.id, model, endpoint]))
    .digest('hex')
  return {
    providerId: provider.id,
    providerName: provider.name || provider.id,
    model,
    endpoint,
    local: loopbackEndpoint(endpoint),
    consentKey
  }
}
export function learningTarget(selection?: MemoryModelSelection): MemoryLearningTarget {
  const target = resolveLearningTarget(readAgentConfig(), selection)
  return {
    ...target,
    authorized: target.local || memoryService().hasHistoryConsent(target.consentKey)
  }
}
export function assertLearningAuthorized(target: Omit<MemoryLearningTarget, 'authorized'>): void {
  if (!target.local && !memoryService().hasHistoryConsent(target.consentKey))
    throw new Error('请先确认允许将脱敏后的历史发送给当前模型，再开始整理')
}
