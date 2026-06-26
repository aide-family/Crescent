import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import { AgentBrain } from './brain'
import type { AgentMemory } from './memory'
import { resolveModelProvider } from './openclaw-config'
import { AgentPlanner } from './planner'
import { loadOpenApiToolRegistry } from './tool-registry'
import { OpenApiToolExecutor } from './tool-executor'
import type { AgentConfig, AgentEvent, OpenAiTool } from './types'

const MAX_TOOL_STEPS = 8

export class TerminalAgentCore {
  constructor(
    private readonly config: AgentConfig,
    private readonly memory: AgentMemory,
    private readonly emit: (event: AgentEvent) => void
  ) {}

  async run(userInput: string): Promise<string> {
    assertConfig(this.config)

    const brain = new AgentBrain(this.config)
    const registry = await loadOpenApiToolRegistry(this.config)
    const planner = new AgentPlanner(brain)

    this.emit({ type: 'status', message: `Loaded ${registry.tools.length} OpenAPI tools.` })

    const selectedToolNames = await brain.selectRelevantTools({
      userInput,
      catalog: registry.catalog,
      maxTools: Math.max(1, this.config.maxActiveTools)
    })
    const activeTools = selectTools(registry.tools, selectedToolNames)
    const executor = new OpenApiToolExecutor(this.config, registry.operations)
    const memoryBlock = this.memory.getPromptBlock()

    this.emit({
      type: 'status',
      message: `Selected ${activeTools.length} active tools: ${activeTools.map((tool) => tool.function.name).join(', ')}`
    })

    let planSteps: string[] | undefined
    if (this.config.agentMode === 'plan-execute') {
      this.emit({ type: 'thought', message: 'Planning before execution...' })
      const plan = await planner.createPlan({
        userInput,
        memoryBlock,
        catalog: registry.catalog.filter((entry) => selectedToolNames.includes(entry.name))
      })
      planSteps = plan.steps
      this.emit({ type: 'plan', steps: plan.steps })
    }

    const finalText = await this.runReactLoop({
      brain,
      executor,
      activeTools,
      userInput,
      memoryBlock,
      planSteps
    })

    this.memory.rememberTurn(userInput, finalText)
    return finalText
  }

  private async runReactLoop(input: {
    brain: AgentBrain
    executor: OpenApiToolExecutor
    activeTools: OpenAiTool[]
    userInput: string
    memoryBlock: string
    planSteps?: string[]
  }): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: buildSystemPrompt({
          mode: this.config.agentMode,
          memoryBlock: input.memoryBlock,
          planSteps: input.planSteps
        })
      },
      ...this.memory.getShortTermMessages(),
      {
        role: 'user',
        content: input.userInput
      }
    ]

    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      this.emit({
        type: 'thought',
        message:
          this.config.agentMode === 'plan-execute'
            ? `Executing plan with ReAct step ${step + 1}/${MAX_TOOL_STEPS}.`
            : `Reasoning and acting step ${step + 1}/${MAX_TOOL_STEPS}.`
      })

      const completion = await input.brain.chat({
        messages,
        tools: input.activeTools,
        tool_choice: 'auto'
      })
      const message = completion.choices[0]?.message

      if (!message) throw new Error('Model returned an empty response.')

      messages.push(message)

      if (!message.tool_calls || message.tool_calls.length === 0) {
        const text = message.content ?? ''
        this.emit({ type: 'token', text })
        this.emit({ type: 'done', message: 'Done.' })
        return text
      }

      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== 'function') continue

        this.emit({
          type: 'tool',
          name: toolCall.function.name,
          message: 'Executing OpenAPI operation.'
        })

        const result = await input.executor.execute(toolCall.function.name, toolCall.function.arguments)

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        })
      }
    }

    throw new Error('Tool calling loop exceeded the maximum step limit.')
  }
}

function buildSystemPrompt(input: {
  mode: string
  memoryBlock: string
  planSteps?: string[]
}): string {
  return [
    'You are TerminalAgent, an API-capable terminal agent.',
    'Architecture: Brain for reasoning, Memory for context, Planning for task decomposition, Tools for external actions.',
    input.mode === 'plan-execute'
      ? 'Mode: Plan-and-Execute. Follow the plan, execute with tools, and adapt if an observation invalidates a step.'
      : 'Mode: ReAct. Alternate reasoning and tool use until you can give a final answer.',
    'Use OpenAPI tools only when useful. Explain API failures clearly. Keep final output concise and terminal-friendly.',
    `Long-term memory:\n${input.memoryBlock}`,
    input.planSteps?.length ? `Execution plan:\n${input.planSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

function selectTools(tools: OpenAiTool[], selectedToolNames: string[]): OpenAiTool[] {
  const selected = new Set(selectedToolNames)
  const activeTools = tools.filter((tool) => selected.has(tool.function.name))

  return activeTools.length > 0 ? activeTools : tools.slice(0, 5)
}

function assertConfig(config: AgentConfig): void {
  const provider = resolveModelProvider(config)

  if (!provider.apiKey.trim()) throw new Error('OpenAI-compatible API key is required.')
  if (!config.model.trim()) throw new Error('Model is required.')
  if (!config.openApiBaseUrl.trim()) throw new Error('OpenAPI base URL is required.')
  if (!config.openApiDocument.trim()) throw new Error('OpenAPI URL or JSON document is required.')
}
