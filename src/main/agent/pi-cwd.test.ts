import { describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { ensureWorkspaceCwd, resolveAgentWorkspaceCwd } from './pi-cwd'

describe('pi-cwd', () => {
  it('creates missing workspace directories', () => {
    const cwd = join(tmpdir(), `crescent-workspace-${Date.now()}`)
    rmSync(cwd, { recursive: true, force: true })
    ensureWorkspaceCwd(cwd)
    expect(() => mkdirSync(cwd, { recursive: true })).not.toThrow()
  })

  it('resolves configured workspace cwd', () => {
    const cwd = join(tmpdir(), `crescent-workspace-cfg-${Date.now()}`)
    const resolved = resolveAgentWorkspaceCwd({ workspaceCwd: cwd })
    expect(resolved).toBe(cwd)
  })
})
