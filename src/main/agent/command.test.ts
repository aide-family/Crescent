import { describe, expect, it } from 'vitest'

import { buildCommandSystemPrompt, parseCommandResponse } from './command'

describe('command generation helpers', () => {
  it('parses strict JSON command responses', () => {
    expect(
      parseCommandResponse(
        JSON.stringify({
          command: 'ssh -p 2222 root@example.com',
          explanation: 'Connect to the remote host.',
          risk: 'medium'
        })
      )
    ).toEqual({
      command: 'ssh -p 2222 root@example.com',
      explanation: 'Connect to the remote host.',
      risk: 'medium'
    })
  })

  it('extracts a command from fenced text responses', () => {
    expect(parseCommandResponse('```bash\ndf -h\n```')).toMatchObject({
      command: 'df -h',
      risk: 'low'
    })
  })

  it('normalizes multiline commands into one pasteable shell command', () => {
    expect(
      parseCommandResponse(
        JSON.stringify({
          command: 'cd /var/log\nls -lah',
          explanation: 'Inspect logs.',
          risk: 'low'
        })
      ).command
    ).toBe('cd /var/log && ls -lah')
  })

  it('instructs command generation to preserve requested artifact intent', () => {
    const prompt = buildCommandSystemPrompt('')

    expect(prompt).toContain('preserve the user-requested destination, filename, and context')
    expect(prompt).toContain('Do not replace them with temporary paths')
    expect(prompt).toContain('Do not invent credentials or target identifiers')
  })
})
