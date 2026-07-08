import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import type { AgentBrain } from './brain'
import type { AgentMemory } from './memory'

export interface CommandGenerationInput {
  instruction: string
  cwd?: string
  shell?: string
  instructionContext?: string
  terminalContext?: string
}

export interface GeneratedCommand {
  command: string
  explanation: string
  risk: 'low' | 'medium' | 'high'
}

export async function generateTerminalCommand(
  brain: AgentBrain,
  memory: AgentMemory,
  input: CommandGenerationInput
): Promise<GeneratedCommand> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: buildCommandSystemPrompt(memory.getPromptBlock(), input.instructionContext)
    },
    ...memory.getShortTermMessages(),
    {
      role: 'user',
      content: [
        `Task: ${input.instruction}`,
        input.cwd ? `Current working directory: ${input.cwd}` : '',
        input.shell ? `Shell: ${input.shell}` : '',
        input.terminalContext
          ? `Recent terminal context:
${input.terminalContext}`
          : ''
      ]
        .filter(Boolean)
        .join('\n')
    }
  ]

  const completion = await brain.chat({
    temperature: 0,
    messages
  })
  const content = completion.choices[0]?.message.content ?? ''
  const command = parseCommandResponse(content)

  memory.rememberTurn(
    `/command ${input.instruction}`,
    `${command.command}\n\n${command.explanation}`
  )

  return command
}

export function buildCommandSystemPrompt(memoryBlock: string, instructionContext = ''): string {
  return [
    'You are Crescent Command Builder, a careful terminal and SSH operations assistant.',
    'Return strict JSON only with this shape: {"command":"single shell command","explanation":"short explanation","risk":"low|medium|high"}.',
    'Generate exactly one command suitable to paste into an interactive terminal.',
    'Prefer safe, inspect-first commands. Avoid destructive actions unless the user explicitly requests them.',
    'For remote server work, prefer standard ssh syntax such as ssh -p 22 user@host.',
    'Do not wrap the command in markdown. Do not include multiple alternatives.',
    `Long-term memory:\n${memoryBlock}`,
    instructionContext ? `Local instruction files:\n${instructionContext}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function parseCommandResponse(content: string): GeneratedCommand {
  try {
    const parsed = JSON.parse(content)
    const command = normalizeCommand(parsed?.command)

    if (command) {
      return {
        command,
        explanation:
          typeof parsed.explanation === 'string' && parsed.explanation.trim()
            ? parsed.explanation.trim()
            : 'Generated terminal command.',
        risk: normalizeRisk(parsed.risk)
      }
    }
  } catch {
    // Fall through to plain text extraction.
  }

  const command = normalizeCommand(extractCommandFromText(content))

  if (!command) {
    throw new Error('Model did not return a usable terminal command.')
  }

  return {
    command,
    explanation: 'Generated terminal command.',
    risk: inferRisk(command)
  }
}

function extractCommandFromText(content: string): string {
  const fenced = content.match(/```(?:bash|sh|shell)?\s*([\s\S]*?)```/i)?.[1]
  const source = fenced ?? content

  return (
    source
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#')) ?? ''
  )
}

function normalizeCommand(value: unknown): string {
  if (typeof value !== 'string') return ''

  return value.replace(/[\r\n]+/g, ' && ').trim()
}

function normalizeRisk(value: unknown): GeneratedCommand['risk'] {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function inferRisk(command: string): GeneratedCommand['risk'] {
  if (/\b(rm\s+-rf|mkfs|dd\s+if=|shutdown|reboot|halt|poweroff)\b/.test(command)) return 'high'
  if (/\b(sudo|ssh|scp|rsync|kubectl|docker|systemctl)\b/.test(command)) return 'medium'
  return 'low'
}
