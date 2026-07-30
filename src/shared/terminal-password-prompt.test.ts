import { describe, expect, it } from 'vitest'

import {
  extractPasswordPromptLine,
  hasUnterminatedSecretPrompt,
  isPasswordPromptLine,
  isTerminalCurrentlyAtPasswordPrompt
} from './terminal-password-prompt'

describe('terminal password prompt detection', () => {
  it('matches English sudo and SSH secret prompts', () => {
    expect(isPasswordPromptLine('[sudo] password for self:')).toBe(true)
    expect(isPasswordPromptLine('Password:')).toBe(true)
    expect(isPasswordPromptLine("alice@host's password:")).toBe(true)
    expect(isPasswordPromptLine('Enter passphrase for key:')).toBe(true)
    expect(isPasswordPromptLine('Verification code:')).toBe(true)
  })

  it('matches Chinese sudo password prompts with fullwidth colon', () => {
    expect(isPasswordPromptLine('[sudo] aide 的密码：')).toBe(true)
    expect(isPasswordPromptLine('[sudo] aide 的密码:')).toBe(true)
    expect(isPasswordPromptLine('请输入密码：')).toBe(true)
    expect(isPasswordPromptLine('口令：')).toBe(true)
    expect(isPasswordPromptLine('验证码：')).toBe(true)
  })

  it('extracts the latest secret prompt line from mixed output', () => {
    const output = ['ls /tmp', '[sudo] aide 的密码：'].join('\n')
    expect(extractPasswordPromptLine(output)).toBe('[sudo] aide 的密码：')
    expect(isTerminalCurrentlyAtPasswordPrompt(output)).toBe(true)
    expect(hasUnterminatedSecretPrompt(output)).toBe(true)
  })

  it('rejects unrelated lines', () => {
    expect(isPasswordPromptLine('aide@moon:~$')).toBe(false)
    expect(isPasswordPromptLine('password updated successfully')).toBe(false)
    expect(isPasswordPromptLine('密码策略已生效')).toBe(false)
  })
})
