import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import { AgentBrain } from './brain'
import type { AgentMemory } from './memory'
import { resolveModelProvider } from './model-provider-config'
import { AgentPlanner } from './planner'
import { AgentPromptBuilder } from './prompt-builder'
import { AgentToolRuntime } from './tool-runtime'
import { saveWikiDocument } from './wiki'
import type {
  AgentConfig,
  AgentEvent,
  LocalFileWriter,
  SubterminalCommandExecutor,
  TerminalCommandExecutor
} from './types'
import type { AgentRunControls } from './runner'

const MAX_TOOL_STEPS = 30
const MAX_REPEATED_TOOL_CALLS = 3
const LOCAL_FILE_WRITE_TOOL_NAME = 'write_local_file'
const SAVE_WIKI_DOCUMENT_TOOL_NAME = 'save_wiki_document'

export class TerminalAgentCore {
  private readonly promptBuilder = new AgentPromptBuilder()
  private readonly executedToolNames = new Set<string>()
  private readonly receivedSupplementalInputs: string[] = []

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
    this.executedToolNames.clear()
    this.receivedSupplementalInputs.splice(0)
    this.throwIfCanceled()
    this.emit({
      type: 'status',
      message: this.terminalExecutor
        ? 'Understanding the user request and current terminal context.'
        : 'Understanding the user request and available non-terminal context.'
    })

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
      this.emit({
        type: 'thought',
        message: 'Breaking the request into verifiable steps before execution.'
      })
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
    const artifactText = await this.ensureSupplementalLocalArtifactSave(userInput, finalText)
    const completedText = await this.ensureRequestedWikiSave(userInput, artifactText)

    this.memory.rememberTurn(userInput, completedText)
    return completedText
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
              wikiContext: this.controls?.wikiContext,
              conversationContext: this.controls?.conversationContext,
              terminalToolsEnabled: Boolean(this.terminalExecutor),
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
          wikiContext: this.controls?.wikiContext,
          conversationContext: this.controls?.conversationContext,
          planSteps: input.planSteps,
          terminalToolsEnabled: Boolean(this.terminalExecutor),
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
      const supplementalInputs = this.controls?.consumeSupplementalInputs?.()
      if (supplementalInputs?.length) {
        this.receivedSupplementalInputs.push(...supplementalInputs)
      }
      appendSupplementalInputs(messages, supplementalInputs)
      this.emit({
        type: 'thought',
        message: hasToolObservations
          ? 'Reviewing the latest observation and deciding whether to continue, verify, or summarize.'
          : this.config.agentMode === 'plan-execute'
            ? `Executing plan with ReAct step ${step + 1}/${MAX_TOOL_STEPS}.`
            : `Assessing the request and choosing one concrete next action, step ${step + 1}/${MAX_TOOL_STEPS}.`
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
        const text = sanitizeFinalAnswer(message.content ?? '', 'normal')
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
            'Treat this as a stalled loop. Do not call more tools. Summarize what has been tried, why it is stuck, and the next concrete action or missing input needed from the user.',
            'Do not claim the user request is complete unless the requested end state has been verified from tool observations.'
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
          type: 'status',
          message: `Preparing to run tool ${toolCall.function.name} for the current step.`
        })
        this.emit({
          type: 'tool',
          name: toolCall.function.name,
          message: formatToolCallDetail(toolCall.function.name, toolCall.function.arguments)
        })
        this.executedToolNames.add(toolCall.function.name)

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
            content: buildFinalAnswerInstruction(reason)
          }
        ]
      },
      {
        signal: this.controls?.signal
      }
    )
    this.throwIfCanceled()

    const text = sanitizeFinalAnswer(completion.choices[0]?.message.content ?? '', reason)
    this.emit({ type: 'token', text })
    this.emit({ type: 'done', message: 'Done.' })
    return text
  }

  private async ensureRequestedWikiSave(userInput: string, finalText: string): Promise<string> {
    if (!isWikiSaveIntent(userInput)) return finalText
    if (this.executedToolNames.has(SAVE_WIKI_DOCUMENT_TOOL_NAME)) return finalText

    this.emit({
      type: 'tool',
      name: SAVE_WIKI_DOCUMENT_TOOL_NAME,
      message: 'Saving final answer to the local knowledge base.'
    })

    try {
      const document = await saveWikiDocument({
        title: inferWikiTitle(userInput),
        content: buildFallbackWikiContent(userInput, finalText)
      })
      return [
        finalText.trim(),
        '',
        '---',
        `Saved to the local knowledge base: \`${document.path}\``
      ]
        .filter(Boolean)
        .join('\n')
    } catch (error) {
      return [
        finalText.trim(),
        '',
        '---',
        `Knowledge-base save failed: ${error instanceof Error ? error.message : String(error)}`
      ]
        .filter(Boolean)
        .join('\n')
    }
  }

  private async ensureSupplementalLocalArtifactSave(
    userInput: string,
    finalText: string
  ): Promise<string> {
    if (!this.localFileWriter) return finalText
    if (this.executedToolNames.has(LOCAL_FILE_WRITE_TOOL_NAME)) return finalText

    const destination = findLatestSupplementalLocalArtifactDestination(
      this.receivedSupplementalInputs
    )
    if (!destination) return finalText

    const targetPath = buildSupplementalArtifactPath(destination, userInput)
    this.emit({
      type: 'tool',
      name: LOCAL_FILE_WRITE_TOOL_NAME,
      message: `Writing local artifact requested during the run: ${targetPath}`
    })

    const result = await this.localFileWriter.writeFile(targetPath, finalText.trim(), {
      overwrite: false,
      encoding: 'utf-8'
    })

    return [
      finalText.trim(),
      '',
      '---',
      result.ok
        ? `Saved requested architecture document to: \`${result.path}\``
        : `Requested document save failed for \`${result.path}\`: ${result.error ?? 'unknown error'}`
    ]
      .filter(Boolean)
      .join('\n')
  }
}

function isWikiSaveIntent(input: string): boolean {
  return /\b(save|store|write|capture|record)\b.{0,24}\b(knowledge base|wiki|sop|best practice)\b|\b(knowledge base|wiki|sop|best practice)\b.{0,24}\b(save|store|write|capture|record)\b/i.test(
    input
  )
}

function inferWikiTitle(input: string): string {
  const compact = input.replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48)

  return compact ? `${compact} SOP` : 'Operational SOP'
}

function buildFallbackWikiContent(userInput: string, finalText: string): string {
  return [
    `# ${inferWikiTitle(userInput)}`,
    '',
    '## Source Request',
    '',
    userInput.trim(),
    '',
    '## Summary and SOP Draft',
    '',
    finalText.trim()
  ].join('\n')
}

function findLatestSupplementalLocalArtifactDestination(supplements: string[]): string {
  for (const supplement of [...supplements].reverse()) {
    const destination = extractLocalArtifactDestination(supplement)
    if (destination) return destination
  }

  return ''
}

function extractLocalArtifactDestination(input: string): string {
  const patterns = [
    /(?:写入|保存|输出|导出|存到|保存到|写到)\s*(?:到|至|在|入)?\s*([~/$A-Za-z0-9_.-][^\s，,；;。]*)/i,
    /\b(?:save|write|output|export|store)\s+(?:to|into|at)\s+([~./$A-Za-z0-9_-][^\s,;]*)/i
  ]

  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match?.[1]) return normalizeSupplementalDestination(match[1])
  }

  const loosePathMatch = input.match(/((?:~|\/|\$HOME)[^\s，,；;。]*)/)
  return loosePathMatch?.[1] ? normalizeSupplementalDestination(loosePathMatch[1]) : ''
}

function normalizeSupplementalDestination(value: string): string {
  return value
    .trim()
    .replace(/[。.,，;；]+$/, '')
    .replace(/(?:目录|路径)?下$/, '')
}

function buildSupplementalArtifactPath(destination: string, userInput: string): string {
  if (looksLikeFilePath(destination)) return destination

  const directory = destination.replace(/\/+$/, '')
  return `${directory}/${inferLocalArtifactFilename(userInput)}`
}

function looksLikeFilePath(path: string): boolean {
  return /\.[A-Za-z0-9]{1,8}$/.test(path.replace(/\/+$/, ''))
}

function inferLocalArtifactFilename(userInput: string): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-')
  const normalized = userInput.toLowerCase()
  const prefix =
    /k8s|kubernetes|集群|架构|architecture|network/.test(normalized)
      ? 'cluster-network-architecture'
      : 'crescent-agent-result'

  return `${prefix}-${timestamp}.md`
}

function formatToolCallDetail(toolName: string, rawArguments: string): string {
  const args = parseToolCallArguments(rawArguments)
  const lines = [`Tool: ${toolName}`]

  if (toolName === 'execute_terminal_command') {
    lines.push(`Command: ${formatToolArgument(args.command)}`)
  } else if (toolName === 'execute_subterminal_command') {
    lines.push(`Terminal: ${formatToolArgument(args.terminalName)}`)
    lines.push(`Command: ${formatToolArgument(args.command)}`)
  } else if (toolName === 'write_local_file') {
    lines.push(`Path: ${formatToolArgument(args.path)}`)
  } else if (toolName === SAVE_WIKI_DOCUMENT_TOOL_NAME) {
    lines.push(`Title: ${formatToolArgument(args.title)}`)
  } else if (
    toolName.startsWith('parse_') ||
    toolName.startsWith('analyze_') ||
    toolName.startsWith('transcribe_')
  ) {
    lines.push(`Path: ${formatToolArgument(args.path)}`)
  } else {
    lines.push(`Arguments: ${formatToolArgumentsForDisplay(args, rawArguments)}`)
  }

  return lines.join('\n')
}

function parseToolCallArguments(rawArguments: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function formatToolArgument(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '(not provided)'
}

function formatToolArgumentsForDisplay(
  args: Record<string, unknown>,
  rawArguments: string
): string {
  const text = Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : rawArguments.trim()
  if (!text) return '(none)'

  return text.length > 1200 ? `${text.slice(0, 1200)}\n...` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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
      content: [
        'You have tool observations. Continue the loop when another concrete action can advance the user goal. Produce a final answer only when the task is solved, a required input/permission is missing, the environment blocks progress, or the next action would repeat the same failed approach.',
        'For install, deploy, configure, repair, or migration requests, the task is not solved until the requested resources/configuration exist and a relevant health or functionality check passes. If only prerequisites or discovery are complete, keep acting or state that the task is incomplete.',
        'Do not spend the majority of the run on prerequisite discovery. Once the target, deployment mechanism, and one blocking dependency are known, either execute the next installation/configuration step or clearly stop on that blocker.',
        'If a command is blocked by password, sudo, OTP, or another interactive prompt, do not continue unrelated probing. Ask for that input or retry the same blocked step after the user provides it.',
        'If more terminal work is necessary, choose exactly one narrow next command based on the latest observation and avoid repeated probing.'
      ].join('\n')
    }
  ]
}

function buildFinalAnswerInstruction(reason: 'stalled' | 'safety-limit'): string {
  const statusLine =
    reason === 'stalled'
      ? 'The loop is stalled because the same action is repeating without new progress.'
      : 'The tool loop safety limit is reached.'

  return [
    statusLine,
    'Do not call any more tools, and do not write tool-call markup or pseudo tool calls in the answer.',
    'Produce the best final answer in the same natural language as the user’s latest request.',
    'For install, deploy, configure, repair, or migration requests, do not claim completion unless the requested end state was verified in the observations.',
    'Use this structure when the task is incomplete: Incomplete / Completed / Incomplete or Unknown / Next Step.',
    'The next step may include one concrete command or action, but present it as a recommendation for the next run, not as if it was executed.'
  ].join('\n')
}

export function sanitizeFinalAnswer(
  text: string,
  reason: 'normal' | 'stalled' | 'safety-limit'
): string {
  const withoutToolMarkup = text
    .replace(/<\|{0,2}[^>\n]*(?:tool_calls|invoke|parameter)[\s\S]*?(?:<\/\|{0,2}[^>\n]+>|$)/gi, '')
    .replace(/```(?:json|text)?\s*[\s\S]*?"tool_calls"\s*:\s*[\s\S]*?```/gi, '')
    .replace(/<details>\s*<summary>tool_calls<\/summary>[\s\S]*?<\/details>/gi, '')
    .trim()

  const fallback = withoutToolMarkup || text.replace(/<[^>]+>/g, '').trim()
  if (reason === 'safety-limit' && looksLikeBareShellCommand(fallback)) {
    return [
      'Incomplete: the tool loop reached the safety limit, so later actions were not executed.',
      '',
      'Completed: prerequisite checks and some dependency verification were performed.',
      '',
      'Incomplete or Unknown: the requested installation, configuration, and verification are not complete.',
      '',
      `Next Step: continue by executing and verifying this step instead of treating it as a completed result: \`${fallback}\``
    ].join('\n')
  }

  if (reason === 'normal') return fallback

  const needsIncompletePrefix =
    reason === 'safety-limit' && !/incomplete|not complete|unfinished|not finished/i.test(fallback)

  if (!needsIncompletePrefix) return fallback

  return [
    'Incomplete: the tool loop reached the safety limit, so later actions were not executed.',
    '',
    fallback
  ]
    .filter(Boolean)
    .join('\n')
}

function looksLikeBareShellCommand(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('\n')) return false

  return /^(?:sudo\s+)?(?:kubectl|helm|docker|ctr|crictl|curl|wget|cat|ls|id|groups|journalctl|systemctl|df|free|ip|sysctl)\b/.test(
    trimmed
  )
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
      'Additional instructions supplied by the user while this run was still active.',
      'Treat these supplements as high-priority updates to the current goal. If they add or change an artifact destination, update the remaining steps and final completion criteria accordingly.',
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
