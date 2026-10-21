/* eslint-disable no-control-regex -- Parse terminal control sequences explicitly. */
import { findNewestPromptSignal, type PromptSignal } from '../../shared/terminal-prompt-host'
import { classifyPipeCommand } from '../../shared/connection-state'
import { hasLikelyShellPrompt } from './command-interrupt'
import type { TerminalActivity } from '../../shared/agent-types'
import { collectSimpleCommands } from '../../shared/shell-command'
import {
  commandBasename,
  stripWrappers,
  unwrapShellScript
} from '../../shared/command-policy/shell-wrappers'

/** Interactive applications belong to the operator, never a sentinel shell wrapper. */
export function requiresTerminalTakeover(command: string, depth = 0): boolean {
  if (depth > 4) return true
  const commands = collectSimpleCommands(command)
  if (!commands) return false
  return commands.some(({ argv }) => {
    let peeled = stripWrappers(argv)
    if (commandBasename(peeled[0] ?? '') === 'exec') peeled = stripWrappers(peeled.slice(1))
    if (commandBasename(peeled[0] ?? '') === 'sudo') {
      let i = 1
      while (peeled[i]?.startsWith('-')) {
        const flag = peeled[i++]
        if (flag === '-i' || flag === '-s' || flag === '--login' || flag === '--shell') return true
        if (['-u', '-g', '-h', '-p', '-C', '-T', '-R', '-D'].includes(flag)) i++
      }
      peeled = stripWrappers(peeled.slice(i))
      if (!peeled.length) return true
    }
    const name = commandBasename(peeled[0] ?? '')
    if (['vi', 'vim', 'nvim', 'nano', 'less', 'more', 'top', 'htop', 'watch', 'man'].includes(name))
      return true
    const script = unwrapShellScript(peeled)
    if (script !== null) return requiresTerminalTakeover(script, depth + 1)
    return classifyPipeCommand([name, ...peeled.slice(1)].join(' ')) === 'interactive'
  })
}

/** Per PTY generation. Only raw transport bytes enter this parser, never UI/history text. */
export class TerminalExecutionState {
  phase: TerminalActivity = 'shell-ready'
  alternateScreen = false
  promptText = ''
  private line = ''
  private escape = ''
  private cursorContent = false

  begin(phase: TerminalActivity): void {
    this.phase = phase
    this.promptText = ''
    this.line = ''
    this.cursorContent = false
  }

  consume(data: string): { prompt?: PromptSignal; shellReady: boolean; disconnected: boolean } {
    let plain = ''
    for (const char of data) {
      if (this.escape) {
        this.escape += char
        if (this.escape === '\x1b[' || this.escape === '\x1b]') continue
        if (this.escape.startsWith('\x1b]')) {
          if (char === '\x07' || this.escape.endsWith('\x1b\\') || this.escape.length > 4096)
            this.escape = ''
          continue
        }
        if (this.escape.startsWith('\x1b[') && !/[@-~]/.test(char)) continue
        const sequence = this.escape
        this.escape = ''
        if (/^\x1b\[\?(?:1049|1047|47)h$/.test(sequence)) {
          this.alternateScreen = true
          this.begin('interactive-application')
        } else if (/^\x1b\[\?(?:1049|1047|47)l$/.test(sequence)) {
          this.alternateScreen = false
          this.begin('completion-unknown')
        } else if (/^\x1b\[[\d;]*[HfABCD]$/.test(sequence)) {
          this.cursorContent = true
          this.promptText = ''
        }
        continue
      }
      if (char === '\x1b') {
        this.escape = char
        continue
      }
      if (this.alternateScreen) continue
      plain += char
      if (char === '\n') {
        this.line = ''
        this.cursorContent = false
      } else if (char !== '\r' && char >= ' ') this.line = (this.line + char).slice(-4096)
    }
    const line = this.line.trimEnd()
    // Never scan back through command output looking for an old prompt.
    const prompt =
      !this.alternateScreen && !this.cursorContent ? findNewestPromptSignal(line, 1) : undefined
    const shellReady = Boolean(prompt && prompt.kind !== 'waiting' && hasLikelyShellPrompt(line))
    if (shellReady) {
      this.promptText = line
      this.phase = 'shell-ready'
    } else if (prompt?.kind === 'waiting') this.phase = 'awaiting-input'
    return {
      prompt: shellReady || prompt?.kind === 'waiting' ? prompt : undefined,
      shellReady,
      disconnected:
        !this.alternateScreen &&
        !this.cursorContent &&
        /(?:^|[\r\n])(?:Connection to [^\r\n]+ closed\.?|ssh: connect to host [^\r\n]+|client_loop: send disconnect: [^\r\n]+)(?:[\r\n]|$)/.test(
          plain
        )
    }
  }
}
