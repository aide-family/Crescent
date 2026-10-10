import { serializeHostTools } from './host-tools.ts'
import { Agent, Runner, tool, OpenAIProvider, type AgentInputItem } from '@openai/agents'
import { ScriptedModel, assistantMessage, functionCall } from '@openai/agents/testing'
import type { ExperimentOptions, ExperimentRuntime } from './types.ts'

export function createOpenAiExperiment(
  options: ExperimentOptions & { liveModel?: string }
): ExperimentRuntime {
  let controller: AbortController | undefined
  let history: AgentInputItem[] = []
  const runner = new Runner({
    tracingDisabled: true,
    ...(options.liveModel
      ? {
          modelProvider: new OpenAIProvider({
            useResponses: process.env.CRESCENT_POC_CHAT !== '1',
            baseURL: process.env.OPENAI_BASE_URL
          })
        }
      : {})
  })
  const model =
    options.liveModel ??
    new ScriptedModel([
      ...(options.calls?.length
        ? [
            options.calls.map((call, index) =>
              functionCall(call.name, call.input, { callId: `host-${index}` })
            )
          ]
        : []),
      [assistantMessage('HOST_COMPLETE')],
      [assistantMessage('RESUMED')]
    ])
  const agent = new Agent({
    name: 'Crescent isolated runtime evaluation',
    model,
    instructions:
      'Use only the supplied host tools. For a probe request call host_probe once, then return HOST_COMPLETE. Never request files, shell, network, credentials or other tools.',
    modelSettings: { parallelToolCalls: false, maxTokens: 128 },
    tools: serializeHostTools(options.tools).map((host) =>
      tool({
        name: host.name,
        description: host.description,
        parameters: {
          type: 'object',
          properties: host.inputSchema.properties ?? {},
          required: Array.isArray(host.inputSchema.required)
            ? host.inputSchema.required.filter((x): x is string => typeof x === 'string')
            : [],
          additionalProperties: true
        },
        strict: false,
        execute: async (input: unknown) => {
          options.emit?.({ type: 'tool-start', name: host.name })
          const result = await host.execute(input, controller?.signal)
          options.emit?.({ type: 'tool-end', name: host.name })
          return JSON.stringify(result)
        },
        errorFunction: (_context, error) =>
          JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
      })
    )
  })
  return {
    id: 'openai-agents',
    async run(input, signal) {
      controller = new AbortController()
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
      // Host callbacks and model transport receive the same cancellation signal.
      const onAbort = () => controller?.abort(combined.reason)
      combined.addEventListener('abort', onAbort, { once: true })
      if (combined.aborted) onAbort()
      try {
        combined.throwIfAborted()
        const result = await runner.run(agent, [...history, { role: 'user', content: input }], {
          stream: true,
          maxTurns: 4,
          signal: combined
        })
        for await (const event of result)
          if (event.type === 'raw_model_stream_event' && event.data.type === 'output_text_delta')
            options.emit?.({ type: 'token', text: event.data.delta })
        await result.completed
        combined.throwIfAborted()
        history = result.history
        return String(result.finalOutput ?? '')
      } finally {
        combined.removeEventListener('abort', onAbort)
      }
    },
    abort() {
      controller?.abort()
    },
    save() {
      return structuredClone(history)
    },
    restore(value) {
      if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object'))
        throw new Error('Invalid OpenAI transcript')
      // Evaluations restore only their own SDK-produced transcript, never renderer payloads.
      history = structuredClone(value) as AgentInputItem[]
    }
  }
}
