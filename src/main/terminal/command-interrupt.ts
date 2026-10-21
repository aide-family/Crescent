/** Shared helpers for PTY command interrupt / timeout settle semantics. */

export const TERMINAL_CTRL_C_CONFIRM_MS = 500

export function detectsTerminalCtrlC(chunk: string): boolean {
  if (!chunk) return false
  if (chunk.includes('\x03')) return true
  // Printed caret notation can be ordinary program output; only input ETX is authoritative.
  return false
}

export function buildInterruptedCommandError(): string {
  return [
    '检测到终端 Ctrl+C，命令被用户中断，未执行完整。',
    'Detected terminal Ctrl+C; the command was interrupted and did not finish.',
    '先重新确认终端状态再决策，禁止原样重试。',
    'Re-check the terminal state before deciding next steps. Do not retry the same command unchanged.'
  ].join('\n')
}

export function buildTimeoutCommandError(timeoutMs: number): string {
  return [
    `命令执行超时（${timeoutMs}ms），结果未确认；以下为部分输出。`,
    `Command execution timeout (${timeoutMs}ms); completion unknown with partial output. No interrupt was sent.`,
    '先重新确认终端状态再决策，禁止原样重试。',
    'Re-check the terminal state before deciding next steps. Do not retry the same command unchanged.'
  ].join('\n')
}

export function hasLikelyShellPrompt(value: string): boolean {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0)
  const last = lines[lines.length - 1] ?? ''
  return /(?:^|[^\S\r\n]|\])(?:[#$%❯›»]|➜)\s*$/.test(last) || /:~?[^\n]*[#$%]\s*$/.test(last)
}
