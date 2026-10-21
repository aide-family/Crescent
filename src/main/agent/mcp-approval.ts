import { requestCommandApproval } from './command-approval'
import { getPtyBashExecContext } from './pi-terminal-bash'
import { readTerminalPlanIdentity } from '../terminal/ipc'
import { redactSensitiveData, redactSensitiveText } from '../../shared/secret-redaction'
import type { McpToolAuthorizer } from './pi-mcp-tools'

/** Re-resolve the active run at call time: sessions and MCP clients are reused. */
export function mcpToolAuthorizer(sessionKey: string): McpToolAuthorizer {
  return async ({ server, tool, params, signal }) => {
    const context = getPtyBashExecContext(sessionKey)
    if (!context || context.webContents.isDestroyed() || context.signal?.aborted || signal?.aborted)
      return false
    const { webContents, executionTabId, runId } = context
    const identity = readTerminalPlanIdentity(webContents.id, executionTabId)
    if (!identity) return false
    const decision = await requestCommandApproval({
      webContents,
      runId,
      tabId: executionTabId,
      chatTabId: context.chatTabId,
      command: redactSensitiveText(
        `MCP ${server.name || server.id} / ${tool.name}\n${JSON.stringify(redactSensitiveData(params), null, 2)}`
      ),
      signal:
        context.signal && signal
          ? AbortSignal.any([context.signal, signal])
          : (context.signal ?? signal),
      audit: {
        risk: 'medium',
        requiresApproval: true,
        summary: `MCP ${server.id}/${tool.name}`,
        operationReason: 'External tool call requested by the agent.',
        riskPoints: ['Third-party tool behavior is not verified by the host.'],
        impactAnalysis: 'May change external state or disclose data to the configured MCP server.',
        recommendation: 'Review the server, tool and arguments before approving.'
      }
    })
    const current = getPtyBashExecContext(sessionKey)
    return (
      decision.approved &&
      !signal?.aborted &&
      !context.signal?.aborted &&
      current?.runId === runId &&
      current.webContents.id === webContents.id &&
      current.executionTabId === executionTabId &&
      readTerminalPlanIdentity(webContents.id, executionTabId) === identity
    )
  }
}
