import { serializeHostTools } from './host-tools.ts'
import { Agent } from '@cline/agents'
import type {
  AgentModel,
  AgentModelEvent,
  AgentMessage,
  AgentModelRequest,
  AgentToolContext,
  AgentRuntimeEvent
} from '@cline/shared'
import type { ExperimentOptions, ExperimentRuntime } from './types.ts'

export function createClineExperiment(options: ExperimentOptions): ExperimentRuntime {
  let turn = 0
  const model: AgentModel = {
    async *stream(request: AgentModelRequest): AsyncIterable<AgentModelEvent> {
      request.signal?.throwIfAborted()
      if (turn++ === 0 && options.calls?.length) {
        for (const [index, call] of options.calls.entries())
          yield {
            type: 'tool-call-delta',
            index,
            toolCallId: `host-${index}`,
            toolName: call.name,
            input: call.input
          }
        yield { type: 'finish', reason: 'tool-calls' }
      } else {
        yield { type: 'text-delta', text: turn > 2 ? 'RESUMED' : 'HOST_COMPLETE' }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }
        yield { type: 'finish', reason: 'stop' }
      }
    }
  }
  const agent = new Agent({
    model,
    maxIterations: 4,
    toolExecution: 'sequential',
    tools: serializeHostTools(options.tools).map((host) => ({
      name: host.name,
      description: host.description,
      inputSchema: host.inputSchema,
      retryable: false,
      execute: async (input: unknown, context: AgentToolContext) =>
        host.execute(input, context.signal)
    }))
  })
  agent.subscribe((event: AgentRuntimeEvent) => {
    if (event.type === 'assistant-text-delta') options.emit?.({ type: 'token', text: event.text })
    if (event.type === 'tool-started' || event.type === 'tool-finished')
      options.emit?.({
        type: event.type === 'tool-started' ? 'tool-start' : 'tool-end',
        name: event.toolCall.toolName
      })
  })
  return {
    id: 'cline',
    async run(input, signal) {
      signal?.throwIfAborted()
      const abort = () => agent.abort(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
      try {
        const result = await agent.run(input)
        signal?.throwIfAborted()
        if (result.error) throw result.error
        return result.outputText
      } finally {
        signal?.removeEventListener('abort', abort)
      }
    },
    abort() {
      agent.abort()
    },
    save() {
      return structuredClone(agent.snapshot().messages)
    },
    restore(value) {
      if (
        !Array.isArray(value) ||
        value.some((item) => !item || typeof item !== 'object' || !('role' in item))
      )
        throw new Error('Invalid Cline transcript')
      agent.restore(value as AgentMessage[])
    }
  }
}
