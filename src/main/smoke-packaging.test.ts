import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { evaluatePackagingArtifacts } = require('../../scripts/smoke-packaging.cjs') as {
  evaluatePackagingArtifacts: (
    files: string[],
    sizesByName?: Record<string, number>
  ) => {
    ok: boolean
    errors: string[]
    platforms: { mac: boolean; win: boolean; linux: boolean }
  }
}

describe('evaluatePackagingArtifacts', () => {
  it('accepts a single-platform mac build with updater metadata', () => {
    const result = evaluatePackagingArtifacts(
      ['crescent-1.0.0-universal.dmg', 'latest-mac.yml', 'crescent-1.0.0-universal.dmg.blockmap'],
      {
        'crescent-1.0.0-universal.dmg': 10_000_000,
        'latest-mac.yml': 200,
        'crescent-1.0.0-universal.dmg.blockmap': 1_000
      }
    )
    expect(result.ok).toBe(true)
    expect(result.platforms.mac).toBe(true)
    expect(result.platforms.win).toBe(false)
  })

  it('rejects empty directories conceptually via missing platform artifacts', () => {
    const result = evaluatePackagingArtifacts([])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/Expected at least one/)
  })

  it('requires updater yml metadata', () => {
    const result = evaluatePackagingArtifacts(['crescent-1.0.0-setup.exe'], {
      'crescent-1.0.0-setup.exe': 5_000_000
    })
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => /updater metadata/i.test(error))).toBe(true)
  })

  it('flags tiny placeholder artifacts', () => {
    const result = evaluatePackagingArtifacts(['crescent-1.0.0.AppImage', 'latest-linux.yml'], {
      'crescent-1.0.0.AppImage': 10,
      'latest-linux.yml': 120
    })
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => /too small/i.test(error))).toBe(true)
  })
})
