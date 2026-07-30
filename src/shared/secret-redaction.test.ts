import { describe, expect, it } from 'vitest'

import {
  redactSensitiveData,
  redactSensitiveHeaders,
  redactSensitiveText
} from './secret-redaction'

describe('secret-redaction', () => {
  it('redacts sensitive object keys recursively', () => {
    expect(
      redactSensitiveData({
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json'
        },
        body: {
          apiKey: 'sk-live-12345678',
          name: 'demo'
        },
        nested: [{ password: 'hunter2' }]
      })
    ).toEqual({
      headers: {
        Authorization: '[REDACTED]',
        'Content-Type': 'application/json'
      },
      body: {
        apiKey: '[REDACTED]',
        name: 'demo'
      },
      nested: [{ password: '[REDACTED]' }]
    })
  })

  it('redacts sensitive headers case-insensitively', () => {
    expect(
      redactSensitiveHeaders({
        authorization: 'Bearer abc',
        Cookie: 'session=1',
        'x-request-id': 'req-1'
      })
    ).toEqual({
      authorization: '[REDACTED]',
      Cookie: '[REDACTED]',
      'x-request-id': 'req-1'
    })
  })

  it('redacts secrets embedded in free-form text', () => {
    const text = [
      'Authorization: Bearer abc.def',
      '{"api_key":"sk-abcdefghijklmnop","ok":true}',
      'token value Bearer xyz123'
    ].join('\n')

    const redacted = redactSensitiveText(text)
    expect(redacted).toContain('Authorization: [REDACTED]')
    expect(redacted).toContain('"[REDACTED]"')
    expect(redacted).toContain('Bearer [REDACTED]')
    expect(redacted).not.toContain('abc.def')
    expect(redacted).not.toContain('sk-abcdefghijklmnop')
    expect(redacted).not.toContain('xyz123')
  })
})
