import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import { AgentBrain } from './brain'
import type { AgentMemory } from './memory'
import { resolveModelProvider } from './openclaw-config'
import { AgentPlanner } from './planner'
import { AgentPromptBuilder } from './prompt-builder'
import { AgentToolRuntime } from './tool-runtime'
import type { AgentConfig, AgentEvent, TerminalCommandExecutor } from './types'
import type { AgentRunControls } from './runner'

const MAX_TOOL_STEPS = 5
const MAX_TOOL_ROUNDS_BEFORE_SYNTHESIS = 3

export class TerminalAgentCore {
  private readonly promptBuilder = new AgentPromptBuilder()

  constructor(
    private readonly config: AgentConfig,
    private readonly memory: AgentMemory,
    private readonly emit: (event: AgentEvent) => void,
    private readonly terminalExecutor?: TerminalCommandExecutor,
    private readonly controls?: AgentRunControls
  ) {}

  async run(userInput: string, terminalContext = ''): Promise<string> {
    assertConfig(this.config)
    this.throwIfCanceled()

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
      const text = await this.runChatOnly({
        brain,
        userInput,
        memoryBlock,
        terminalContext
      })
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
    this.throwIfCanceled()

    const completion = await input.brain.chat(
      {
        messages: [
          {
            role: 'system',
            content: this.promptBuilder.buildChatOnlyPrompt({
              mode: this.config.agentMode,
              memoryBlock: input.memoryBlock,
              instructionContext: this.controls?.instructionContext,
              skillContext: this.controls?.skillContext,
              terminalContext: input.terminalContext
            })
          },
          ...this.memory.getShortTermMessages(),
          { role: 'user', content: input.userInput }
        ]
      },
      {
        signal: this.controls?.signal
      }
    )
    this.throwIfCanceled()
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
          instructionContext: this.controls?.instructionContext,
          skillContext: this.controls?.skillContext,
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

    let toolRounds = 0

    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      this.throwIfCanceled()
      appendSupplementalInputs(messages, this.controls?.consumeSupplementalInputs?.())
      const hasToolObservations = toolRounds > 0
      const shouldForceFinal = toolRounds >= MAX_TOOL_ROUNDS_BEFORE_SYNTHESIS
      this.emit({
        type: 'thought',
        message: shouldForceFinal
          ? 'Analyzing tool results and preparing the final answer...'
          : hasToolObservations
            ? 'Analyzing tool results and preparing the final answer...'
            : this.config.agentMode === 'plan-execute'
              ? `Executing plan with ReAct step ${step + 1}/${MAX_TOOL_STEPS}.`
              : `Reasoning and acting step ${step + 1}/${MAX_TOOL_STEPS}.`
      })

      const stepMessages = buildStepMessages(messages, {
        hasToolObservations,
        shouldForceFinal
      })
      const completion = await input.brain.chat(
        shouldForceFinal
          ? {
              messages: stepMessages
            }
          : {
              messages: stepMessages,
              tools: input.toolRuntime.tools,
              tool_choice: 'auto'
            },
        {
          signal: this.controls?.signal
        }
      )
      this.throwIfCanceled()
      const message = completion.choices[0]?.message

      if (!message) throw new Error('Model returned an empty response.')

      messages.push(message)

      if (!message.tool_calls || message.tool_calls.length === 0) {
        const text = message.content ?? ''
        this.emit({ type: 'token', text })
        this.emit({ type: 'done', message: 'Done.' })
        return text
      }

      toolRounds += 1

      for (const toolCall of message.tool_calls) {
        this.throwIfCanceled()
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

    return this.synthesizeFinalAnswer(input.brain, messages)
  }

  private throwIfCanceled(): void {
    if (this.controls?.signal?.aborted) throw new Error('Agent run canceled.')
  }

  private async synthesizeFinalAnswer(
    brain: AgentBrain,
    messages: ChatCompletionMessageParam[]
  ): Promise<string> {
    this.emit({
      type: 'thought',
      message: 'Analyzing tool results and preparing the final answer...'
    })
    this.throwIfCanceled()

    const completion = await brain.chat(
      {
        messages: [
          ...messages,
          {
            role: 'system',
            content:
              'The tool loop budget is exhausted. Do not call any more tools. Produce the best final answer from the available observations in the same natural language as the user’s latest request. If the task is incomplete, clearly state what was completed, what is still unknown, and the next concrete command or action.'
          }
        ]
      },
      {
        signal: this.controls?.signal
      }
    )
    this.throwIfCanceled()

    const text = completion.choices[0]?.message.content ?? ''
    this.emit({ type: 'token', text })
    this.emit({ type: 'done', message: 'Done.' })
    return text
  }
}

function buildStepMessages(
  messages: ChatCompletionMessageParam[],
  input: { hasToolObservations: boolean; shouldForceFinal: boolean }
): ChatCompletionMessageParam[] {
  if (input.shouldForceFinal) {
    return [
      ...messages,
      {
        role: 'system',
        content:
          'You already have enough tool interaction rounds for this request. Stop using tools now and write the final answer in the same natural language as the user’s latest request. Summarize the result, evidence, failures if any, and the next concrete action only if needed.'
      }
    ]
  }

  if (!input.hasToolObservations) return messages

  return [
    ...messages,
    {
      role: 'system',
      content:
        'You have tool observations. Prefer producing the final answer now. Call one more tool only when a specific missing fact prevents a correct conclusion. If more terminal work is necessary, batch related read-only checks into one command and avoid repeated probing.'
    }
  ]
}

function appendSupplementalInputs(
  messages: ChatCompletionMessageParam[],
  supplementalInputs: string[] | undefined
): void {
  if (!supplementalInputs?.length) return

  messages.push({
    role: 'user',
    content: [
      'Additional context supplied by the user while this run was still active.',
      ...supplementalInputs.map((input, index) => `Supplement ${index + 1}:\n${input}`)
    ].join('\n\n')
  })
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
