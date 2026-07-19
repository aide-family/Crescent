import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import type { AgentBrain } from './brain'
import type { ToolCatalogEntry } from './types'

export interface AgentPlan {
  steps: string[]
}

export class AgentPlanner {
  constructor(private readonly brain: AgentBrain) {}

  async createPlan(input: {
    userInput: string
    memoryBlock: string
    catalog: ToolCatalogEntry[]
  }): Promise<AgentPlan> {
    const catalogText = input.catalog
      .map((entry) => `${entry.name}: ${entry.method.toUpperCase()} ${entry.path} - ${entry.description}`)
      .join('\n')
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content:
          'Create a concise execution plan for an API-capable terminal agent. Return strict JSON only: {"steps":["step"]}. Each step must be actionable and short.'
      },
      {
        role: 'user',
        content: `Memory:\n${input.memoryBlock}\n\nUser request:\n${input.userInput}\n\nAvailable tools:\n${catalogText}\n\nCreate 2-6 steps.`
      }
    ]
    const completion = await this.brain.chat({ temperature: 0, messages })
    const content = completion.choices[0]?.message.content ?? ''

    return { steps: parsePlanSteps(content, input.userInput) }
  }
}

function parsePlanSteps(content: string, userInput: string): string[] {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed?.steps)) {
      const steps = parsed.steps
        .filter((step) => typeof step === 'string' && step.trim())
        .slice(0, 8)
      if (steps.length > 0) return steps
    }
  } catch {
    // Fall through to line parsing.
  }

  const steps = content
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8)

  return steps.length > 0 ? steps : buildFallbackPlan(userInput)
}

function buildFallbackPlan(userInput: string): string[] {
  const task = userInput.trim()

  return [
    task ? `确认当前环境与任务目标：${task}` : '确认当前环境与任务目标',
    '收集必要上下文并定位影响范围',
    '按最新观察执行一个可验证的下一步操作',
    '验证结果并说明已完成、未完成和后续步骤'
  ]
}
