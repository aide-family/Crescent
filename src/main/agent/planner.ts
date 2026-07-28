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
    skillContext?: string
    wikiContext?: string
    terminalContext?: string
    catalog: ToolCatalogEntry[]
  }): Promise<AgentPlan> {
    const catalogText = input.catalog
      .map(
        (entry) =>
          `${entry.name}: ${entry.method.toUpperCase()} ${entry.path} - ${entry.description}`
      )
      .join('\n')
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: [
          'Create an execution plan for an API-capable operations agent. Return strict JSON only: {"steps":["step"]}.',
          'First infer the business scenario from the user request, loaded skills, SOP context, memory, terminal context, and available tools. Identify the goal, affected target, current context, constraints, required evidence, allowed actions, verification standard, and blocker/escalation path.',
          'Each step must describe the immediate action plus why it matters, what evidence or result will decide the next action, and when to stop or ask the user. Prefer detailed but concise steps over generic checklist items.',
          'Do not invent artifact destinations, filenames, namespaces, hosts, credentials, cleanup targets, or business assumptions. If the user did not request writing a report or file, do not include report-writing or file-output steps.',
          'Plan only actions that match the available tool capabilities. When work targets a non-current host, plan an ssh command with a concrete remote command; if authentication is required, the user can provide password/passphrase/OTP through the terminal prompt. If terminal context indicates pipe fallback rather than PTY, plan to ask for PTY-capable terminal access before interactive remote execution.',
          'When loaded skill or SOP context is supplied, use it as scenario knowledge: preserve its scope, safety rules, fallback conditions, and verification requirements without hardcoding unrelated domain-specific shortcuts.'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          `Memory:\n${input.memoryBlock}`,
          input.skillContext ? `Loaded skill context:\n${input.skillContext}` : '',
          input.wikiContext ? `Knowledge-base SOP context:\n${input.wikiContext}` : '',
          input.terminalContext ? `Recent terminal context:\n${input.terminalContext}` : '',
          `User request:\n${input.userInput}`,
          `Available tools:\n${catalogText}`,
          'Create 3-7 detailed steps. Format each step as one sentence with: action, decision evidence, and next action or stop condition.'
        ]
          .filter(Boolean)
          .join('\n\n')
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
      return buildFallbackPlan(userInput)
    }
    if (parsed && typeof parsed === 'object') return buildFallbackPlan(userInput)
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
    task
      ? `Understand the requested scenario and target: ${task}; extract the goal, affected object, constraints, and completion criteria before acting.`
      : 'Understand the requested scenario; extract the goal, affected object, constraints, and completion criteria before acting.',
    'Compare the required action with the current terminal/tool context; if the target is a different host, use ssh with a concrete remote command, and ask for PTY-capable access only when the terminal cannot handle interactive prompts.',
    'Collect the minimum direct evidence needed for the next decision, using the loaded Skill/SOP scope when present.',
    'Choose the next handling action from the evidence, state any required approval before changes, and avoid unrelated exploration.',
    'Verify the end state against the original request and report what is complete, incomplete, blocked, and next.'
  ]
}
