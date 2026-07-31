import { describe, expect, it } from 'vitest'

import type { AgentConfig } from '../../shared/agent-types'
import { checkTranscriptionSupport, clearTranscriptionSupportCache } from './transcription-support'

describe('transcription support probe helpers', () => {
  it('marks missing provider credentials as unsupported', async () => {
    clearTranscriptionSupportCache()
    const result = await checkTranscriptionSupport(buildConfig({ apiKey: '', baseUrl: '' }))
    expect(result.supported).toBe(false)
    expect(result.reason).toBe('missing-provider')
  })
})

function buildConfig(input: { apiKey: string; baseUrl: string }): AgentConfig {
  return {
    providers: [
      {
        id: 'test',
        name: 'Test',
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        models: [{ id: 'gpt-4o-mini', name: 'gpt-4o-mini' }]
      }
    ],
    providerId: 'test',
    model: 'gpt-4o-mini',
    agentMode: 'react',
    maxActiveTools: 5,
    commandWhitelist: [],
    openApiProfiles: [],
    openApiBaseUrl: '',
    openApiDocument: '',
    openApiTimeoutMs: 30_000,
    openApiMaxRetries: 2,
    openApiRetryBackoffMs: 300,
    skillRoot: '~/.agents/skills',
    mcpServers: []
  }
}
