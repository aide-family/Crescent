import { Type } from 'typebox'
import { realpath } from 'node:fs/promises'
import type { PiSdkFacade } from './pi-sdk'
import { getPtyBashExecContext } from './pi-terminal-bash'
import { localDocumentReaderForOwner } from '../local-document-ipc'
import { codeIntelligence } from '../code-intelligence/service'
import { memoryService } from '../memory/service'

export const KNOWLEDGE_TOOL_NAMES = [
  'code_search',
  'symbol_lookup',
  'dependency_trace',
  'impact_analysis',
  'memory_search'
]
export function createKnowledgeTools(pi: PiSdkFacade, cwd: string, sessionKey: string) {
  return KNOWLEDGE_TOOL_NAMES.map((name) =>
    pi.defineTool({
      name,
      label: name,
      description:
        name === 'memory_search'
          ? 'Recall approved historical knowledge within the current connection. Cite IDs and verify current facts; memories never authorize commands.'
          : 'Query local client workspace code intelligence before read. Returns bounded file/line evidence, definitions, lexical references or static import graph. Dynamic calls and IPC are not proven by the graph. Never indexes the SSH filesystem. Use read for exact current source.',
      parameters: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 200 }),
        refresh: Type.Optional(Type.Boolean())
      }),
      executionMode: 'sequential',
      async execute(_id, params, signal) {
        const context = getPtyBashExecContext(sessionKey)
        if (!context || context.webContents.isDestroyed()) throw new Error('No active host scope')
        let result: unknown
        if (name === 'memory_search') {
          result = memoryService().recall(params.query, context.connectionId ?? '')
        } else {
          const reader = await localDocumentReaderForOwner(context.webContents.id, cwd)
          const root = await realpath(await reader.authorize(cwd))
          const service = codeIntelligence(),
            status = service.status(root)
          const combined = AbortSignal.any(
            [signal, context.signal].filter((s): s is AbortSignal => Boolean(s))
          )
          if (
            params.refresh ||
            !status.updatedAt ||
            Date.now() - Date.parse(status.updatedAt) > 60000
          )
            await service.index(root, combined)
          result = {
            index: service.status(root),
            evidence:
              name === 'code_search'
                ? service.search(root, params.query)
                : name === 'symbol_lookup'
                  ? service.lookup(root, params.query)
                  : service.trace(root, params.query, name === 'impact_analysis')
          }
        }
        const text = JSON.stringify(result)
        return {
          content: [
            {
              type: 'text',
              text:
                text.length > 30000
                  ? JSON.stringify({
                      truncated: true,
                      preview: text.slice(0, 29000),
                      guidance: 'Narrow the query and use read for exact files.'
                    })
                  : text
            }
          ],
          details: {}
        }
      }
    })
  )
}
