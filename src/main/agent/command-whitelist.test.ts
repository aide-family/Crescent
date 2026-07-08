import { describe, expect, it } from 'vitest'

import { matchCommandWhitelist } from './command-whitelist'

describe('matchCommandWhitelist', () => {
  it('matches exact commands', () => {
    expect(matchCommandWhitelist('df -h', ['df -h'])).toBe('df -h')
    expect(matchCommandWhitelist('df -i', ['df -h'])).toBeUndefined()
  })

  it('matches prefix rules ending with wildcard', () => {
    expect(matchCommandWhitelist('kubectl get pods -A', ['kubectl get *'])).toBe('kubectl get *')
    expect(matchCommandWhitelist('kubectl delete pod demo', ['kubectl get *'])).toBeUndefined()
  })

  it('matches regex rules', () => {
    expect(matchCommandWhitelist('op do web "df -h"', ['/^op do web .*df -h.*$/'])).toBe(
      '/^op do web .*df -h.*$/'
    )
  })
})
