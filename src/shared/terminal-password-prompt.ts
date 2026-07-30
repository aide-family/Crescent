/**
 * Detect interactive secret prompts in terminal output (sudo/SSH/OTP).
 * Keep renderer password modal and main-process automation filters in sync.
 */

const SECRET_PROMPT_PATTERN =
  /(?:password|passphrase|verification code|one-time password|\botp\b|密码|口令|通行码|验证码|动态码)[^:\n：]*[:：]\s*$/i

export function isPasswordPromptLine(line: string): boolean {
  return SECRET_PROMPT_PATTERN.test(line.trim())
}

export function extractPasswordPromptLine(output: string): string | null {
  const lines = normalizePromptLines(output).slice(-8)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isPasswordPromptLine(lines[index])) return lines[index]
  }

  return null
}

export function isTerminalCurrentlyAtPasswordPrompt(output: string): boolean {
  const lines = normalizePromptLines(output)
  const lastLine = lines[lines.length - 1]
  return Boolean(lastLine && isPasswordPromptLine(lastLine))
}

export function hasUnterminatedSecretPrompt(value: string): boolean {
  const lastLine = normalizePromptLines(value).pop()
  return Boolean(lastLine && isPasswordPromptLine(lastLine))
}

function normalizePromptLines(value: string): string[] {
  return value
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
