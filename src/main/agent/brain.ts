import OpenAI from 'openai'
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool
} from 'openai/resources/chat/completions'

import type { AgentConfig, ToolCatalogEntry } from './types'
import { resolveAgentRuntimeProvider } from './runtime-provider'

export class AgentBrain {
  private readonly client: OpenAI
  private readonly model: string

  constructor(config: AgentConfig) {
    const provider = resolveAgentRuntimeProvider(config)

    this.client = new OpenAI({
      apiKey: provider.apiKey,
      ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {})
    })
    this.model = provider.model
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

  async selectRelevantTools(input: {
    userInput: string
    catalog: ToolCatalogEntry[]
    maxTools: number
  }): Promise<string[]> {
    if (input.catalog.length <= input.maxTools) return input.catalog.map((entry) => entry.name)

    const catalogText = input.catalog
      .map(
        (entry) =>
          `${entry.name}: ${entry.method.toUpperCase()} ${entry.path} - ${entry.description}`
      )
      .join('\n')

    const completion = await this.chat({
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Select the smallest useful set of REST API tools for the user request. Return strict JSON only: {"tools":["tool_name"]}. Do not invent names.'
        },
        {
          role: 'user',
          content: `User request:\n${input.userInput}\n\nAvailable API tools:\n${catalogText}\n\nPick at most ${input.maxTools} tools.`
        }
      ]
    })

    const content = completion.choices[0]?.message.content ?? ''
    const selected = parseSelectedTools(content)
    const known = new Set(input.catalog.map((entry) => entry.name))

    return selected.filter((name) => known.has(name)).slice(0, input.maxTools)
  }
}

export type { ChatCompletionMessageParam, ChatCompletionTool }

function parseSelectedTools(content: string): string[] {
  try {
    const parsed = JSON.parse(content)
    return Array.isArray(parsed?.tools)
      ? parsed.tools.filter((name) => typeof name === 'string')
      : []
  } catch {
    const matches = content.match(/[a-zA-Z0-9_-]{1,64}/g) ?? []
    return matches
  }
}
