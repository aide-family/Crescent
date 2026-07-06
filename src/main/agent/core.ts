import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import { AgentBrain } from './brain'
import type { AgentMemory } from './memory'
import { resolveModelProvider } from './openclaw-config'
import { AgentPlanner } from './planner'
import { AgentPromptBuilder } from './prompt-builder'
import { AgentToolRuntime } from './tool-runtime'
import type { AgentConfig, AgentEvent, TerminalCommandExecutor } from './types'

const MAX_TOOL_STEPS = 8

export class TerminalAgentCore {
  private readonly promptBuilder = new AgentPromptBuilder()

  constructor(
    private readonly config: AgentConfig,
    private readonly memory: AgentMemory,
    private readonly emit: (event: AgentEvent) => void,
    private readonly terminalExecutor?: TerminalCommandExecutor
  ) {}

  async run(userInput: string, terminalContext = ''): Promise<string> {
    assertConfig(this.config)

    const brain = new AgentBrain(this.config)
    const memoryBlock = this.memory.getPromptBlock()
    const toolRuntime = await AgentToolRuntime.create({
      config: this.config,
      brain,
      userInput,
      terminalExecutor: this.terminalExecutor,
      emit: this.emit
    })

    if (!toolRuntime.hasTools()) {
      const text = await this.runChatOnly({ brain, userInput, memoryBlock, terminalContext })
      this.memory.rememberTurn(userInput, text)
      return text
    }

    const planner = new AgentPlanner(brain)

    this.emit({
      type: 'status',
      message: `Selected ${toolRuntime.tools.length} active tools: ${toolRuntime.tools.map((tool) => tool.function.name).join(', ')}`
    })

    let planSteps: string[] | undefined
    if (this.config.agentMode === 'plan-execute') {
      this.emit({ type: 'thought', message: 'Planning before execution...' })
      const plan = await planner.createPlan({
        userInput,
        memoryBlock,
        catalog: toolRuntime.catalog
      })
      planSteps = plan.steps
      this.emit({ type: 'plan', steps: plan.steps })
    }

    const finalText = await this.runReactLoop({
      brain,
      toolRuntime,
      userInput,
      memoryBlock,
      terminalContext,
      planSteps
    })

    this.memory.rememberTurn(userInput, finalText)
    return finalText
  }

  private async runChatOnly(input: {
    brain: AgentBrain
    userInput: string
    memoryBlock: string
    terminalContext: string
  }): Promise<string> {
    this.emit({ type: 'status', message: 'Running in chat-only terminal assistant mode.' })

    const completion = await input.brain.chat({
      messages: [
        {
          role: 'system',
          content: this.promptBuilder.buildChatOnlyPrompt({
            mode: this.config.agentMode,
            memoryBlock: input.memoryBlock,
            terminalContext: input.terminalContext
          })
        },
        ...this.memory.getShortTermMessages(),
        { role: 'user', content: input.userInput }
      ]
    })
    const text = completion.choices[0]?.message.content ?? ''

    this.emit({ type: 'token', text })
    this.emit({ type: 'done', message: 'Done.' })
    return text
  }

  private async runReactLoop(input: {
    brain: AgentBrain
    toolRuntime: AgentToolRuntime
    userInput: string
    memoryBlock: string
    terminalContext: string
    planSteps?: string[]
  }): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.promptBuilder.buildToolLoopPrompt({
          mode: this.config.agentMode,
          memoryBlock: input.memoryBlock,
          planSteps: input.planSteps,
          terminalContext: input.terminalContext
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
        tools: input.toolRuntime.tools,
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
          message: 'Dispatching tool call.'
        })

        const result = await input.toolRuntime.execute(
          toolCall.function.name,
          toolCall.function.arguments
        )

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

function assertConfig(config: AgentConfig): void {
  const provider = resolveModelProvider(config)

  if (!provider.apiKey.trim()) throw new Error('OpenAI-compatible API key is required.')
  if (!config.model.trim()) throw new Error('Model is required.')
  if (config.openApiBaseUrl.trim() && !config.openApiDocument.trim()) {
    throw new Error('OpenAPI URL or JSON document is required when REST API base URL is set.')
  }
  if (!config.openApiBaseUrl.trim() && config.openApiDocument.trim()) {
    throw new Error('OpenAPI base URL is required when an OpenAPI document is set.')
  }
}
