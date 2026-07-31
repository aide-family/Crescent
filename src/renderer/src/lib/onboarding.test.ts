import { describe, expect, it } from 'vitest'

import {
  ONBOARDING_STORAGE_KEY,
  createExampleOpenApiProfile,
  dismissOnboarding,
  shouldShowOnboarding
} from './onboarding'

describe('onboarding helpers', () => {
  it('shows onboarding until dismissed', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      }
    }

    expect(shouldShowOnboarding(storage)).toBe(true)
    dismissOnboarding(storage)
    expect(store.get(ONBOARDING_STORAGE_KEY)).toBe('1')
    expect(shouldShowOnboarding(storage)).toBe(false)
  })

  it('builds an example OpenAPI profile with inline document', () => {
    const profile = createExampleOpenApiProfile('example-1')
    expect(profile.id).toBe('example-1')
    expect(profile.name).toBe('Example API')
    expect(profile.baseUrl).toContain('httpbin')
    expect(profile.document).toContain('getHealth')
  })
})
