import type { AgentRuntimeAdapter, AgentRuntimeSession } from '../types'
import { mapPiSessionEventToAgentEvents } from '../../pi-event-bridge'
import { syncCrescentProvidersToModelRuntime } from '../../pi-model-runtime'
import type { PiSdkFacade } from './loader'

type Options = NonNullable<Parameters<PiSdkFacade['createAgentSession']>[0]>

export function createPiRuntime(pi: PiSdkFacade): AgentRuntimeAdapter<Options> {
  return {
    id: 'pi',
    async listModels(config) {
      const runtime = await syncCrescentProvidersToModelRuntime(config)
      return runtime.getAvailable()
    },
    async createSession(options) {
      const { session } = await pi.createAgentSession(options)
      const adapter: AgentRuntimeSession = {
        get messages() {
          return session.messages
        },
        get model() {
          return session.model
        },
        get isStreaming() {
          return session.isStreaming
        },
        get isCompacting() {
          return session.isCompacting
        },
        prompt: (text) => session.prompt(text),
        steer: async (text) => {
          await session.steer(text)
        },
        abort: () => session.abort(),
        waitForIdle: () => session.waitForIdle(),
        abortRetry: () => session.abortRetry(),
        compact: (instructions) => session.compact(instructions),
        async setModel(model) {
          const resolved = options.modelRuntime?.getModel(model.provider, model.id)
          if (!resolved) throw new Error(`Runtime model unavailable: ${model.provider}/${model.id}`)
          await session.setModel(resolved)
        },
        setThinkingLevel: (level) => session.setThinkingLevel(level),
        setActiveToolsByName: (names) => session.setActiveToolsByName(names),
        getActiveToolNames: () => session.getActiveToolNames(),
        getSessionStats: () => session.getSessionStats(),
        getContextUsage: () => session.getContextUsage(),
        getContext: () => session.sessionManager.buildSessionContext().messages,
        getRevision: () => session.sessionManager.getLeafId() ?? undefined,
        subscribe: (listener, meta) =>
          session.subscribe((event) =>
            listener({
              events: mapPiSessionEventToAgentEvents(event, meta),
              usageChanged: ['compaction_end', 'turn_end', 'message_end'].includes(event.type),
              retryError: event.type === 'auto_retry_start' ? event.errorMessage : undefined,
              compaction:
                event.type === 'compaction_end'
                  ? { reason: event.reason, aborted: event.aborted }
                  : undefined
            })
          ),
        dispose: () => session.dispose()
      }
      return adapter
    }
  }
}
