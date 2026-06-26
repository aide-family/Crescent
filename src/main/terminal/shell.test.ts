import { homedir } from 'os'
import { describe, expect, it } from 'vitest'

import { getDefaultTerminalCwd, resolveShellLaunchConfig } from './shell'

describe('terminal shell config', () => {
  it('uses the current user home directory as the default cwd', () => {
    expect(getDefaultTerminalCwd()).toBe(homedir())
  })

  it('uses SHELL from the current environment on unix-like systems', () => {
    const config = resolveShellLaunchConfig({ SHELL: '/bin/bash' })

    if (process.platform === 'win32') {
      expect(config.shell).toBe('powershell.exe')
    } else {
      expect(config.shell).toBe('/bin/bash')
      expect(config.args).toEqual(['-l', '-i'])
    }
  })
})
