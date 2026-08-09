import { AgentBrain } from './brain'
import { resolveAuditModel } from './command-auditor'
import type { AgentConfig } from './types'

export const COMMAND_PURPOSE_TIMEOUT_MS = 5_000

const PURPOSE_SYSTEM_PROMPT_ZH = [
  '你是运维助手。根据用户给出的 shell 命令，用一句中文说明其用途。',
  '要求：只输出一句话；不要复述命令本身；不要列表或 markdown；不要道歉或开场白。',
  '示例：经 port-forward 临时隧道检查 ES 集群健康，超时自动清理。'
].join('\n')

const PURPOSE_SYSTEM_PROMPT_EN = [
  'You are an ops assistant. Given a shell command, write one English sentence describing its purpose.',
  'Rules: one sentence only; do not repeat the command; no lists or markdown; no apology or preamble.',
  'Example: Temporarily tunnel via port-forward to check ES cluster health, then auto-clean on timeout.'
].join('\n')

export async function generateCommandPurpose(input: {
  command: string
  locale?: string
  config: AgentConfig
  signal?: AbortSignal
}): Promise<string | null> {
  const command = input.command.trim()
  if (!command) return null

  const language = resolvePurposeLanguage(input.locale)
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  if (input.signal) {
    if (input.signal.aborted) return null
    input.signal.addEventListener('abort', onAbort, { once: true })
  }
  const timeout = setTimeout(() => controller.abort(), COMMAND_PURPOSE_TIMEOUT_MS)

  try {
    const brain = new AgentBrain(input.config)
    const resolved = resolveAuditModel(input.config)
    const completion = await brain.chat(
      {
        temperature: 0,
        max_tokens: 80,
        messages: [
          {
            role: 'system',
            content: language === 'zh-CN' ? PURPOSE_SYSTEM_PROMPT_ZH : PURPOSE_SYSTEM_PROMPT_EN
          },
          { role: 'user', content: command }
        ]
      },
      { signal: controller.signal, model: resolved.modelId }
    )
    const text = (completion.choices[0]?.message.content ?? '').trim().replace(/\s+/g, ' ')
    if (!text) return null
    // Drop accidental fencing / quotes
    const cleaned = text
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^用途[:：]\s*/i, '')
      .replace(/^Purpose[:：]\s*/i, '')
      .trim()
    return cleaned || null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    input.signal?.removeEventListener('abort', onAbort)
  }
}

function resolvePurposeLanguage(locale: string | undefined): 'zh-CN' | 'en' {
  return locale?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}
