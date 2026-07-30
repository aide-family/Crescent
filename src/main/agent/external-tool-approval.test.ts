import { describe, expect, it } from 'vitest'

import {
  buildExternalToolApprovalCommand,
  buildExternalToolAudit,
  shouldRequireExternalToolApproval
} from './external-tool-approval'
import type { ToolCatalogEntry } from './types'

const openApiWriteTool: ToolCatalogEntry = {
  name: 'create_order',
  method: 'post',
  path: '/orders',
  description: 'Create an order',
  source: 'openapi',
  risk: 'high',
  requiresApproval: true,
  external: true,
  stateChanging: true
}

describe('external-tool-approval', () => {
  it('requires approval only for OpenAPI/MCP tools marked requiresApproval', () => {
    expect(shouldRequireExternalToolApproval(openApiWriteTool)).toBe(true)
    expect(
      shouldRequireExternalToolApproval({
        ...openApiWriteTool,
        method: 'get',
        requiresApproval: false,
        stateChanging: false
      })
    ).toBe(false)
    expect(
      shouldRequireExternalToolApproval({
        name: 'execute_terminal_command',
        method: 'post',
        path: 'terminal://current-session',
        description: 'terminal',
        source: 'built-in',
        risk: 'high',
        requiresApproval: true,
        external: false,
        stateChanging: true
      })
    ).toBe(false)
  })

  it('builds a redacted approval command and audit payload', () => {
    const command = buildExternalToolApprovalCommand({
      toolName: 'create_order',
      rawArguments: JSON.stringify({
        headers: { Authorization: 'Bearer secret' },
        body: { sku: 'book' }
      }),
      catalog: openApiWriteTool,
      userInput: 'Create a book order'
    })
    const audit = buildExternalToolAudit({
      toolName: 'create_order',
      rawArguments: '{}',
      catalog: openApiWriteTool,
      userInput: 'Create a book order'
    })

    expect(command).toContain('OPENAPI POST /orders')
    expect(command).toContain('Tool: create_order')
    expect(command).toContain('[REDACTED]')
    expect(command).not.toContain('Bearer secret')
    expect(audit.requiresApproval).toBe(true)
    expect(audit.risk).toBe('high')
    expect(audit.operationReason).toContain('Create a book order')
  })
})
