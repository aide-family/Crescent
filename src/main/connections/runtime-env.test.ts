import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildEnvReadScript,
  clearRuntimeEnvCache,
  extractMarkedValue,
  resolveRuntimeEnvValue
} from './runtime-env'

describe('runtime-env', () => {
  afterEach(() => {
    clearRuntimeEnvCache()
  })

  it('extracts the marked env value from noisy shell output', () => {
    const output = [
      'oh-my-zsh noise',
      '__CRESCENT_ENV_VALUE_START__secret-value__CRESCENT_ENV_VALUE_END__',
      'more noise'
    ].join('\n')

    expect(extractMarkedValue(output)).toBe('secret-value')
  })

  it('returns empty string when markers are missing', () => {
    expect(extractMarkedValue('no markers here')).toBe('')
  })

  it('builds a non-interactive profile source script', () => {
    const script = buildEnvReadScript('/bin/zsh', 'BLJ_PASSWORD')

    expect(script).toContain('.zshrc')
    expect(script).toContain('.zprofile')
    expect(script).toContain('BLJ_PASSWORD')
    expect(script).toContain('__CRESCENT_ENV_VALUE_START__')
    expect(script).not.toContain(' -i')
  })

  it('rejects unsafe environment variable names', async () => {
    expect(await resolveRuntimeEnvValue('BAD-NAME')).toBeUndefined()
    expect(await resolveRuntimeEnvValue('1ABC')).toBeUndefined()
  })

  it('prefers process.env over shell profiles', async () => {
    process.env.CRESCENT_TEST_DIRECT_ENV = 'from-process'
    try {
      await expect(resolveRuntimeEnvValue('CRESCENT_TEST_DIRECT_ENV')).resolves.toBe('from-process')
    } finally {
      delete process.env.CRESCENT_TEST_DIRECT_ENV
    }
  })

  it.skipIf(process.platform === 'win32')(
    'reads values from a non-interactive user shell profile (packaged-app path)',
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'crescent-env-'))
      const previousHome = process.env.HOME
      process.env.HOME = home
      writeFileSync(join(home, '.zprofile'), 'export CRESCENT_TEST_PROFILE_ENV=from-zprofile\n')

      try {
        clearRuntimeEnvCache()
        await expect(
          resolveRuntimeEnvValue('CRESCENT_TEST_PROFILE_ENV', { forceRefresh: true })
        ).resolves.toBe('from-zprofile')
      } finally {
        if (previousHome === undefined) delete process.env.HOME
        else process.env.HOME = previousHome
        clearRuntimeEnvCache()
        rmSync(home, { recursive: true, force: true })
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'caches misses briefly and allows force refresh',
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'crescent-env-miss-'))
      const previousHome = process.env.HOME
      process.env.HOME = home

      try {
        clearRuntimeEnvCache()
        await expect(
          resolveRuntimeEnvValue('CRESCENT_TEST_MISSING_ENV', { forceRefresh: true })
        ).resolves.toBeUndefined()

        writeFileSync(join(home, '.zprofile'), 'export CRESCENT_TEST_MISSING_ENV=now-present\n')
        await expect(resolveRuntimeEnvValue('CRESCENT_TEST_MISSING_ENV')).resolves.toBeUndefined()
        await expect(
          resolveRuntimeEnvValue('CRESCENT_TEST_MISSING_ENV', { forceRefresh: true })
        ).resolves.toBe('now-present')
      } finally {
        if (previousHome === undefined) delete process.env.HOME
        else process.env.HOME = previousHome
        clearRuntimeEnvCache()
        rmSync(home, { recursive: true, force: true })
      }
    }
  )
})
