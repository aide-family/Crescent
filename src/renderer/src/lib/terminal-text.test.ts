import { describe, expect, it } from 'vitest'

import {
  createCrescentBootstrapFilter,
  filterCrescentBootstrapOutput,
  isCrescentScriptBootstrapLine
} from './terminal-text'

describe('crescent bootstrap display filter', () => {
  it('detects __crescent_script= lines and base64 continuations', () => {
    expect(isCrescentScriptBootstrapLine('__crescent_script=$(mktemp /tmp/x)')).toBe(true)
    expect(
      isCrescentScriptBootstrapLine('root@host:~# __crescent_script=$(mktemp "/tmp/crescent.XXXXXX")')
    ).toBe(true)
    expect(isCrescentScriptBootstrapLine(`${'A'.repeat(100)}=`)).toBe(true)
    expect(isCrescentScriptBootstrapLine('echo hello')).toBe(false)
  })

  it('strips bootstrap lines from buffers without touching normal output', () => {
    const raw = [
      'ready',
      '__crescent_script=$(mktemp /tmp/x) && printf %s',
      `${'YmFzZTY0'.repeat(20)}`,
      'done'
    ].join('\n')
    const filtered = filterCrescentBootstrapOutput(raw)
    expect(filtered).toContain('ready')
    expect(filtered).toContain('done')
    expect(filtered).not.toContain('__crescent_script=')
    expect(filtered).not.toMatch(/YmFzZTY0{10,}/)
  })

  it('filters streaming chunks incrementally', () => {
    const filter = createCrescentBootstrapFilter()
    expect(filter.push('hello\n')).toBe('hello\n')
    expect(filter.push('__crescent_script=$(mktemp)\n')).toBe('')
    expect(filter.push(`${'B'.repeat(120)}\n`)).toBe('')
    expect(filter.push('ok\n')).toBe('ok\n')
  })

  it('filters one-liner mktemp&&printf||base64 bootstrap (including mid-prompt)', () => {
    const payload = 'A'.repeat(96)
    const oneLiner =
      `__crescent_script=$(mktemp) && printf %s '${payload}' | base64 -d > "$__crescent_script" || true`
    expect(isCrescentScriptBootstrapLine(oneLiner)).toBe(true)
    expect(isCrescentScriptBootstrapLine(`root@host:~# ${oneLiner}`)).toBe(true)
    expect(filterCrescentBootstrapOutput(`out\n${oneLiner}\nok`)).not.toContain('__crescent_script')

    const filter = createCrescentBootstrapFilter()
    // Streamed without newline mid-line — must hold, not leak yellow command text
    expect(filter.push(oneLiner.slice(0, 40))).toBe('')
    expect(filter.push(oneLiner.slice(40) + '\n')).toBe('')
    expect(filter.push('ready\n')).toBe('ready\n')
  })
})