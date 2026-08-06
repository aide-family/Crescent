import { createReadStream } from 'fs'
import OpenAI from 'openai'
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming
} from 'openai/resources/chat/completions'

import { resolveAgentRuntimeProvider } from './runtime-provider'
import type { AgentConfig } from './types'

/**
 * Lightweight OpenAI-compatible client retained for non-agent features
 * (voice transcription, ops feedback summarization). The coding agent loop
 * itself runs on @earendil-works/pi-coding-agent.
 */
export class AgentBrain {
  private readonly client: OpenAI
  private readonly model: string

  constructor(config: AgentConfig) {
    const provider = resolveAgentRuntimeProvider(config)
    this.model = provider.model
    this.client = new OpenAI({
      apiKey: provider.apiKey || 'missing-api-key',
      baseURL: provider.baseUrl || undefined
    })
  }

  chat(
    params: Omit<ChatCompletionCreateParamsNonStreaming, 'model' | 'stream'>,
    options?: { signal?: AbortSignal }
  ): Promise<ChatCompletion> {
    return this.client.chat.completions.create(
      {
        model: this.model,
        ...params,
        stream: false
      },
      options
    )
  }

  async transcribeAudio(input: {
    path: string
    model?: string
    language?: string
  }): Promise<string> {
    const result = await this.client.audio.transcriptions.create({
      file: createReadStream(input.path),
      model: input.model || 'whisper-1',
      ...(input.language ? { language: input.language } : {})
    })
    return typeof result === 'string' ? result : result.text
  }
}
