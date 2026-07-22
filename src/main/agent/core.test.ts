import { describe, expect, it } from 'vitest'

import { sanitizeFinalAnswer } from './core'

describe('sanitizeFinalAnswer', () => {
  it('removes leaked tool-call markup from final answers', () => {
    const text = sanitizeFinalAnswer(
      [
        'No default StorageClass exists, so a hostPath PV must be created first. Check whether the image can be pulled.',
        '',
        '<｜｜DSML｜｜tool_calls>',
        '<｜｜DSML｜｜invoke name="execute_terminal_command">',
        '<｜｜DSML｜｜parameter name="command" string="true">kubectl get pods</｜｜DSML｜｜parameter>',
        '</｜｜DSML｜｜invoke>',
        '</｜｜DSML｜｜tool_calls>'
      ].join('\n'),
      'safety-limit'
    )

    expect(text).toContain('Incomplete')
    expect(text).toContain('No default StorageClass')
    expect(text).not.toContain('tool_calls')
    expect(text).not.toContain('execute_terminal_command')
    expect(text).not.toContain('kubectl get pods')
  })

  it('wraps a bare next command when the safety limit is reached', () => {
    const text = sanitizeFinalAnswer(
      'ls -la /run/containerd/containerd.sock 2>/dev/null; id; groups',
      'safety-limit'
    )

    expect(text).toContain('Incomplete')
    expect(text).toContain('Next Step')
    expect(text).toContain('ls -la /run/containerd/containerd.sock')
  })
})
