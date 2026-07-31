import { describe, expect, it, vi } from 'vitest'

import {
  expandWindowsEnvRefs,
  parseRegQueryValue,
  readWindowsRegistryEnvValue
} from './windows-env'

describe('windows-env', () => {
  it('parses REG_SZ values from reg query output', () => {
    const stdout = [
      '',
      'HKEY_CURRENT_USER\\Environment',
      '    BLJ_PASSWORD    REG_SZ    secret-from-user',
      ''
    ].join('\r\n')

    expect(parseRegQueryValue(stdout, 'BLJ_PASSWORD')).toBe('secret-from-user')
  })

  it('matches registry value names case-insensitively', () => {
    const stdout =
      'HKEY_CURRENT_USER\\Environment\r\n    Blj_Password    REG_EXPAND_SZ    %USERPROFILE%\\secret\r\n'
    expect(parseRegQueryValue(stdout, 'BLJ_PASSWORD')).toBe('%USERPROFILE%\\secret')
  })

  it('expands nested Windows env references', () => {
    expect(
      expandWindowsEnvRefs('%USERPROFILE%\\data', {
        USERPROFILE: 'C:\\Users\\ops'
      })
    ).toBe('C:\\Users\\ops\\data')
  })

  it('does not spawn reg off Windows', async () => {
    const execFile = vi.fn()
    await expect(
      readWindowsRegistryEnvValue('BLJ_PASSWORD', {
        platform: 'darwin',
        execFile
      })
    ).resolves.toBeUndefined()
    expect(execFile).not.toHaveBeenCalled()
  })

  it('reads HKCU then expands REG_EXPAND_SZ', async () => {
    const execFile = vi.fn(async () => ({
      stdout:
        'HKEY_CURRENT_USER\\Environment\r\n    BLJ_PASSWORD    REG_EXPAND_SZ    %DRIVE%\\secret\r\n',
      stderr: ''
    }))

    await expect(
      readWindowsRegistryEnvValue('BLJ_PASSWORD', {
        platform: 'win32',
        env: { DRIVE: 'F:' },
        execFile: execFile as never
      })
    ).resolves.toBe('F:\\secret')

    expect(execFile).toHaveBeenCalledWith(
      'reg',
      ['query', 'HKCU\\Environment', '/v', 'BLJ_PASSWORD'],
      expect.objectContaining({ windowsHide: true })
    )
  })

  it('falls back to HKLM when HKCU is missing', async () => {
    const execFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('reg exited 1'))
      .mockResolvedValueOnce({
        stdout:
          'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment\r\n    BLJ_PASSWORD    REG_SZ    machine-secret\r\n',
        stderr: ''
      })

    await expect(
      readWindowsRegistryEnvValue('BLJ_PASSWORD', {
        platform: 'win32',
        execFile: execFile as never
      })
    ).resolves.toBe('machine-secret')
  })
})
