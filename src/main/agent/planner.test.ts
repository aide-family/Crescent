import { describe, expect, it, vi } from 'vitest'

import type { AgentBrain } from './brain'
import { AgentPlanner } from './planner'

describe('AgentPlanner', () => {
  it('includes operational guardrails and loaded context in the planning prompt', async () => {
    let capturedInput: unknown
    const chat = vi.fn(async (input: unknown) => {
      capturedInput = input
      return {
        choices: [{ message: { content: JSON.stringify({ steps: ['Confirm target host'] }) } }]
      }
    })
    const planner = new AgentPlanner({ chat } as unknown as AgentBrain)

    const plan = await planner.createPlan({
      userInput: '处理 10.42.131.142 /home 磁盘告警',
      memoryBlock: 'memory',
      skillContext: 'linux-disk-alert-remediation mandatory rules',
      wikiContext: 'Home 盘磁盘空间不足清理 SOP',
      terminalContext: 'current terminal is op-mon1, not target host',
      catalog: [
        {
          name: 'execute_terminal_command',
          method: 'post',
          path: 'terminal://execute',
          description: 'Execute one non-interactive command.'
        }
      ]
    })

    expect(chat).toHaveBeenCalled()
    const firstCall = capturedInput as {
      messages?: Array<{ role: string; content: string }>
    }
    const messages = firstCall.messages ?? []
    const systemPrompt = messages.find((message) => message.role === 'system')?.content
    const userPrompt = messages.find((message) => message.role === 'user')?.content

    expect(plan.steps).toEqual(['Confirm target host'])
    expect(systemPrompt).toContain('First infer the business scenario')
    expect(systemPrompt).toContain('goal, affected target, current context')
    expect(systemPrompt).toContain('Do not invent artifact destinations')
    expect(systemPrompt).toContain('Explicit local file targets take precedence')
    expect(systemPrompt).toContain('IP addresses inside pasted file contents as data')
    expect(systemPrompt).toContain('available tool capabilities')
    expect(systemPrompt).toContain('plan an ssh command with a concrete remote command')
    expect(systemPrompt).toContain('password/passphrase/OTP')
    expect(systemPrompt).toContain('use it as scenario knowledge')
    expect(userPrompt).toContain('linux-disk-alert-remediation mandatory rules')
    expect(userPrompt).toContain('Home 盘磁盘空间不足清理 SOP')
    expect(userPrompt).toContain('current terminal is op-mon1')
  })

  it('falls back to scenario-aware operational steps when the model returns no plan', async () => {
    const chat = vi.fn(async () => ({
      choices: [{ message: { content: JSON.stringify({ steps: [] }) } }]
    }))
    const planner = new AgentPlanner({ chat } as unknown as AgentBrain)

    const plan = await planner.createPlan({
      userInput: '处理生产告警',
      memoryBlock: '',
      catalog: []
    })

    expect(plan.steps).toEqual([
      expect.stringContaining('Understand the requested scenario and target'),
      expect.stringContaining('use ssh with a concrete remote command'),
      expect.stringContaining('keep the action local'),
      expect.stringContaining('minimum direct evidence'),
      expect.stringContaining('required approval'),
      expect.stringContaining('original request')
    ])
  })
})
