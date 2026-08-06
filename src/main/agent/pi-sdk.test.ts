import { describe, expect, it } from 'vitest'

describe('loadPiCodingAgent', () => {
  it('dynamically imports the ESM-only Pi SDK', async () => {
    const { loadPiCodingAgent } = await import('./pi-sdk')
    const pi = await loadPiCodingAgent()
    expect(typeof pi.createAgentSession).toBe('function')
    expect(typeof pi.ModelRuntime.create).toBe('function')
    expect(typeof pi.SessionManager.inMemory).toBe('function')
  })
})
