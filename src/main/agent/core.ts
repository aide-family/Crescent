import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import { AgentBrain } from './brain'
import type { AgentMemory } from './memory'
import { resolveModelProvider } from './openclaw-config'
import { AgentPlanner } from './planner'
import { AgentPromptBuilder } from './prompt-builder'
import { AgentToolRuntime } from './tool-runtime'
import type {
  AgentConfig,
  AgentEvent,
  LocalFileWriter,
  SubterminalCommandExecutor,
  TerminalCommandExecutor
} from './types'
import type { AgentRunControls } from './runner'

const MAX_TOOL_STEPS = 12
const MAX_REPEATED_TOOL_CALLS = 3

export class TerminalAgentCore {
  private readonly promptBuilder = new AgentPromptBuilder()

  constructor(
    private readonly config: AgentConfig,
    private readonly memory: AgentMemory,
    private readonly emit: (event: AgentEvent) => void,
    private readonly terminalExecutor?: TerminalCommandExecutor,
    private readonly subterminalExecutor?: SubterminalCommandExecutor,
    private readonly localFileWriter?: LocalFileWriter,
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
      subterminalExecutor: this.subterminalExecutor,
      localFileWriter: this.localFileWriter,
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

    const toolCallCounts = new Map<string, number>()
    let hasToolObservations = false

    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      this.throwIfCanceled()
      appendSupplementalInputs(messages, this.controls?.consumeSupplementalInputs?.())
      this.emit({
        type: 'thought',
        message: hasToolObservations
          ? 'Analyzing tool results and preparing the next action...'
          : this.config.agentMode === 'plan-execute'
            ? `Executing plan with ReAct step ${step + 1}/${MAX_TOOL_STEPS}.`
            : `Reasoning and acting step ${step + 1}/${MAX_TOOL_STEPS}.`
      })

      const stepMessages = buildStepMessages(messages, {
        hasToolObservations
      })
      const completion = await input.brain.chat(
        {
          messages: stepMessages,
          tools: input.toolRuntime.tools,
          tool_choice: 'auto',
          parallel_tool_calls: false
        },
        {
          signal: this.controls?.signal
        }
      )
      this.throwIfCanceled()
      const message = completion.choices[0]?.message

      if (!message) throw new Error('Model returned an empty response.')

      if (!message.tool_calls || message.tool_calls.length === 0) {
        messages.push(message)
        const text = message.content ?? ''
        this.emit({ type: 'token', text })
        this.emit({ type: 'done', message: 'Done.' })
        return text
      }

      const toolCalls = message.tool_calls.slice(0, 1)
      const repeatedToolCall = toolCalls.find((toolCall) => {
        if (toolCall.type !== 'function') return false

        const signature = createToolCallSignature(
          toolCall.function.name,
          toolCall.function.arguments
        )
        const count = (toolCallCounts.get(signature) ?? 0) + 1
        toolCallCounts.set(signature, count)

        return count >= MAX_REPEATED_TOOL_CALLS
      })

      if (repeatedToolCall?.type === 'function') {
        messages.push({
          role: 'system',
          content: [
            'The agent is about to repeat the same tool call for the third time.',
            `Repeated tool: ${repeatedToolCall.function.name}`,
            'Treat this as a stalled loop. Do not call more tools. Summarize what has been tried, why it is stuck, and the next concrete action or missing input needed from the user.'
          ].join('\n')
        })
        return this.synthesizeFinalAnswer(input.brain, messages, 'stalled')
      }

      hasToolObservations = true

      messages.push({ ...message, tool_calls: toolCalls })
      if (message.tool_calls.length > 1) {
        messages.push({
          role: 'system',
          content:
            'Only one tool call is allowed per step. Crescent will execute the first tool call now; after observing its result, decide the next step before calling another tool.'
        })
      }

      for (const toolCall of toolCalls) {
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

    return this.synthesizeFinalAnswer(input.brain, messages, 'safety-limit')
  }

  private throwIfCanceled(): void {
    if (this.controls?.signal?.aborted) throw new Error('Agent run canceled.')
  }

  private async synthesizeFinalAnswer(
    brain: AgentBrain,
    messages: ChatCompletionMessageParam[],
    reason: 'stalled' | 'safety-limit' = 'safety-limit'
  ): Promise<string> {
    this.emit({
      type: 'thought',
      message:
        reason === 'stalled'
          ? 'Loop appears stalled; preparing the final answer...'
          : 'Tool loop safety limit reached; preparing the final answer...'
    })
    this.throwIfCanceled()

    const completion = await brain.chat(
      {
        messages: [
          ...messages,
          {
            role: 'system',
            content:
              reason === 'stalled'
                ? 'The loop is stalled because the same action is repeating without new progress. Do not call any more tools. Produce the best final answer in the same natural language as the user’s latest request. Clearly state what was completed, what repeated, why it is blocked, and the next concrete action or missing input.'
                : 'The tool loop safety limit is reached. Do not call any more tools. Produce the best final answer from the available observations in the same natural language as the user’s latest request. If the task is incomplete, clearly state what was completed, what is still unknown, and the next concrete command or action.'
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
  input: { hasToolObservations: boolean }
): ChatCompletionMessageParam[] {
  if (!input.hasToolObservations) return messages

  return [
    ...messages,
    {
      role: 'system',
      content:
        'You have tool observations. Continue the loop when another concrete action can advance the user goal. Produce a final answer only when the task is solved, a required input/permission is missing, the environment blocks progress, or the next action would repeat the same failed approach. If more terminal work is necessary, choose exactly one narrow next command based on the latest observation and avoid repeated probing.'
    }
  ]
}

function createToolCallSignature(name: string, rawArguments: string): string {
  return `${name}:${normalizeToolCallArguments(rawArguments)}`
}

function normalizeToolCallArguments(rawArguments: string): string {
  try {
    return JSON.stringify(sortJsonValue(JSON.parse(rawArguments)))
  } catch {
    return rawArguments.replace(/\s+/g, ' ').trim()
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)])
  )
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
