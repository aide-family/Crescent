import { describe, expect, it, vi } from 'vitest'

import { sanitizeFinalAnswer, TerminalAgentCore } from './core'
import { AgentMemory } from './memory'
import type { AgentConfig, AgentEvent, LocalFileWriter } from './types'

const mockChat = vi.hoisted(() => vi.fn())

vi.mock('./brain', () => ({
  AgentBrain: class {
    chat = mockChat
  }
}))

const config: AgentConfig = {
  providers: [
    {
      id: 'test-provider',
      name: 'Test Provider',
      baseUrl: 'https://model.example.test/v1',
      apiKey: 'test-key',
      models: [{ id: 'test-model', name: 'test-model' }]
    }
  ],
  providerId: 'test-provider',
  model: 'test-model',
  agentMode: 'react',
  maxActiveTools: 5,
  commandWhitelist: [],
  openApiBaseUrl: '',
  openApiDocument: '',
  skillRoot: '~/.agents/skills',
  mcpServers: []
}

describe('sanitizeFinalAnswer', () => {
  it('removes leaked tool-call markup from final answers', () => {
    const text = sanitizeFinalAnswer(
      [
        'No default StorageClass exists, so a hostPath PV must be created first. Check whether the image can be pulled.',
        '',
        '<｜｜DSML｜｜tool_calls>',
        '<｜｜DSML｜｜invoke name="execute_terminal_command">',
        '<｜｜DSML｜｜parameter name="command" string="true">kubectl get pods</｜｜DSML｜｜parameter>',
        '</｜｜DSML｜｜invoke>',
        '</｜｜DSML｜｜tool_calls>'
      ].join('\n'),
      'safety-limit'
    )

    expect(text).toContain('Incomplete')
    expect(text).toContain('No default StorageClass')
    expect(text).not.toContain('tool_calls')
    expect(text).not.toContain('execute_terminal_command')
    expect(text).not.toContain('kubectl get pods')
  })

  it('wraps a bare next command when the safety limit is reached', () => {
    const text = sanitizeFinalAnswer(
      'ls -la /run/containerd/containerd.sock 2>/dev/null; id; groups',
      'safety-limit'
    )

    expect(text).toContain('Incomplete')
    expect(text).toContain('Next Step')
    expect(text).toContain('ls -la /run/containerd/containerd.sock')
  })
})

describe('TerminalAgentCore', () => {
  it('writes the final answer when a running supplement adds a local artifact destination', async () => {
    mockChat.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '# aide cluster architecture\n\n```mermaid\nflowchart TD\n  a --> b\n```'
          }
        }
      ]
    })

    const localFileWriter: LocalFileWriter = {
      writeFile: vi.fn(async (path: string, content: string) => ({
        ok: true,
        path,
        bytes: Buffer.byteLength(content, 'utf-8')
      }))
    }
    const emit = vi.fn<(event: AgentEvent) => void>()
    let supplementsConsumed = false
    const memory = new AgentMemory(
      { shortTerm: [], longTerm: { preferences: [], notes: [], operations: [] } },
      vi.fn()
    )

    const result = await new TerminalAgentCore(
      config,
      memory,
      emit,
      undefined,
      undefined,
      localFileWriter,
      {
        consumeSupplementalInputs: () => {
          if (supplementsConsumed) return []
          supplementsConsumed = true
          return ['把这个架构图文档写入到~/Documents/work目录下']
        }
      }
    ).run('整理aide集群网络架构图')

    expect(localFileWriter.writeFile).toHaveBeenCalledTimes(1)
    expect(localFileWriter.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/^~\/Documents\/work\/cluster-network-architecture-\d{8}-\d{6}\.md$/),
      expect.stringContaining('# aide cluster architecture'),
      { overwrite: false, encoding: 'utf-8' }
    )
    expect(result).toContain('Saved requested architecture document to:')
  })
})
